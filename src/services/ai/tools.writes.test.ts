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
import { TOOLS, runTool, type AiDeps } from './tools';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

const WRITE_SQL = /^\s*(?:insert|update|delete)/i;

describe('ai tools: writes stay proposals', () => {
  let db: SqlDriver;
  let deps: AiDeps;
  let feijaoId: string;
  let despensaId: string;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);

    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    const catalog = createCatalogRepository(db);
    const despensa = await locations.create({ name: 'Despensa' });
    despensaId = despensa.id;

    // No location and no target, on purpose. "On no shelf" and "no target set"
    // are the two absences `move_item` and `set_target` have to carry through
    // as null, and a row that had either would never exercise that path.
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
    await propose('move_item', { item: 'feijao preto', location: 'despensa' });
    await propose('set_minimum', { item: 'feijao preto', minimum: 12 });
    await propose('set_target', { item: 'feijao preto', target: 20 });
    const create = await propose('create_item', { name: 'quinoa', quantity: 2, unit: 'kg' });
    await propose('create_location', { name: 'cellar' });
    await propose('create_category', { name: 'pets' });

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
    const locationsBefore = await deps.locations.list();
    const categoriesBefore = await deps.categories.list();

    await propose('adjust_quantity', { item: 'feijao preto', amount: 5, direction: 'up' });
    await propose('set_quantity', { item: 'feijao preto', quantity: 99 });
    await propose('set_expiry', { item: 'feijao preto', expires_on: '2027-01-01' });
    await propose('move_item', { item: 'feijao preto', location: 'despensa' });
    await propose('set_minimum', { item: 'feijao preto', minimum: 12 });
    await propose('set_target', { item: 'feijao preto', target: 20 });
    await propose('create_item', { name: 'quinoa' });
    await propose('create_location', { name: 'cellar' });
    await propose('create_category', { name: 'pets' });

    expect(await deps.items.getById(feijaoId)).toEqual(before);
    expect(await deps.items.history(feijaoId)).toHaveLength(0);

    const all = await deps.items.list(CONTEXT, { filters: { search: 'quinoa' } });
    expect(all.rows).toHaveLength(0);

    // create_location and create_category each propose a row rather than
    // insert one, so the tables they would land in are the honest witness -
    // `getById` above only ever watched the item table.
    expect(await deps.locations.list()).toEqual(locationsBefore);
    expect(await deps.categories.list()).toEqual(categoriesBefore);
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
      await propose('move_item', { item: 'feijao preto', location: 'despensa' }),
      await propose('set_minimum', { item: 'feijao preto', minimum: 12 }),
      await propose('set_target', { item: 'feijao preto', target: 20 }),
      await propose('create_item', { name: 'quinoa', quantity: 2 }),
      await propose('create_location', { name: 'cellar' }),
      await propose('create_category', { name: 'pets' }),
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

  /*
   * `tools.reads.test` asserts this over the four writing tools that came
   * first; the three added later are asserted here, where they were added.
   * The reason is the same one: the description is everything the model reads
   * before it chooses, so a model that believes it has changed the stock will
   * report that it did, and the user is then shown a confirmation card for a
   * change they have just been told is finished.
   */
  it('says in each of the three newer writing descriptions that it only proposes', () => {
    for (const name of ['move_item', 'set_minimum', 'set_target']) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.description, name).toMatch(/PROPOSE/);
      expect(tool?.description, name).toMatch(/THIS DOES NOT CHANGE ANYTHING - it only proposes/);
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

  describe('move_item', () => {
    it('proposes a move without writing it', async () => {
      const write = await propose('move_item', { item: 'feijao preto', location: 'despensa' });

      expect(write).toMatchObject({
        kind: 'MOVE',
        // The shelf it is leaving, by id for the undo and by name for the
        // card. null is the answer, not a gap in one: it was on none.
        fromLocationId: null,
        fromLocationName: null,
        to: { kind: 'existing', id: despensaId, name: 'Despensa' },
      });

      // `commit` moves an item with `items.transfer`, which writes the shelf
      // and a `transfer` row inside one transaction. Neither happened.
      expect((await deps.items.getById(feijaoId))?.locationId).toBeNull();
      expect(await deps.items.history(feijaoId)).toHaveLength(0);
    });

    it('flags a place matched by containing its name, not by being it', async () => {
      const write = await propose('move_item', { item: 'feijao preto', location: 'desp' });
      expect(write.assumptions).toContain('location');
    });

    it('does not flag a place named exactly, accents and case aside', async () => {
      const write = await propose('move_item', { item: 'feijao preto', location: 'despensa' });
      expect(write.assumptions).not.toContain('location');
    });

    /*
     * Refused here, where a parsed sentence now offers to make the place - the
     * same split `create_item` makes, for the same reason.
     *
     * A parsed sentence gets one shot: it is all the user is going to say, so
     * the card asking "shall I make it?" is the only way "move the rice to the
     * cellar" gets anywhere. This tool sits in a loop with `list_locations` in
     * reach, so it can find out and then say what it means. A model that
     * invented the place would be choosing twice over - the place and the
     * wording - with one card shown for both.
     */
    it('proposes nothing when the place it was told does not exist', async () => {
      const run = await runTool(deps, 'move_item', { item: 'feijao preto', location: 'garagem' });
      expect(run.proposal).toBeNull();
      expect(JSON.parse(run.result)).toMatchObject({ status: 'not proposed' });
      expect((await deps.items.getById(feijaoId))?.locationId).toBeNull();
    });

    // `items.transfer` records a `transfer` row whatever the shelves are, so a
    // move onto the shelf the item is already on is a history entry saying it
    // went from a place to itself. There is nothing to confirm.
    it('answers rather than proposing a move to where the item already is', async () => {
      await deps.items.transfer(feijaoId, despensaId);

      const run = await runTool(deps, 'move_item', { item: 'feijao preto', location: 'despensa' });
      expect(run.proposal).toBeNull();
      expect(JSON.parse(run.result)).toMatchObject({ status: 'no change' });
    });
  });

  describe('set_minimum', () => {
    it('proposes the level without writing it, and says which one it replaces', async () => {
      const write = await propose('set_minimum', { item: 'feijao preto', minimum: 12 });

      expect(write).toMatchObject({ kind: 'MINIMUM', before: 10, after: 12 });
      expect((await deps.items.getById(feijaoId))?.minimumQuantity).toBe(10);
    });

    /*
     * null and 0 are different answers, and the undo is where the difference
     * shows. `null` means no minimum was ever set, so `evaluateStock` stands
     * the global threshold in its place; `0` means one was set to nothing, and
     * stays zero. An undo handed 0 where it should have had null would lower
     * the bar on an item whose owner never touched it, so the stored value is
     * read as it is - `minimumQuantity`, and never `effectiveMinimum`, which
     * is never null because it is the one the fallback has been applied to.
     */
    it('carries null, not zero, for an item that never had a minimum', async () => {
      await deps.items.create({ name: 'Arroz', quantity: 2, unit: 'kg' });

      const write = await propose('set_minimum', { item: 'arroz', minimum: 5 });
      expect(write).toMatchObject({ kind: 'MINIMUM', before: null, after: 5 });
    });

    it('proposes a minimum of zero, which is a level and not an absence', async () => {
      const write = await propose('set_minimum', { item: 'feijao preto', minimum: 0 });
      expect(write).toMatchObject({ kind: 'MINIMUM', before: 10, after: 0 });
    });

    it('answers rather than proposing the level the item already has', async () => {
      const run = await runTool(deps, 'set_minimum', { item: 'feijao preto', minimum: 10 });
      expect(run.proposal).toBeNull();
      expect(JSON.parse(run.result)).toMatchObject({ status: 'no change' });
    });

    it('refuses a level below zero rather than clamping one', async () => {
      const run = await runTool(deps, 'set_minimum', { item: 'feijao preto', minimum: -1 });
      expect(run.isError).toBe(true);
      expect(run.proposal).toBeNull();
    });
  });

  describe('set_target', () => {
    it('proposes the level without writing it', async () => {
      const write = await propose('set_target', { item: 'feijao preto', target: 20 });

      // null, because nothing set one - the same distinction the minimum makes,
      // against the `idealQuantity` column rather than `minimumQuantity`.
      expect(write).toMatchObject({ kind: 'TARGET', before: null, after: 20 });
      expect((await deps.items.getById(feijaoId))?.idealQuantity).toBeNull();
    });

    it('says which level it would replace when the item has one', async () => {
      await deps.items.update(feijaoId, { idealQuantity: 20 });

      const write = await propose('set_target', { item: 'feijao preto', target: 30 });
      expect(write).toMatchObject({ kind: 'TARGET', before: 20, after: 30 });
    });

    it('answers rather than proposing the level the item already has', async () => {
      await deps.items.update(feijaoId, { idealQuantity: 20 });

      const run = await runTool(deps, 'set_target', { item: 'feijao preto', target: 20 });
      expect(run.proposal).toBeNull();
      expect(JSON.parse(run.result)).toMatchObject({ status: 'no change' });
    });
  });

  /*
   * A NAME THAT IS TAKEN IS ANSWERED, NOT MADE TWICE - the same rule
   * `execute.writes.test` asserts over CREATE_LOCATION, and for the same
   * reason: `findLocation` matches on CONTAINS, so a second "cellar" over a
   * house that already has one would be indistinguishable from the first on
   * every screen that lists them, and stock would start landing on either.
   */
  describe('create_location', () => {
    it('proposes a place without writing it', async () => {
      const before = await deps.locations.list();

      const write = await propose('create_location', { name: 'cellar' });
      expect(write).toMatchObject({ kind: 'NEW_LOCATION', name: 'cellar' });

      expect(await deps.locations.list()).toEqual(before);
    });

    it('answers rather than proposing a place that already exists', async () => {
      const before = await deps.locations.list();

      const run = await runTool(deps, 'create_location', { name: 'despensa' });
      expect(run.proposal).toBeNull();
      const body = JSON.parse(run.result) as Record<string, unknown>;
      expect(body.status).toBe('not proposed');
      // Names the row that was found, so the model can pass the same name on
      // to list_items instead of asking the user to describe it again.
      expect(String(body.reason)).toMatch(/Despensa/);

      expect(await deps.locations.list()).toEqual(before);
    });
  });

  /*
   * The same rule as create_location's, over the other table `execute.ts`
   * refuses to duplicate: a category is a heading the preparedness score can
   * be averaged over, and a second "tools" nobody can tell from the first
   * would file some items under each and answer "what is in tools" falsely
   * for both.
   */
  describe('create_category', () => {
    it('proposes a category without writing it', async () => {
      const before = await deps.categories.list();

      const write = await propose('create_category', { name: 'pets' });
      expect(write).toMatchObject({ kind: 'NEW_CATEGORY', name: 'pets' });

      expect(await deps.categories.list()).toEqual(before);
    });

    it('answers rather than proposing a category that already exists', async () => {
      const before = await deps.categories.list();

      // Matched against every language a category is named in, not only the
      // interface language - "tools" finds the row named Ferramentas in
      // pt-BR - and the refusal reports the name back in the language this
      // deps.language is set to, the same as every other tool's answers.
      const run = await runTool(deps, 'create_category', { name: 'tools' });
      expect(run.proposal).toBeNull();
      const body = JSON.parse(run.result) as Record<string, unknown>;
      expect(body.status).toBe('not proposed');
      expect(String(body.reason)).toMatch(/Ferramentas/);

      expect(await deps.categories.list()).toEqual(before);
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
