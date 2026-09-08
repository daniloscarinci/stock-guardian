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
import { evaluatePreparedness } from '../../domain/preparedness';
import { buildReplenishmentList } from '../../domain/replenishment';
import { TOOLS, runTool, type AiDeps } from './tools';

const TODAY = '2026-09-07';
const CONTEXT: ItemContext = { today: TODAY, defaultThreshold: 5, expiryWindows: [7, 30, 90] };

describe('ai tools: reading', () => {
  let db: SqlDriver;
  let deps: AiDeps;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);

    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    const catalog = createCatalogRepository(db);

    const pantry = await locations.create({ name: 'Despensa' });
    const shelf = await locations.create({ name: 'Prateleira de Cima', parentId: pantry.id });

    // Created empty and then moved three times, so the rice has a history and
    // still ends on the twelve kilos the other tests read.
    const rice = await items.create({
      name: 'Arroz Branco', quantity: 0, unit: 'kg', minimumQuantity: 10,
      categoryId: 'food', locationId: pantry.id,
    });
    await items.adjustQuantity(rice.id, 10, { type: 'purchase', occurredAt: '2026-06-01T09:00:00.000Z' });
    await items.adjustQuantity(rice.id, -3, { type: 'consume', occurredAt: '2026-07-15T09:00:00.000Z' });
    await items.adjustQuantity(rice.id, 5, { type: 'purchase', occurredAt: '2026-08-20T09:00:00.000Z' });
    await items.create({
      name: 'Feijão Preto', quantity: 4, unit: 'kg', minimumQuantity: 10,
      categoryId: 'food', locationId: shelf.id,
    });
    await items.create({
      name: 'Água Mineral', quantity: 0, unit: 'l', minimumQuantity: 20, categoryId: 'water',
    });
    await items.create({
      name: 'Leite', quantity: 2, unit: 'l', minimumQuantity: 1, categoryId: 'food',
      expirationDate: '2026-09-20',
    });
    await items.create({
      name: 'Iogurte Natural', quantity: 1, unit: 'un', minimumQuantity: 1, categoryId: 'food',
      expirationDate: '2026-08-01',
    });

    /*
     * Priorities deliberately fight the alphabet. Sorted by name the doctor
     * comes first and the son-in-law who must be rung before anyone else comes
     * last, which is the ordering mistake the tool exists to avoid.
     */
    await contacts.create({ name: 'Ana Ferreira', relationship: 'Médica', phone: '11 3333-0001', priority: 3 });
    await contacts.create({
      name: 'José da Silva', relationship: 'Genro', phone: '11 99999-0002',
      email: 'jose@example.com', priority: 1,
    });
    await contacts.create({ name: 'Bombeiros', relationship: 'Emergência', phone: '193', priority: 2 });

    deps = {
      items, locations, categories, contacts, catalog,
      context: CONTEXT, language: 'pt-BR', trackedCategoryIds: [], dismissedItemIds: [],
    };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  /** A tool's result, parsed. Every tool answers in JSON and nothing else. */
  async function read(name: string, input: unknown = {}): Promise<Record<string, unknown>> {
    const run = await runTool(deps, name, input);
    expect(run.isError, `${name} errored: ${run.result}`).toBe(false);
    // A reading tool must never propose. That is the writing tools' whole job.
    expect(run.proposal, name).toBeNull();
    return JSON.parse(run.result) as Record<string, unknown>;
  }

  describe('the surface Claude is offered', () => {
    it('offers no way to delete, archive or empty anything', () => {
      const names = TOOLS.map((tool) => tool.name);
      for (const forbidden of ['delete', 'remove', 'archive', 'empty', 'clear', 'bulk']) {
        expect(names.filter((name) => name.includes(forbidden)), forbidden).toEqual([]);
      }
    });

    it('describes every tool, because a description is how one gets picked', () => {
      for (const tool of TOOLS) {
        expect(tool.description, tool.name).toBeDefined();
        expect((tool.description ?? '').length, tool.name).toBeGreaterThan(80);
      }
    });

    /*
     * A model that believes it changed the stock says so, and the user then
     * reads a confirmation card for something they were told was already done.
     * The only defence is the description, so it is asserted rather than
     * trusted.
     */
    /*
     * The catalog is a list of things the household could hold and the
     * inventory is a list of things it does. A model that confuses them tells
     * somebody they have water when the water category is empty - the one
     * answer in this application that could get a person hurt. The warning
     * lives in the description, which is all Claude reads before choosing, so
     * it is asserted here rather than trusted to survive an edit.
     */
    it('warns in search_catalog that the catalog is not the stock', () => {
      const tool = TOOLS.find((candidate) => candidate.name === 'search_catalog');
      expect(tool?.description).toMatch(/RECOMMENDATIONS, NOT WHAT THE USER OWNS/);
    });

    it('says in every writing description that it only proposes', () => {
      const writers = ['adjust_quantity', 'set_quantity', 'create_item', 'set_expiry'];
      for (const name of writers) {
        const tool = TOOLS.find((candidate) => candidate.name === name);
        expect(tool, name).toBeDefined();
        expect(tool?.description, name).toMatch(/PROPOSE/);
        expect(tool?.description, name).toMatch(/does not (change|create) anything/i);
      }
    });
  });

  describe('find_item', () => {
    it('returns the row the repository holds', async () => {
      const body = await read('find_item', { name: 'arroz' });
      expect(body).toMatchObject({
        found: 'one',
        item: { name: 'Arroz Branco', quantity: 12, unit: 'kg', location: 'Despensa' },
      });
    });

    it('matches an unaccented, partial name the way a person types it', async () => {
      expect(await read('find_item', { name: 'feijao' })).toMatchObject({
        item: { name: 'Feijão Preto', quantity: 4 },
      });
    });

    it('hands back the tie rather than picking one', async () => {
      const body = await read('find_item', { name: 'a' });
      expect(body.found).toBe('many');
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('says nothing was found rather than inventing a row', async () => {
      expect(await read('find_item', { name: 'quinoa' })).toMatchObject({
        found: 'none', searched_for: 'quinoa',
      });
    });

    /* Not an inventory dump: an id is thirty-six characters no tool accepts. */
    it('sends no database ids', async () => {
      const run = await runTool(deps, 'find_item', { name: 'arroz' });
      expect(run.result).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    });
  });

  describe('list_items', () => {
    it('narrows by location, and reaches into what is inside it', async () => {
      const body = await read('list_items', { location: 'despensa' });
      const names = (body.items as { name: string }[]).map((item) => item.name);
      expect(names).toContain('Arroz Branco');
      expect(names).toContain('Feijão Preto');
    });

    it('narrows by category, named the way list_categories names it', async () => {
      const body = await read('list_items', { category: 'Água' });
      expect(body).toMatchObject({ matched: 1 });
      expect((body.items as { name: string }[])[0]?.name).toBe('Água Mineral');
    });

    it('narrows by stock level', async () => {
      const body = await read('list_items', { stock_status: 'critical' });
      const names = (body.items as { name: string }[]).map((item) => item.name);
      expect(names).toContain('Água Mineral');
      expect(names).not.toContain('Arroz Branco');
    });

    it('says which place it does not know instead of listing everything', async () => {
      expect(await read('list_items', { location: 'garagem' })).toMatchObject({
        matched: 0, showing: 0,
      });
    });

    it('caps the rows and says it capped them', async () => {
      await deps.items.createMany(
        Array.from({ length: 60 }, (_, index) => ({
          name: `Enlatado ${String(index).padStart(2, '0')}`,
          quantity: 1,
          categoryId: 'tools',
        })),
      );

      const body = await read('list_items', { category: 'Ferramentas' });
      expect(body.matched).toBe(60);
      expect(body.showing).toBe(50);
      expect(body.note).toMatch(/first 50 of 60/);
    });
  });

  describe('whats_expiring', () => {
    it("defaults to the user's own warning window", async () => {
      const body = await read('whats_expiring');
      expect(body.within_days).toBe(7);
      const names = (body.items as { name: string }[]).map((item) => item.name);
      // Already past, so it survives however narrow the window is.
      expect(names).toContain('Iogurte Natural');
      expect(names).not.toContain('Leite');
    });

    it('widens to the window it is given', async () => {
      const body = await read('whats_expiring', { within_days: 30 });
      const names = (body.items as { name: string }[]).map((item) => item.name);
      expect(names).toContain('Leite');
      expect(names).toContain('Iogurte Natural');
    });

    it('returns only what has spoiled when asked for that', async () => {
      const body = await read('whats_expiring', { within_days: 365, expired_only: true });
      expect((body.items as { name: string }[]).map((item) => item.name)).toEqual([
        'Iogurte Natural',
      ]);
    });
  });

  describe('whats_missing', () => {
    it('is the replenishment list the rest of the application builds', async () => {
      const expected = buildReplenishmentList({
        items: await deps.items.listForAnalysis(),
        today: TODAY,
        defaultThreshold: CONTEXT.defaultThreshold,
        expiryWindows: CONTEXT.expiryWindows,
      });

      const body = await read('whats_missing');
      expect(body.matched).toBe(expected.length);
      expect((body.items as { name: string }[]).map((item) => item.name)).toEqual(
        expected.slice(0, 50).map((line) => line.name),
      );
    });

    it('asks for the whole target of something spoiled, not the shortfall', async () => {
      const body = await read('whats_missing');
      const yoghurt = (body.items as { name: string; reason: string; to_acquire: number }[]).find(
        (line) => line.name === 'Iogurte Natural',
      );
      expect(yoghurt).toMatchObject({ reason: 'expired', to_acquire: 1 });
    });

    /*
     * The defect this test exists to keep fixed.
     *
     * Dismissing an item on the Replenishment screen is a decision - "I know,
     * and I am not restocking it" - and the tool used to ignore it entirely.
     * Claude would then tell someone to buy the thing they had just taken off
     * the list, and cite the application for it. The screen, the parser and
     * this tool now read the same list from the same field.
     */
    it('leaves out an item the user dismissed from the list', async () => {
      const before = await read('whats_missing');
      const names = (body: Record<string, unknown>) =>
        (body.items as { name: string }[]).map((line) => line.name);
      const dropped = names(before)[0];
      expect(dropped).toBeDefined();

      const lines = buildReplenishmentList({
        items: await deps.items.listForAnalysis(),
        today: TODAY,
        defaultThreshold: CONTEXT.defaultThreshold,
        expiryWindows: CONTEXT.expiryWindows,
      });
      const dismissed = lines.find((line) => line.name === dropped);
      if (dismissed === undefined) throw new Error('the fixture has nothing to dismiss');

      const after = await runTool(
        { ...deps, dismissedItemIds: [dismissed.itemId] },
        'whats_missing',
        {},
      );
      const body = JSON.parse(after.result) as Record<string, unknown>;
      expect(names(body)).not.toContain(dropped);
      expect(body.matched).toBe((before.matched as number) - 1);
    });
  });

  describe('preparedness_score', () => {
    /*
     * The number in an answer has to be the number on the dashboard. Any
     * second calculation here - a flat percentage of healthy items, say -
     * would be easier and would disagree with the screen the moment a category
     * ran empty, which is precisely the case the score exists to expose.
     */
    it('is the figure evaluatePreparedness gives for the same data', async () => {
      const expected = evaluatePreparedness({
        items: await deps.items.listForAnalysis(),
        today: TODAY,
        defaultThreshold: CONTEXT.defaultThreshold,
        trackedCategoryIds: [],
        expiryWindows: CONTEXT.expiryWindows,
      });

      const body = await read('preparedness_score');
      expect(body.score).toBe(expected.score);
      expect(body.out_of).toBe(100);
    });

    it('follows the categories the user chose to be scored on', async () => {
      deps = { ...deps, trackedCategoryIds: ['water'] };
      const expected = evaluatePreparedness({
        items: await deps.items.listForAnalysis(),
        today: TODAY,
        defaultThreshold: CONTEXT.defaultThreshold,
        trackedCategoryIds: ['water'],
        expiryWindows: CONTEXT.expiryWindows,
      });

      const body = await read('preparedness_score');
      expect(body.score).toBe(expected.score);
      expect(expected.score).toBe(0); // empty water, and nothing to hide it
    });

    it('names the weak categories in words rather than slugs', async () => {
      const body = await read('preparedness_score');
      const names = (body.weakest_categories as { category: string }[]).map((row) => row.category);
      expect(names).toContain('Água');
    });
  });

  describe('list_locations', () => {
    it('returns every place, with its path and what it holds', async () => {
      const body = await read('list_locations');
      const places = body.locations as { place: string; items: number }[];
      expect(places.map((place) => place.place)).toEqual([
        'Despensa',
        'Despensa / Prateleira de Cima',
      ]);
      expect(places[0]?.items).toBe(1);
    });
  });

  describe('list_categories', () => {
    it("names categories in the user's language", async () => {
      const body = await read('list_categories');
      const names = (body.categories as { name: string }[]).map((row) => row.name);
      expect(names).toContain('Alimentos');
      expect(names).toContain('Água');
    });

    it('counts what each one holds', async () => {
      const body = await read('list_categories');
      const food = (body.categories as { name: string; items: number }[]).find(
        (row) => row.name === 'Alimentos',
      );
      expect(food?.items).toBe(4);
    });
  });

  describe('stock_summary', () => {
    /*
     * The overview has to be the dashboard's overview. A second count computed
     * here would drift the first time either definition of "low" changed, and
     * the disagreement would surface as an assistant contradicting the screen
     * the user is looking at while they read it.
     */
    it('is the figure dashboardStats gives for the same data', async () => {
      const expected = await deps.items.dashboardStats(CONTEXT);
      expect(await read('stock_summary')).toMatchObject({
        total_items: expected.totalItems,
        total_quantity: expected.totalQuantity,
        categories_used: expected.categoriesUsed,
        places_used: expected.locationsUsed,
        critical: expected.critical,
        low: expected.low,
        expired: expected.expired,
        expiring_today: expected.expiringToday,
        expiring_soon: expected.expiringSoon,
        no_expiry_date: expected.noExpiration,
        archived: expected.archived,
      });
    });

    it('counts the stock in front of it', async () => {
      const body = await read('stock_summary');
      expect(body.total_items).toBe(5);
      expect(body.expired).toBe(1); // the yoghurt, three days past
      expect(body.critical).toBeGreaterThan(0); // the empty water
      expect(body.archived).toBe(0);
    });

    it('moves an archived item out of the total and into archived', async () => {
      const before = await read('stock_summary');
      const leite = (await deps.items.list(CONTEXT, { filters: { search: 'Leite' } })).rows[0];
      if (leite === undefined) throw new Error('the fixture lost its milk');
      await deps.items.archive(leite.id);

      const after = await read('stock_summary');
      expect(after.total_items).toBe((before.total_items as number) - 1);
      expect(after.archived).toBe(1);
    });
  });

  describe('item_history', () => {
    it('returns the movements newest first, with what each one changed by', async () => {
      const body = await read('item_history', { item: 'arroz' });
      expect(body).toMatchObject({
        item: 'Arroz Branco', unit: 'kg', quantity_now: 12, showing: 3,
      });
      expect(body.movements).toEqual([
        { type: 'purchase', change: 5, quantity_after: 12, date: '2026-08-20' },
        { type: 'consume', change: -3, quantity_after: 7, date: '2026-07-15' },
        { type: 'purchase', change: 10, quantity_after: 10, date: '2026-06-01' },
      ]);
    });

    it('resolves the item the way every other tool resolves it', async () => {
      expect(await read('item_history', { item: 'feijao' })).toMatchObject({
        item: 'Feijão Preto',
      });
    });

    it('takes the newest few when given a limit', async () => {
      const body = await read('item_history', { item: 'arroz', limit: 1 });
      expect(body.showing).toBe(1);
      expect((body.movements as { change: number }[])[0]?.change).toBe(5);
    });

    /*
     * An item nobody has adjusted is not a missing item, and saying so is the
     * difference between "you have not touched it since you added it" and the
     * model reporting that the milk does not exist.
     */
    it('reports an item that has never moved, rather than reading as not found', async () => {
      const body = await read('item_history', { item: 'leite' });
      expect(body).toMatchObject({ item: 'Leite', showing: 0, movements: [] });
      expect(String(body.note)).toMatch(/No movement/i);
    });

    it('says nothing was found rather than inventing a history', async () => {
      expect(await read('item_history', { item: 'quinoa' })).toMatchObject({
        found: 'none', searched_for: 'quinoa',
      });
    });
  });

  describe('search_catalog', () => {
    it('returns reference entries, named in the language the user reads', async () => {
      const body = await read('search_catalog', { query: 'agua' });
      const names = (body.recommendations as { recommended: string }[]).map((row) => row.recommended);
      expect(names).toContain('Água Mineral');
      expect(names).toContain('Filtro de Água Portátil');
    });

    it('narrows to a category named the way list_categories names it', async () => {
      const body = await read('search_catalog', { category: 'Água' });
      const rows = body.recommendations as { category: string }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.category))).toEqual(new Set(['Água']));
    });

    it('says which category it does not know instead of returning the whole catalog', async () => {
      expect(await read('search_catalog', { category: 'gasolina' })).toMatchObject({
        showing: 0, recommendations: [],
      });
    });

    it('caps the rows and says it capped them', async () => {
      const body = await read('search_catalog');
      expect(body.catalog_size).toBe(194);
      expect(body.showing).toBe(50);
      expect(String(body.more)).toMatch(/first 50/);
    });

    /*
     * The result must not read like an inventory listing. It carries no
     * `items` key - the one every reading tool uses for real stock - and every
     * row is a `recommended` name rather than a `name`, so a model skimming
     * the JSON has nothing to mistake for something the household owns.
     */
    it('cannot be mistaken for the inventory', async () => {
      const body = await read('search_catalog', { query: 'agua' });
      expect(body.source).toBe('reference catalog');
      expect(body.is_inventory).toBe(false);
      expect(body.items).toBeUndefined();
      expect(String(body.note)).toMatch(/RECOMMENDATIONS ONLY/);
      for (const row of body.recommendations as Record<string, unknown>[]) {
        expect(row.name).toBeUndefined();
        expect(row.quantity).toBeUndefined();
        expect(row.recommended).toEqual(expect.any(String));
      }
    });

    /*
     * The household's water item was typed in by hand, so the catalog's water
     * entry is linked to nothing. Zero here therefore means "no link", never
     * "they have none" - and the note has to say so, because a model that
     * reads it as ownership will tell an empty household it is stocked.
     */
    it('never presents a catalog entry as something the user owns', async () => {
      const body = await read('search_catalog', { query: 'agua mineral' });
      const entry = (
        body.recommendations as { recommended: string; owned_from_this_entry: number }[]
      ).find((row) => row.recommended === 'Água Mineral');

      expect(entry?.owned_from_this_entry).toBe(0);
      expect(String(body.note)).toMatch(/zero proves nothing/);

      // And the stock really does hold Água Mineral, which is the whole point.
      expect(await read('find_item', { name: 'agua mineral' })).toMatchObject({ found: 'one' });
    });

    it('counts inventory that did come from an entry', async () => {
      await deps.items.create({ name: 'Arroz do Catálogo', categoryId: 'food', catalogItemId: 'rice' });
      const body = await read('search_catalog', { query: 'rice' });
      const owned = (body.recommendations as { owned_from_this_entry: number }[]).filter(
        (row) => row.owned_from_this_entry > 0,
      );
      expect(owned).toHaveLength(1);
    });
  });

  describe('list_contacts', () => {
    it('returns the contacts the repository holds', async () => {
      const body = await read('list_contacts');
      expect(body.count).toBe(3);
      expect((body.contacts as Record<string, unknown>[])[0]).toEqual({
        name: 'José da Silva',
        relationship: 'Genro',
        phone: '11 99999-0002',
        email: 'jose@example.com',
        urgency: 1,
      });
    });

    /*
     * The ordering is the feature. `contacts.list` sorts by priority and then
     * by folded name, so the person to ring first is first; alphabetically
     * this list reads Ana, Bombeiros, José, which puts the son-in-law who
     * should be called before anyone else at the bottom.
     */
    it('keeps the order the application keeps, which is not alphabetical', async () => {
      const names = ((await read('list_contacts')).contacts as { name: string }[]).map(
        (row) => row.name,
      );
      expect(names).toEqual(['José da Silva', 'Bombeiros', 'Ana Ferreira']);
      expect(names).not.toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    });

    it('finds an accented name from a search typed without accents', async () => {
      const body = await read('list_contacts', { search: 'jose' });
      expect((body.contacts as { name: string }[]).map((row) => row.name)).toEqual([
        'José da Silva',
      ]);
    });

    it('searches the other fields too, not only the name', async () => {
      const body = await read('list_contacts', { search: 'medica' });
      expect((body.contacts as { name: string }[]).map((row) => row.name)).toEqual([
        'Ana Ferreira',
      ]);
    });

    it('returns everyone for an empty search rather than nobody', async () => {
      expect(await read('list_contacts', { search: '   ' })).toMatchObject({ count: 3 });
    });

    it('sends no database ids', async () => {
      const run = await runTool(deps, 'list_contacts', {});
      expect(run.result).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    });
  });

  /*
   * The structural half of the safety design, for the four tools added here.
   *
   * A spy on `exec` alone would pass while the database was being rewritten:
   * every real write in this application goes through `db.transaction`, which
   * hands the statement to a transaction object the spy never sees. So both
   * are watched, and the transaction is required never to open at all.
   */
  describe('the four new tools write nothing', () => {
    it('sends no INSERT, UPDATE or DELETE, and opens no transaction', async () => {
      const exec = vi.spyOn(db, 'exec');
      const transaction = vi.spyOn(db, 'transaction');

      await read('stock_summary');
      await read('item_history', { item: 'arroz' });
      await read('item_history', { item: 'leite', limit: 5 });
      await read('search_catalog');
      await read('search_catalog', { query: 'agua', category: 'Água' });
      await read('list_contacts');
      await read('list_contacts', { search: 'jose' });

      const written = exec.mock.calls.filter(([sql]) =>
        /^\s*(?:insert|update|delete|drop|alter)/i.test(String(sql)),
      );
      expect(written).toEqual([]);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('leaves the stock exactly as it found it', async () => {
      const before = await read('stock_summary');
      await read('search_catalog', { query: 'agua' });
      await read('item_history', { item: 'arroz' });
      await read('list_contacts');
      expect(await read('stock_summary')).toEqual(before);
    });
  });

  describe('failure', () => {
    it('reports an unknown tool rather than throwing', async () => {
      const run = await runTool(deps, 'delete_everything', {});
      expect(run.isError).toBe(true);
      expect(run.result).toMatch(/no tool called/i);
    });

    it('reports bad arguments rather than throwing', async () => {
      const run = await runTool(deps, 'find_item', { nombre: 'arroz' });
      expect(run.isError).toBe(true);
      expect(run.proposal).toBeNull();
    });

    /*
     * A repository that fails must come back as an errored tool_result, not as
     * a rejected promise: a dropped result leaves the conversation waiting for
     * an answer that is never coming.
     */
    it('turns a repository failure into a result rather than a rejection', async () => {
      const broken: AiDeps = {
        ...deps,
        items: {
          ...deps.items,
          listForAnalysis: () => Promise.reject(new Error('the database went away')),
        },
      };
      const run = await runTool(broken, 'whats_missing', {});
      expect(run.isError).toBe(true);
      expect(run.result).toMatch(/the database went away/);
    });
  });
});
