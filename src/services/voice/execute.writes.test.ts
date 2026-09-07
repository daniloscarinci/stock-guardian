import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { execute, type PendingWrite, type VoiceDeps } from './execute';
import { commit } from './commit';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

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
    await locations.create({ name: 'Despensa' });

    const feijao = await items.create({
      name: 'Feijão Preto', quantity: 4, unit: 'kg', minimumQuantity: 10,
    });
    feijaoId = feijao.id;

    deps = { items, locations, context: CONTEXT, language: 'pt-BR' };
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
      direction: 'up', transaction: 'add', unit: null });
    await execute(deps, { kind: 'SET_QUANTITY', item: 'feijao preto', amount: 3, unit: null });
    await execute(deps, { kind: 'SET_EXPIRY', item: 'feijao preto', expiresOn: '2027-01-01' });
    await execute(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: 2, unit: 'kg',
      location: null, expiresOn: null });

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
      amount: 5, direction: 'up', transaction: 'add', unit: null });
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

  it('describes an adjustment without performing it', async () => {
    const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 5, direction: 'up', transaction: 'purchase', unit: null });

    expect(write).toMatchObject({ kind: 'ADJUST', delta: 5, after: 9, transaction: 'purchase' });
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(4);
  });

  it('takes a removal to zero rather than below it, as the write would', async () => {
    const write = await pending(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 9, direction: 'down', transaction: 'consume', unit: null });

    expect(write).toMatchObject({ kind: 'ADJUST', delta: -9, after: 0 });
  });

  it('turns a correction into the signed delta that reaches it', async () => {
    const write = await pending(deps, { kind: 'SET_QUANTITY', item: 'feijao preto',
      amount: 3, unit: null });

    expect(write).toMatchObject({ kind: 'ADJUST', delta: -1, after: 3, transaction: 'correction' });
  });

  it('describes a new expiry date and the one it replaces', async () => {
    const write = await pending(deps, { kind: 'SET_EXPIRY', item: 'feijao preto',
      expiresOn: '2027-01-01' });

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
    });

    expect(result.quantity).toBe(4);
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
    await locations.create({ name: 'Despensa' });
    await items.create({ name: 'Feijão Preto', quantity: 4, unit: 'kg' });
    deps = { items, locations, context: CONTEXT, language: 'pt-BR' };
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
      amount: 6, direction: 'up', transaction: 'purchase', unit: null });

    const saved = await commit(deps, pendingWrite);
    expect(saved.quantity).toBe(10);

    const history = await deps.items.history(saved.id);
    expect(history[0]).toMatchObject({ type: 'purchase', notes: 'Por voz', quantity_after: 10 });
  });

  it('creates an item with the defaults it was not told', async () => {
    const pendingWrite = await write(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: null,
      unit: null, location: null, expiresOn: null });

    const created = await commit(deps, pendingWrite);
    expect(created).toMatchObject({
      name: 'quinoa', quantity: 1, unit: 'un', locationId: null, expirationDate: null,
    });
  });

  it('creates an item on the shelf that was named', async () => {
    const pendingWrite = await write(deps, { kind: 'CREATE_ITEM', name: 'quinoa', amount: 2,
      unit: 'kg', location: 'despensa', expiresOn: '2027-03-01' });

    const created = await commit(deps, pendingWrite);
    const shelf = await deps.locations.findByName('Despensa');
    expect(created).toMatchObject({ quantity: 2, unit: 'kg', expirationDate: '2027-03-01' });
    expect(created.locationId).toBe(shelf?.id);
  });

  it('sets an expiry date', async () => {
    const pendingWrite = await write(deps, { kind: 'SET_EXPIRY', item: 'feijao preto',
      expiresOn: '2027-01-01' });

    const saved = await commit(deps, pendingWrite);
    expect(saved.expirationDate).toBe('2027-01-01');
  });
});
