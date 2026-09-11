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
import { createCategoriesRepository } from '../../repositories/categories.repository';
import { createContactsRepository } from '../../repositories/contacts.repository';
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
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    await locations.create({ name: 'Despensa' });

    await items.create({ name: 'Feijão Preto', quantity: 4, unit: 'kg' });
    await items.create({ name: 'Milho Verde', quantity: 3, unit: 'latas' });

    deps = {
      items, locations, categories, contacts, context: CONTEXT, language: 'pt-BR',
      trackedCategoryIds: [], dismissedItemIds: [],
    };
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

  describe('a move', () => {
    it('is explicit when both the item and the destination were named exactly', async () => {
      const write = await pending(deps, { kind: 'MOVE_ITEM', item: 'feijao preto',
        location: 'despensa' });

      expect(write).toMatchObject({ certainty: 'explicit', assumptions: [] });
    });

    /**
     * `findLocation` matches on CONTAINS, so "despensa" happily finds
     * "Despensa Principal" - and would find the wrong one of two pantries just
     * as readily. A move is the one write whose whole content is a place, so a
     * place matched loosely is exactly the part worth showing first.
     */
    it('is assumed when the destination was matched loosely', async () => {
      await deps.locations.create({ name: 'Garagem dos Fundos' });
      const write = await pending(deps, { kind: 'MOVE_ITEM', item: 'feijao preto',
        location: 'garagem' });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['location'] });
    });

    it('lists both when the item was a guess too', async () => {
      await deps.locations.create({ name: 'Garagem dos Fundos' });
      const write = await pending(deps, { kind: 'MOVE_ITEM', item: 'feijao',
        location: 'garagem' });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['item', 'location'] });
    });
  });

  /**
   * The thresholds have no assumed number to worry about: the rules that build
   * them refuse a phrase without one, because there is no sensible default for
   * a level nobody stated. So the only thing left to guess at is which item.
   */
  describe('a threshold', () => {
    it('is explicit when the name was exact and the number was spoken', async () => {
      expect(await pending(deps, { kind: 'SET_MINIMUM', item: 'feijao preto',
        amount: 8, unit: null })).toMatchObject({ certainty: 'explicit', assumptions: [] });

      expect(await pending(deps, { kind: 'SET_TARGET', item: 'feijao preto',
        amount: 20, unit: null })).toMatchObject({ certainty: 'explicit', assumptions: [] });
    });

    it('is assumed when the item was matched by something looser than its name', async () => {
      expect(await pending(deps, { kind: 'SET_MINIMUM', item: 'feijao',
        amount: 8, unit: null })).toMatchObject({ certainty: 'assumed', assumptions: ['item'] });

      expect(await pending(deps, { kind: 'SET_TARGET', item: 'feijao',
        amount: 20, unit: null })).toMatchObject({ certainty: 'assumed', assumptions: ['item'] });
    });

    /**
     * A differing unit IS a guess here, as it is for an adjustment - and this
     * test used to assert the opposite.
     *
     * The argument for letting it through was that a threshold replaces a field
     * rather than adding into one, so the arithmetic cannot drift. True, and
     * beside the point: "o minimo de milho e 8 kg" against corn kept in cans
     * stores the bare number 8 and reads it as eight CANS for ever, against a
     * count the user never sees it beside.
     *
     * A wrong adjustment surfaces the next time anyone looks at the quantity.
     * A wrong minimum surfaces as a replenishment list that is quietly wrong
     * about what is running out - the one list this application exists to get
     * right. So it asks.
     */
    it('treats a differing unit as a guess', async () => {
      const write = await pending(deps, { kind: 'SET_MINIMUM', item: 'milho verde',
        amount: 8, unit: 'kg' });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['unit'] });
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

  /**
   * A contact is never a nudge either, and the case that matters is the one
   * with NOTHING to assume about.
   *
   * `certaintyOf` derives `explicit` from an empty assumption list, and a
   * contact spoken without a number produces exactly that - no item matched
   * loosely, no quantity filled in, no date derived. Left to it, "novo
   * contato, ana" would be stored without anybody being asked, and a name
   * taken out of a transcript would land in the phone book with no step at
   * which it was shown. Every other write the caller stores unasked is read
   * back afterwards against something stored; a contact's name is read back
   * against nothing.
   *
   * So `execute` sets it rather than deriving it. The first test below is what
   * would break if somebody tidied that into a `certaintyOf([])` call.
   */
  describe('a contact', () => {
    it('is assumed even with an empty assumption list', async () => {
      const write = await pending(deps, { kind: 'CREATE_CONTACT', name: 'ana',
        relationship: null, phone: null });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: [] });
    });

    /**
     * And a number that WAS spoken says so, because that is the part of the
     * card a reader has to check character by character.
     */
    it('names the heard digits when a number was spoken', async () => {
      const write = await pending(deps, { kind: 'CREATE_CONTACT', name: 'ana',
        relationship: 'irma', phone: '5551234' });

      expect(write).toMatchObject({ certainty: 'assumed', assumptions: ['heardDigits'] });
    });
  });

  describe('a threshold in a unit the row does not keep', () => {
    // A wrong adjustment shows up next time anyone looks at the quantity. A wrong
    // minimum shows up as a replenishment list that is quietly wrong about what is
    // running out - so this asks, rather than storing five cans as five kilos.
    it('asks before storing a minimum counted in another unit', async () => {
      const result = await execute(deps, {
        kind: 'SET_MINIMUM', item: 'feijao preto', amount: 5, unit: 'latas',
      });
      expect(result.kind).toBe('pending');
      if (result.kind !== 'pending') return;
      expect(result.write.certainty).toBe('assumed');
      expect(result.write.assumptions).toContain('unit');
    });

    it('asks before storing a target counted in another unit', async () => {
      const result = await execute(deps, {
        kind: 'SET_TARGET', item: 'feijao preto', amount: 20, unit: 'latas',
      });
      expect(result.kind).toBe('pending');
      if (result.kind !== 'pending') return;
      expect(result.write.assumptions).toContain('unit');
    });

    it('stays explicit when the unit is the one the row keeps', async () => {
      const result = await execute(deps, {
        kind: 'SET_MINIMUM', item: 'feijao preto', amount: 5, unit: 'kg',
      });
      expect(result.kind).toBe('pending');
      if (result.kind !== 'pending') return;
      expect(result.write.certainty).toBe('explicit');
    });

    it('stays explicit when no unit was spoken at all', async () => {
      const result = await execute(deps, {
        kind: 'SET_MINIMUM', item: 'feijao preto', amount: 5, unit: null,
      });
      expect(result.kind).toBe('pending');
      if (result.kind !== 'pending') return;
      expect(result.write.certainty).toBe('explicit');
    });
  });
});
