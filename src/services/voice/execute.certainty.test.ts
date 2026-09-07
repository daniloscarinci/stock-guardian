/**
 * How much of a write was heard, and how much was filled in.
 *
 * Every write used to reach the confirmation card, which is safe and, on a
 * real phone, tiring: "usei 3 ovos" is not ambiguous and does not need a
 * second opinion. A write is `explicit` only when the user named the item
 * exactly and said the number; everything else is `assumed` and says why, so
 * the caller can store the first kind at once and show the second.
 *
 * `execute` still writes nothing either way - see `execute.writes.test.ts`.
 * All that changes here is who decides to call `commit`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { execute, type PendingWrite, type VoiceDeps } from './execute';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

describe('execute: certainty', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    await locations.create({ name: 'Despensa' });

    await items.create({ name: 'Feijão Preto', quantity: 4, unit: 'kg' });
    await items.create({ name: 'Milho Verde', quantity: 3, unit: 'latas' });

    deps = { items, locations, context: CONTEXT, language: 'pt-BR', trackedCategoryIds: [] };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  /** The pending write an intent produces, or a failure naming what came back. */
  async function pending(...args: Parameters<typeof execute>): Promise<PendingWrite> {
    const result = await execute(...args);
    if (result.kind !== 'pending') throw new Error(`expected pending, got ${result.kind}`);
    return result.write;
  }

  describe('a quantity change', () => {
    it('is explicit when the name was exact and the number was spoken', async () => {
      const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
        amount: 2, direction: 'up', transaction: 'purchase', unit: null,
        amountAssumed: false });

      expect(write).toMatchObject({ certainty: 'explicit', assumptions: [] });
    });

    it('is assumed when the number was not spoken', async () => {
      const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
        amount: 1, direction: 'up', transaction: 'purchase', unit: null,
        amountAssumed: true });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['quantity'] });
    });

    /**
     * "feijao" finds "Feijão Preto" and is right to. It is still a guess at
     * which row the user meant, and the card is where a guess belongs.
     */
    it('is assumed when the item was found by less than its whole name', async () => {
      const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao',
        amount: 2, direction: 'down', transaction: 'consume', unit: null,
        amountAssumed: false });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['item'] });
    });

    it('lists every guess it made, in one fixed order', async () => {
      const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao',
        amount: 1, direction: 'up', transaction: 'add', unit: 'latas',
        amountAssumed: true });

      expect(write).toMatchObject({
        certainty: 'assumed',
        assumptions: ['quantity', 'item', 'unit'],
      });
    });

    /**
     * A quantity is one number with a label on it, so "duas latas" against a
     * row kept in kilos adds two KILOS. The user said something the inventory
     * cannot record, which is exactly what the card is for.
     */
    it('is assumed when the spoken unit is not the unit the row is kept in', async () => {
      const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
        amount: 2, direction: 'up', transaction: 'purchase', unit: 'latas',
        amountAssumed: false });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['unit'] });
    });

    it('does not call a plural a different unit', async () => {
      const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'milho verde',
        amount: 2, direction: 'up', transaction: 'purchase', unit: 'lata',
        amountAssumed: false });

      expect(write).toMatchObject({ certainty: 'explicit', assumptions: [] });
    });

    it('treats a correction the same way, since its number is always spoken', async () => {
      const exact = await pending(deps, { kind: 'SET_QUANTITY', item: 'feijao preto',
        amount: 10, unit: null });
      expect(exact).toMatchObject({ certainty: 'explicit', assumptions: [] });

      const partial = await pending(deps, { kind: 'SET_QUANTITY', item: 'feijao',
        amount: 10, unit: null });
      expect(partial).toMatchObject({ certainty: 'assumed', assumptions: ['item'] });
    });
  });

  describe('an expiry date', () => {
    it('is explicit when the name was exact and the date was stated', async () => {
      const write = await pending(deps, { kind: 'SET_EXPIRY', item: 'feijao preto',
        expiresOn: '2027-01-01', dateAssumed: false });

      expect(write).toMatchObject({ certainty: 'explicit', assumptions: [] });
    });

    /** "vence em marco" is stored as the 31st, a day nobody said. */
    it('is assumed when the day was derived rather than said', async () => {
      const write = await pending(deps, { kind: 'SET_EXPIRY', item: 'feijao preto',
        expiresOn: '2027-03-31', dateAssumed: true });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['date'] });
    });

    it('lists both when the item was a guess too', async () => {
      const write = await pending(deps, { kind: 'SET_EXPIRY', item: 'feijao',
        expiresOn: '2027-03-31', dateAssumed: true });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['item', 'date'] });
    });
  });

  /**
   * A creation is never a nudge, however completely it was dictated. It puts a
   * new row in the inventory under a name taken from a transcript, and there
   * is no existing row to check that name against.
   */
  describe('a creation', () => {
    it('is assumed even when every field was spoken', async () => {
      const write = await pending(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: 2,
        unit: 'kg', location: 'despensa', expiresOn: '2027-03-01' });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['newItem'] });
    });
  });
});
