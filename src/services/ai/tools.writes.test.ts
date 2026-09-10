/**
 * The property this whole feature rests on: a model's sentence never reaches
 * the database unattended.
 *
 * The same structural test `execute.writes.test.ts` runs over the parser, run
 * again over the tools, and for the same reason. A spy on `db.exec` alone is
 * BLIND to an adjustment: `adjustQuantity` writes inside `db.transaction`,
 * whose `tx.exec` calls the driver primitive directly and never passes through
 * `db.exec`. So both are watched, and each test commits afterwards to prove
 * the spies fire when something really is written - otherwise this would pass
 * just as happily because nothing was being watched at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createCategoriesRepository } from '../../repositories/categories.repository';
import { createContactsRepository } from '../../repositories/contacts.repository';
import { createCatalogRepository } from '../../repositories/catalog.repository';
import { commit } from '../voice/commit';
import type { PendingWrite } from '../voice/execute';
import { runTool, type AiDeps } from './tools';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

const WRITE_SQL = /^\s*(?:insert|update|delete)/i;

describe('ai tools: writes stay proposals', () => {
  let db: SqlDriver;
  let deps: AiDeps;
  let feijaoId: string;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);

    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    const catalog = createCatalogRepository(db);
    await locations.create({ name: 'Despensa' });

    const feijao = await items.create({
      name: 'Feijão Preto', quantity: 4, unit: 'kg', minimumQuantity: 10,
    });
    feijaoId = feijao.id;

    deps = {
      items, locations, categories, contacts, catalog,
      context: CONTEXT, language: 'pt-BR', trackedCategoryIds: [], dismissedItemIds: [],
    };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  /** The proposal a tool produced, or a failure naming what came back instead. */
  async function propose(name: string, input: unknown): Promise<PendingWrite> {
    const run = await runTool(deps, name, input);
    if (run.proposal === null) throw new Error(`${name} proposed nothing: ${run.result}`);
    return run.proposal;
  }

  const writes = (calls: [unknown, ...unknown[]][]): unknown[] =>
    calls.filter(([sql]) => WRITE_SQL.test(String(sql)));

  it('sends no INSERT, UPDATE or DELETE and opens no transaction, for any writing tool', async () => {
    const exec = vi.spyOn(db, 'exec');
    const transaction = vi.spyOn(db, 'transaction');
    const batch = vi.spyOn(db, 'batch');

    const adjust = await propose('adjust_quantity', {
      item: 'feijao preto', amount: 5, direction: 'up',
    });
    await propose('set_quantity', { item: 'feijao preto', quantity: 3 });
    await propose('set_expiry', { item: 'feijao preto', expires_on: '2027-01-01' });
    const create = await propose('create_item', { name: 'quinoa', quantity: 2, unit: 'kg' });

    expect(writes(exec.mock.calls)).toHaveLength(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();

    // And the same spies see it the moment something really is written, so the
    // assertions above cannot be passing because nothing was watched.
    await commit(deps, adjust);
    expect(transaction).toHaveBeenCalledTimes(1);
    await commit(deps, create);
    expect(exec.mock.calls.filter(([sql]) => /^\s*insert/i.test(String(sql)))).not.toHaveLength(0);
  });

  it('leaves every row exactly as it found it', async () => {
    const before = await deps.items.getById(feijaoId);

    await propose('adjust_quantity', { item: 'feijao preto', amount: 5, direction: 'up' });
    await propose('set_quantity', { item: 'feijao preto', quantity: 99 });
    await propose('set_expiry', { item: 'feijao preto', expires_on: '2027-01-01' });
    await propose('create_item', { name: 'quinoa' });

    expect(await deps.items.getById(feijaoId)).toEqual(before);
    expect(await deps.items.history(feijaoId)).toHaveLength(0);

    const all = await deps.items.list(CONTEXT, { filters: { search: 'quinoa' } });
    expect(all.rows).toHaveLength(0);
  });

  /*
   * `certainty` decides who may call `commit` without asking. `explicit` means
   * the user's own words named an exact item and an exact amount - a case a
   * sentence that has been through a model does not have, ever. The model
   * chose the row; the user did not say it.
   */
  it('marks every proposal assumed, with a reason the card can show', async () => {
    const proposals = [
      await propose('adjust_quantity', { item: 'feijao preto', amount: 5, direction: 'up' }),
      await propose('set_quantity', { item: 'feijão preto', quantity: 3 }),
      await propose('set_expiry', { item: 'feijao preto', expires_on: '2027-01-01' }),
      await propose('create_item', { name: 'quinoa', quantity: 2 }),
    ];

    for (const proposal of proposals) {
      expect(proposal.certainty, proposal.kind).toBe('assumed');
      expect(proposal.assumptions.length, proposal.kind).toBeGreaterThan(0);
      // And the first reason names who chose. `item` - "you did not say its
      // whole name" - is the parser's reason for a loose match and says
      // nothing true about a row a model picked out of a tool result.
      expect(proposal.assumptions[0], proposal.kind).toBe('assistant');
      expect(proposal.assumptions, proposal.kind).not.toContain('item');
    }
  });

  describe('adjust_quantity', () => {
    it('describes the change without performing it', async () => {
      const write = await propose('adjust_quantity', {
        item: 'feijao preto', amount: 5, direction: 'up', transaction: 'purchase',
      });

      expect(write).toMatchObject({ kind: 'ADJUST', delta: 5, after: 9, transaction: 'purchase' });
      expect((await deps.items.getById(feijaoId))?.quantity).toBe(4);
    });

    it('takes a removal to zero rather than below it, as the write would', async () => {
      const write = await propose('adjust_quantity', {
        item: 'feijao preto', amount: 9, direction: 'down',
      });
      expect(write).toMatchObject({ kind: 'ADJUST', delta: -9, after: 0, transaction: 'consume' });
    });

    it('flags a unit the item is not kept in, because the number means something else', async () => {
      const write = await propose('adjust_quantity', {
        item: 'feijao preto', amount: 2, direction: 'up', unit: 'latas',
      });
      expect(write.assumptions).toContain('unit');
    });

    it('does not flag the unit the item is already kept in', async () => {
      const write = await propose('adjust_quantity', {
        item: 'feijao preto', amount: 2, direction: 'up', unit: 'kg',
      });
      expect(write.assumptions).not.toContain('unit');
    });

    it('answers rather than proposing a change of nothing', async () => {
      const run = await runTool(deps, 'set_quantity', { item: 'feijao preto', quantity: 4 });
      expect(run.proposal).toBeNull();
      expect(JSON.parse(run.result)).toMatchObject({ status: 'no change' });
    });
  });

  describe('set_quantity', () => {
    it('turns a correction into the signed delta that reaches it', async () => {
      const write = await propose('set_quantity', { item: 'feijao preto', quantity: 10 });
      expect(write).toMatchObject({
        kind: 'ADJUST', delta: 6, after: 10, transaction: 'correction',
      });
    });
  });

  describe('set_expiry', () => {
    it('describes the new date and the one it would replace', async () => {
      const write = await propose('set_expiry', {
        item: 'feijao preto', expires_on: '2027-01-01',
      });
      expect(write).toMatchObject({ kind: 'EXPIRY', before: null, after: '2027-01-01' });
      expect(write.assumptions).toContain('date');
      expect((await deps.items.getById(feijaoId))?.expirationDate).toBeNull();
    });

    it('refuses a date that is not a date rather than guessing one', async () => {
      const run = await runTool(deps, 'set_expiry', {
        item: 'feijao preto', expires_on: 'next January',
      });
      expect(run.isError).toBe(true);
      expect(run.proposal).toBeNull();
    });
  });

  describe('create_item', () => {
    it('fills in the quantity and unit it was not given, and says it did', async () => {
      const write = await propose('create_item', { name: 'quinoa' });
      expect(write).toMatchObject({ kind: 'CREATE', name: 'quinoa', quantity: 1, unit: 'un' });
      expect(write.assumptions).toEqual(['assistant', 'newItem', 'quantity']);
    });

    it('names the location it was given, so the card can show it', async () => {
      const write = await propose('create_item', {
        name: 'quinoa', quantity: 2, unit: 'kg', location: 'despensa',
      });
      expect(write).toMatchObject({
        location: { kind: 'existing', name: 'Despensa' }, quantity: 2, unit: 'kg',
      });
    });

    /*
     * Still refused here, where a parsed sentence now offers to make the place.
     *
     * The two paths are not the same conversation. A parsed sentence is all
     * the user is going to say, so the card is the only chance to settle it.
     * This tool is inside a loop that can ask, and a person who said "the
     * garage" about a house that has none is better served by being read their
     * own shelves than by acquiring a second one under a name they did not
     * choose.
     */
    it('proposes nothing when the place it was told does not exist', async () => {
      const run = await runTool(deps, 'create_item', { name: 'quinoa', location: 'garagem' });
      expect(run.proposal).toBeNull();
      expect(JSON.parse(run.result)).toMatchObject({ status: 'not proposed' });
    });
  });

  describe('what Claude is told', () => {
    /*
     * The model reports back whatever the tool result said. A result that read
     * like a receipt would produce "done - beans are now 9 kg", and the user
     * would then be shown a card asking them to approve a change they had just
     * been told was finished.
     */
    it('says the change is proposed and waiting, never that it happened', async () => {
      const run = await runTool(deps, 'adjust_quantity', {
        item: 'feijao preto', amount: 5, direction: 'up',
      });
      const body = JSON.parse(run.result) as Record<string, unknown>;

      expect(body.status).toBe('proposed');
      expect(String(body.awaiting)).toMatch(/confirmation/);
      expect(String(body.note)).toMatch(/Nothing has changed/);
    });
  });

  describe('what is not offered', () => {
    it('has no tool that removes an item, however it is asked for', async () => {
      for (const name of ['delete_item', 'remove_item', 'archive_item', 'empty_category']) {
        const run = await runTool(deps, name, { item: 'feijao preto' });
        expect(run.isError, name).toBe(true);
        expect(run.proposal, name).toBeNull();
      }
      expect((await deps.items.getById(feijaoId))?.quantity).toBe(4);
    });
  });
});
