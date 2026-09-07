import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createCategoriesRepository } from '../../repositories/categories.repository';
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

    const pantry = await locations.create({ name: 'Despensa' });
    const shelf = await locations.create({ name: 'Prateleira de Cima', parentId: pantry.id });

    await items.create({
      name: 'Arroz Branco', quantity: 12, unit: 'kg', minimumQuantity: 10,
      categoryId: 'food', locationId: pantry.id,
    });
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

    deps = {
      items, locations, categories, context: CONTEXT, language: 'pt-BR', trackedCategoryIds: [],
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
