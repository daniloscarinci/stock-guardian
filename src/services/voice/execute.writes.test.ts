import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createCategoriesRepository } from '../../repositories/categories.repository';
import { createContactsRepository } from '../../repositories/contacts.repository';
import type { InventoryItem } from '../../types/domain';
import { execute, type PendingWrite, type VoiceDeps } from './execute';
import { commit, type Committed } from './commit';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

/**
 * The item a sentence produced, or a failure saying what came back instead.
 *
 * `Committed.wrote` says which kind of row was written, because a sentence can
 * now make a place or a contact as well as an item. A test that reached past
 * that with a cast would go on compiling on the day one of these phrases
 * started producing something else; asserting the kind makes that day a
 * failure that names what it got.
 */
function committedItem(committed: Committed): InventoryItem {
  if (committed.wrote.kind !== 'item') {
    throw new Error(`expected an item, got a ${committed.wrote.kind}`);
  }
  return committed.wrote.item;
}

describe('execute: writes stay pending', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;
  let feijaoId: string;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    await locations.create({ name: 'Despensa' });

    const feijao = await items.create({
      name: 'Feijão Preto', quantity: 4, unit: 'kg', minimumQuantity: 10,
    });
    feijaoId = feijao.id;

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

  it('sends no INSERT or UPDATE to the driver while executing any intent', async () => {
    const exec = vi.spyOn(db, 'exec');
    const batch = vi.spyOn(db, 'batch');

    await execute(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto', amount: 5,
      direction: 'up', transaction: 'add', unit: null, amountAssumed: false });
    await execute(deps, { kind: 'SET_QUANTITY', item: 'feijao preto', amount: 3, unit: null });
    await execute(deps, { kind: 'SET_EXPIRY', item: 'feijao preto',
      expiresOn: '2027-01-01', dateAssumed: false });
    await execute(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: 2, unit: 'kg',
      location: null, expiresOn: null });
    await execute(deps, { kind: 'MOVE_ITEM', item: 'feijao preto', location: 'despensa' });
    await execute(deps, { kind: 'SET_MINIMUM', item: 'feijao preto', amount: 12, unit: null });
    await execute(deps, { kind: 'SET_TARGET', item: 'feijao preto', amount: 20, unit: null });

    const written = exec.mock.calls.filter(([sql]) =>
      /^\s*(?:insert|update|delete)/i.test(String(sql)),
    );
    expect(written).toHaveLength(0);
    expect(batch).not.toHaveBeenCalled();
  });

  /*
   * The spy above watches `db.exec`, and `adjustQuantity` does its writing
   * inside `db.transaction` - whose `tx.exec` calls the driver primitive
   * directly and never passes through `db.exec`. So that spy alone is blind to
   * the one write path an adjustment takes, and would pass just as happily
   * over a module that wrote through it. This test closes the hole and, by
   * committing afterwards, proves the spies fire when something really is
   * written rather than passing because nothing was watched.
   */
  it('opens no transaction either, and the same spies see the write once it is confirmed', async () => {
    const exec = vi.spyOn(db, 'exec');
    const transaction = vi.spyOn(db, 'transaction');

    const adjust = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 5, direction: 'up', transaction: 'add', unit: null, amountAssumed: false });
    const create = await pending(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: 2,
      unit: 'kg', location: null, expiresOn: null });

    expect(transaction).not.toHaveBeenCalled();
    expect(exec.mock.calls.filter(([sql]) => /^\s*(?:insert|update|delete)/i.test(String(sql))))
      .toHaveLength(0);

    await commit(deps, adjust);
    expect(transaction).toHaveBeenCalledTimes(1);

    await commit(deps, create);
    expect(exec.mock.calls.filter(([sql]) => /^\s*insert/i.test(String(sql))))
      .not.toHaveLength(0);
  });

  /*
   * The certainty on a `PendingWrite` changes who decides to call `commit`,
   * and nothing else. An explicit write is one the caller may store without
   * asking - which is a statement about the caller, not a licence for this
   * module to take the shortcut itself.
   */
  it('writes nothing even when the write is certain enough to need no confirmation', async () => {
    const exec = vi.spyOn(db, 'exec');
    const transaction = vi.spyOn(db, 'transaction');

    const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 5, direction: 'up', transaction: 'purchase', unit: null,
      amountAssumed: false });

    expect(write).toMatchObject({ certainty: 'explicit', assumptions: [] });
    expect(transaction).not.toHaveBeenCalled();
    expect(exec.mock.calls.filter(([sql]) => /^\s*(?:insert|update|delete)/i.test(String(sql))))
      .toHaveLength(0);
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(4);
  });

  it('describes an adjustment without performing it', async () => {
    const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 5, direction: 'up', transaction: 'purchase', unit: null, amountAssumed: false });

    expect(write).toMatchObject({ kind: 'ADJUST', delta: 5, after: 9, transaction: 'purchase' });
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(4);
  });

  it('takes a removal to zero rather than below it, as the write would', async () => {
    const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 9, direction: 'down', transaction: 'consume', unit: null, amountAssumed: false });

    expect(write).toMatchObject({ kind: 'ADJUST', delta: -9, after: 0 });
  });

  it('turns a correction into the signed delta that reaches it', async () => {
    const write = await pending(deps, { kind: 'SET_QUANTITY', item: 'feijao preto',
      amount: 3, unit: null });

    expect(write).toMatchObject({ kind: 'ADJUST', delta: -1, after: 3, transaction: 'correction' });
  });

  describe('a move', () => {
    it('describes it, naming the shelf it comes from and the one it goes to', async () => {
      const write = await pending(deps, { kind: 'MOVE_ITEM', item: 'feijao preto',
        location: 'despensa' });

      expect(write).toMatchObject({
        kind: 'MOVE', fromLocationId: null, fromLocationName: null,
        toLocationName: 'Despensa',
      });
      expect((await deps.items.getById(feijaoId))?.locationId).toBeNull();
    });

    /**
     * A destination that does not exist stops the move.
     *
     * The same refusal a creation makes about a shelf it was told, and here it
     * matters more: a move that ignored the unknown place would take the item
     * off the shelf it really is on and put it nowhere, destroying the one
     * fact the user was trying to change.
     */
    it('refuses rather than moving an item to nowhere', async () => {
      const result = await execute(deps, { kind: 'MOVE_ITEM', item: 'feijao preto',
        location: 'porao' });

      expect(result).toMatchObject({ kind: 'notFound', phrase: 'porao' });
      expect((await deps.items.getById(feijaoId))?.locationId).toBeNull();
    });

    /**
     * Already there. `items.transfer` would still write a transfer row saying
     * the item moved from a shelf to itself, so this answers with where the
     * item is instead of proposing a change that is not one.
     */
    it('answers rather than proposing a move to the shelf it is already on', async () => {
      const shelf = await deps.locations.findByName('Despensa');
      expect(shelf).toBeDefined();
      if (shelf === undefined) return;
      await deps.items.update(feijaoId, { locationId: shelf.id });

      const result = await execute(deps, { kind: 'MOVE_ITEM', item: 'feijao preto',
        location: 'despensa' });
      expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'WHERE_ITEM' } });
    });
  });

  describe('a threshold', () => {
    it('describes a minimum and the value it replaces', async () => {
      const write = await pending(deps, { kind: 'SET_MINIMUM', item: 'feijao preto',
        amount: 12, unit: null });

      expect(write).toMatchObject({ kind: 'MINIMUM', before: 10, after: 12 });
      expect((await deps.items.getById(feijaoId))?.minimumQuantity).toBe(10);
    });

    /** Never set is not the same as zero, and the receipt has to keep them apart. */
    it('records a null minimum as null rather than as zero', async () => {
      await deps.items.update(feijaoId, { minimumQuantity: null });
      const write = await pending(deps, { kind: 'SET_MINIMUM', item: 'feijao preto',
        amount: 3, unit: null });

      expect(write).toMatchObject({ kind: 'MINIMUM', before: null, after: 3 });
    });

    it('describes a target and the value it replaces', async () => {
      const write = await pending(deps, { kind: 'SET_TARGET', item: 'feijao preto',
        amount: 20, unit: null });

      expect(write).toMatchObject({ kind: 'TARGET', before: null, after: 20 });
      expect((await deps.items.getById(feijaoId))?.idealQuantity).toBeNull();
    });

    /**
     * Setting a threshold to the value it already holds changes nothing, and a
     * card asking to confirm nothing is worse than the true sentence about
     * what the item holds.
     */
    it('answers rather than asking to confirm a minimum that is already set', async () => {
      const result = await execute(deps, { kind: 'SET_MINIMUM', item: 'feijao preto',
        amount: 10, unit: null });

      expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'QUANTITY' } });
    });
  });

  it('describes a new expiry date and the one it replaces', async () => {
    const write = await pending(deps, { kind: 'SET_EXPIRY', item: 'feijao preto',
      expiresOn: '2027-01-01', dateAssumed: false });

    expect(write).toMatchObject({ kind: 'EXPIRY', before: null, after: '2027-01-01' });
    expect((await deps.items.getById(feijaoId))?.expirationDate).toBeNull();
  });

  it('fills in the quantity and unit a creation was not told', async () => {
    const write = await pending(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: null,
      unit: null, location: null, expiresOn: null });

    expect(write).toMatchObject({ kind: 'CREATE', name: 'quinoa', quantity: 1, unit: 'un' });
  });

  it('names the location a creation was given, so the card can show it', async () => {
    const write = await pending(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: 2,
      unit: 'kg', location: 'despensa', expiresOn: '2027-03-01' });

    expect(write).toMatchObject({
      kind: 'CREATE', locationName: 'Despensa', quantity: 2, unit: 'kg',
      expirationDate: '2027-03-01',
    });
  });

  /*
   * `adjustQuantity` returns early when the delta is zero: it writes neither
   * the quantity nor a history row. Rather than let a card ask for a
   * confirmation that records nothing, `execute` answers with the quantity -
   * which is the true thing to say to someone correcting a number to the
   * number it already holds. The second test keeps `commit` honest anyway,
   * since it is a public function and a caller could hand it anything.
   */
  it('answers rather than asking to confirm a correction that changes nothing', async () => {
    const result = await execute(deps, { kind: 'SET_QUANTITY', item: 'feijao preto',
      amount: 4, unit: null });

    expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'QUANTITY' } });
    if (result.kind === 'answer' && result.answer.kind === 'QUANTITY') {
      expect(result.answer.item.quantity).toBe(4);
    }
  });

  it('records no history for a zero delta that reaches commit by another route', async () => {
    const item = await deps.items.getById(feijaoId);
    expect(item).toBeDefined();
    if (item === undefined) return;

    const before = await deps.items.history(feijaoId);
    const result = await commit(deps, {
      kind: 'ADJUST',
      item: { ...item, stockStatus: 'low', expiryBucket: 'none', daysUntilExpiry: null,
        needed: 6, effectiveMinimum: 10, categoryName: null, locationName: null },
      delta: 0,
      after: 4,
      transaction: 'correction',
      certainty: 'explicit',
      assumptions: [],
    });

    expect(committedItem(result).quantity).toBe(4);
    expect(await deps.items.history(feijaoId)).toHaveLength(before.length);
  });
});

describe('commit', () => {
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
    deps = {
      items, locations, categories, contacts, context: CONTEXT, language: 'pt-BR',
      trackedCategoryIds: [], dismissedItemIds: [],
    };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  async function write(...args: Parameters<typeof execute>): Promise<PendingWrite> {
    const result = await execute(...args);
    if (result.kind !== 'pending') throw new Error(`expected pending, got ${result.kind}`);
    return result.write;
  }

  it('performs the adjustment that was only described, and says why', async () => {
    const pendingWrite = await write(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 6, direction: 'up', transaction: 'purchase', unit: null, amountAssumed: false });

    const saved = await commit(deps, pendingWrite);
    expect(committedItem(saved).quantity).toBe(10);

    const history = await deps.items.history(committedItem(saved).id);
    expect(history[0]).toMatchObject({ type: 'purchase', notes: 'Por voz', quantity_after: 10 });
  });

  it('creates an item with the defaults it was not told', async () => {
    const pendingWrite = await write(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: null,
      unit: null, location: null, expiresOn: null });

    const created = await commit(deps, pendingWrite);
    expect(committedItem(created)).toMatchObject({
      name: 'quinoa', quantity: 1, unit: 'un', locationId: null, expirationDate: null,
    });
  });

  it('creates an item on the shelf that was named', async () => {
    const pendingWrite = await write(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: 2,
      unit: 'kg', location: 'despensa', expiresOn: '2027-03-01' });

    const created = await commit(deps, pendingWrite);
    const shelf = await deps.locations.findByName('Despensa');
    expect(committedItem(created)).toMatchObject({
      quantity: 2, unit: 'kg', expirationDate: '2027-03-01',
    });
    expect(committedItem(created).locationId).toBe(shelf?.id);
  });

  it('sets an expiry date', async () => {
    const pendingWrite = await write(deps, { kind: 'SET_EXPIRY', item: 'feijao preto',
      expiresOn: '2027-01-01', dateAssumed: false });

    const saved = await commit(deps, pendingWrite);
    expect(committedItem(saved).expirationDate).toBe('2027-01-01');
  });

  /**
   * A move goes through `items.transfer`, not through `items.update`.
   *
   * Both change the column; only one writes the transfer row. The repository's
   * rule is the same rule the quantity follows - a location that changed with
   * no record of the change makes the transaction log untrustworthy.
   */
  it('moves an item and records the move', async () => {
    const pendingWrite = await write(deps, { kind: 'MOVE_ITEM', item: 'feijao preto',
      location: 'despensa' });

    const saved = await commit(deps, pendingWrite);
    const shelf = await deps.locations.findByName('Despensa');
    expect(committedItem(saved).locationId).toBe(shelf?.id);

    const history = await deps.items.history(committedItem(saved).id);
    expect(history[0]).toMatchObject({ type: 'transfer', notes: 'Por voz' });
  });

  it('sets a minimum, which is what the replenishment list reads', async () => {
    const pendingWrite = await write(deps, { kind: 'SET_MINIMUM', item: 'feijao preto',
      amount: 12, unit: null });

    const saved = await commit(deps, pendingWrite);
    expect(committedItem(saved).minimumQuantity).toBe(12);
  });

  it('sets a target', async () => {
    const pendingWrite = await write(deps, { kind: 'SET_TARGET', item: 'feijao preto',
      amount: 20, unit: null });

    const saved = await commit(deps, pendingWrite);
    expect(committedItem(saved).idealQuantity).toBe(20);
  });
});
