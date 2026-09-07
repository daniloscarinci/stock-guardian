/**
 * Taking back a write that was stored without asking.
 *
 * An explicit write goes straight into the database and the user is offered
 * Undo instead of a confirmation. That trade only holds if Undo really puts
 * things back, which is why the receipt records the VALUE that was there
 * rather than the change that replaced it - see the clamping test below, the
 * case that decided the design.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { execute, type PendingWrite, type VoiceDeps } from './execute';
import { commit, undo } from './commit';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

describe('undo', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;
  let feijaoId: string;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    await locations.create({ name: 'Despensa' });

    const feijao = await items.create({
      name: 'Feijão Preto', quantity: 2, unit: 'kg', expirationDate: '2026-12-01',
    });
    feijaoId = feijao.id;

    deps = { items, locations, context: CONTEXT, language: 'pt-BR', trackedCategoryIds: [] };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  async function write(...args: Parameters<typeof execute>): Promise<PendingWrite> {
    const result = await execute(...args);
    if (result.kind !== 'pending') throw new Error(`expected pending, got ${result.kind}`);
    return result.write;
  }

  it('puts an added quantity back', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 5, direction: 'up', transaction: 'purchase',
      unit: null, amountAssumed: false }));
    expect(saved.item.quantity).toBe(7);
    expect(saved.receipt).toMatchObject({ undo: { kind: 'restoreQuantity', to: 2 } });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(2);
  });

  /**
   * The case the whole design turns on.
   *
   * `adjustQuantity` clamps at zero, so removing 5 from 2 lands on 0 - and
   * undoing by adding 5 back would leave FIVE, three of which never existed.
   * The receipt records the 2 that was there, so the way back is a correction
   * of +2 rather than the inverse of the change.
   */
  it('restores the quantity that was there, not the delta that was applied', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 5, direction: 'down', transaction: 'consume',
      unit: null, amountAssumed: false }));
    expect(saved.item.quantity).toBe(0);

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(2);
  });

  /**
   * The transaction log is deliberate, and an undo is part of the story rather
   * than an erasure of it: the quantity moved twice and the log says so twice,
   * the second time as a correction.
   */
  it('records the way back as a correction instead of deleting history', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 5, direction: 'down', transaction: 'consume',
      unit: null, amountAssumed: false }));

    await undo(deps, saved.receipt);

    const history = await deps.items.history(feijaoId);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ type: 'correction', quantity_before: 0, quantity_after: 2 });
    expect(history[1]).toMatchObject({ type: 'consume', quantity_before: 2, quantity_after: 0 });
  });

  it('puts back the expiry date that was replaced', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'SET_EXPIRY',
      item: 'feijao preto', expiresOn: '2027-01-01', dateAssumed: false }));
    expect(saved.item.expirationDate).toBe('2027-01-01');
    expect(saved.receipt).toMatchObject({ undo: { kind: 'restoreExpiry', to: '2026-12-01' } });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.expirationDate).toBe('2026-12-01');
  });

  /** An item that had no date goes back to having none, not to today's. */
  it('puts back an absent expiry date as absent', async () => {
    const arroz = await deps.items.create({ name: 'Arroz Branco', quantity: 1, unit: 'kg' });

    const saved = await commit(deps, await write(deps, { kind: 'SET_EXPIRY',
      item: 'arroz branco', expiresOn: '2027-01-01', dateAssumed: false }));
    expect(saved.receipt).toMatchObject({ undo: { kind: 'restoreExpiry', to: null } });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(arroz.id))?.expirationDate).toBeNull();
  });

  /**
   * Deleted rather than archived. An item created seconds ago by a misheard
   * sentence was never stock: archiving would leave it in the archived list,
   * in the counts and in an export, and saying the sentence again would make a
   * duplicate rather than bring it back.
   */
  it('takes a creation away entirely, leaving nothing archived', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'CREATE_ITEM', name: 'quinoa',
      amount: 2, unit: 'kg', location: null, expiresOn: null }));
    expect(saved.receipt).toMatchObject({ undo: { kind: 'deleteItem' } });

    await undo(deps, saved.receipt);

    expect(await deps.items.getById(saved.item.id)).toBeUndefined();
    const everything = await deps.items.list(deps.context, {
      filters: { search: 'quinoa', archived: 'all' },
      lang: 'pt-BR',
    });
    expect(everything.rows).toHaveLength(0);
  });

  /**
   * Undo is offered for a few seconds, and a row can be deleted inside them.
   * Being asked to restore something that is gone is not an error worth
   * showing anybody.
   */
  it('says nothing when the item it would restore has been deleted', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 1, direction: 'up', transaction: 'add',
      unit: null, amountAssumed: false }));

    await deps.items.remove(feijaoId);
    await expect(undo(deps, saved.receipt)).resolves.toBeUndefined();
  });

  /**
   * The receipt names the quantity that was actually replaced, read at the
   * moment of the write. A `PendingWrite` carries a view built when the phrase
   * was executed, and a `+` tap on the item screen in between would make that
   * view - and an undo trusting it - a quantity out of date.
   */
  it('records the quantity as it was when the write landed, not when it was described', async () => {
    const pendingWrite = await write(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 1, direction: 'up', transaction: 'add', unit: null, amountAssumed: false });

    await deps.items.adjustQuantity(feijaoId, 3, { type: 'add' });

    const saved = await commit(deps, pendingWrite);
    expect(saved.item.quantity).toBe(6);
    expect(saved.receipt).toMatchObject({ undo: { kind: 'restoreQuantity', to: 5 } });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(5);
  });
});
