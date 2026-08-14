import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../database/driver/memory.driver';
import type { SqlDriver } from '../database/driver/types';
import { migrate } from '../database/migrations/runner';
import { seedDatabase } from '../database/seed/seed';
import { createItemsRepository, type ItemContext } from './items.repository';
import {
  CategoryInUseError,
  SystemCategoryError,
  createCategoriesRepository,
} from './categories.repository';
import {
  LocationCycleError,
  LocationInUseError,
  createLocationsRepository,
} from './locations.repository';
import { createCatalogRepository } from './catalog.repository';
import { createSettingsRepository } from './settings.repository';

const TODAY = '2026-08-14';
const CONTEXT: ItemContext = { today: TODAY, defaultThreshold: 5, expiryWindows: [7, 30, 90] };

describe('repositories', () => {
  let db: SqlDriver;
  let items: ReturnType<typeof createItemsRepository>;
  let categories: ReturnType<typeof createCategoriesRepository>;
  let locations: ReturnType<typeof createLocationsRepository>;
  let catalog: ReturnType<typeof createCatalogRepository>;
  let settings: ReturnType<typeof createSettingsRepository>;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    items = createItemsRepository(db);
    categories = createCategoriesRepository(db);
    locations = createLocationsRepository(db);
    catalog = createCatalogRepository(db);
    settings = createSettingsRepository(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  // -------------------------------------------------------------------------
  describe('items', () => {
    describe('creating', () => {
      it('creates an item with sensible defaults', async () => {
        const item = await items.create({ name: 'Rice' });
        expect(item).toMatchObject({
          name: 'Rice',
          quantity: 0,
          unit: 'un',
          priority: 3,
          expirationDate: null,
          archivedAt: null,
        });
        expect(item.id).toMatch(/[0-9a-f-]{36}/);
      });

      it('creates an item that does not expire', async () => {
        // The whole point of the nullable date: a hammer needs no expiry.
        const item = await items.create({ name: 'Hammer', categoryId: 'tools' });
        expect(item.expirationDate).toBeNull();
      });

      it('rejects a date that does not exist rather than storing it', async () => {
        const item = await items.create({ name: 'Milk', expirationDate: '2026-02-30' });
        expect(item.expirationDate).toBeNull();
      });

      it('trims the name and stores a folded copy for search', async () => {
        const item = await items.create({ name: '  Açúcar  ' });
        expect(item.name).toBe('Açúcar');
        const norm = await db.selectValue<string>('SELECT name_norm FROM items WHERE id = ?', [item.id]);
        expect(norm).toBe('acucar');
      });
    });

    describe('updating', () => {
      it('applies a partial patch and leaves other fields alone', async () => {
        const created = await items.create({ name: 'Rice', quantity: 5, notes: 'top shelf' });
        const updated = await items.update(created.id, { quantity: 12 });
        expect(updated.quantity).toBe(12);
        expect(updated.notes).toBe('top shelf');
      });

      it('keeps the folded name in step with a rename', async () => {
        const created = await items.create({ name: 'Rice' });
        await items.update(created.id, { name: 'Açúcar' });
        const norm = await db.selectValue<string>('SELECT name_norm FROM items WHERE id = ?', [created.id]);
        expect(norm).toBe('acucar');
      });

      it('can clear an expiration date', async () => {
        const created = await items.create({ name: 'Rice', expirationDate: '2026-12-01' });
        const updated = await items.update(created.id, { expirationDate: null });
        expect(updated.expirationDate).toBeNull();
      });

      it('refuses an empty name', async () => {
        const created = await items.create({ name: 'Rice' });
        await expect(items.update(created.id, { name: '   ' })).rejects.toThrow();
      });

      it('reports a missing item rather than silently doing nothing', async () => {
        await expect(items.update('nope', { quantity: 1 })).rejects.toThrow(/no inventory item/i);
      });
    });

    describe('archiving', () => {
      it('archives and restores without losing anything', async () => {
        const created = await items.create({ name: 'Rice', quantity: 7 });
        const archived = await items.archive(created.id);
        expect(archived.archivedAt).not.toBeNull();

        const restored = await items.restore(created.id);
        expect(restored.archivedAt).toBeNull();
        expect(restored.quantity).toBe(7);
      });

      it('hides archived items from the default list but keeps them findable', async () => {
        const created = await items.create({ name: 'Rice' });
        await items.archive(created.id);

        expect((await items.list(CONTEXT)).rows).toHaveLength(0);
        expect((await items.list(CONTEXT, { filters: { archived: 'archived' } })).rows).toHaveLength(1);
        expect((await items.list(CONTEXT, { filters: { archived: 'all' } })).rows).toHaveLength(1);
      });
    });

    describe('duplicating', () => {
      it('copies the settings but not the history', async () => {
        const created = await items.create({
          name: 'Rice',
          quantity: 5,
          minimumQuantity: 10,
          unit: 'kg',
        });
        await items.adjustQuantity(created.id, 3);

        const copy = await items.duplicate(created.id);
        expect(copy.name).toBe('Rice (copy)');
        expect(copy.minimumQuantity).toBe(10);
        expect(copy.unit).toBe('kg');
        expect(await items.history(copy.id)).toHaveLength(0);
      });
    });

    describe('quantity adjustment', () => {
      it('changes the quantity and records why, together', async () => {
        const created = await items.create({ name: 'Rice', quantity: 5 });
        const updated = await items.adjustQuantity(created.id, 3, { type: 'purchase' });

        expect(updated.quantity).toBe(8);
        const history = await items.history(created.id);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
          type: 'purchase',
          quantity: 3,
          quantity_before: 5,
          quantity_after: 8,
        });
      });

      it('never takes stock below zero', async () => {
        const created = await items.create({ name: 'Rice', quantity: 2 });
        const updated = await items.adjustQuantity(created.id, -10);
        expect(updated.quantity).toBe(0);
      });

      it('defaults to "add" going up and "consume" going down', async () => {
        const created = await items.create({ name: 'Rice', quantity: 5 });
        await items.adjustQuantity(created.id, 1);
        await items.adjustQuantity(created.id, -1);
        const history = await items.history(created.id);
        expect(history.map((h) => h.type)).toEqual(['consume', 'add']);
      });

      it('ignores a zero adjustment instead of writing a meaningless record', async () => {
        const created = await items.create({ name: 'Rice', quantity: 5 });
        await items.adjustQuantity(created.id, 0);
        expect(await items.history(created.id)).toHaveLength(0);
      });

      it('avoids floating-point dust', async () => {
        const created = await items.create({ name: 'Oil', quantity: 0.1 });
        const updated = await items.adjustQuantity(created.id, 0.2);
        expect(updated.quantity).toBe(0.3);
      });

      it('leaves the quantity untouched if the history write fails', async () => {
        const created = await items.create({ name: 'Rice', quantity: 5 });
        await expect(items.adjustQuantity('does-not-exist', 5)).rejects.toThrow();
        expect((await items.getById(created.id))?.quantity).toBe(5);
      });
    });

    describe('transfers', () => {
      it('moves an item and records the move', async () => {
        const from = await locations.create({ name: 'Pantry' });
        const to = await locations.create({ name: 'Garage' });
        const created = await items.create({ name: 'Rice', quantity: 5, locationId: from.id });

        const moved = await items.transfer(created.id, to.id, 'making space');
        expect(moved.locationId).toBe(to.id);

        const history = await items.history(created.id);
        expect(history[0]).toMatchObject({
          type: 'transfer',
          source_location_id: from.id,
          destination_location_id: to.id,
          notes: 'making space',
        });
      });

      it('does not change the quantity', async () => {
        const to = await locations.create({ name: 'Garage' });
        const created = await items.create({ name: 'Rice', quantity: 5 });
        expect((await items.transfer(created.id, to.id)).quantity).toBe(5);
      });
    });

    describe('search', () => {
      beforeEach(async () => {
        const pantry = await locations.create({ name: 'Despensa' });
        await items.create({ name: 'Água Mineral', categoryId: 'water', locationId: pantry.id });
        await items.create({ name: 'Açúcar', categoryId: 'food' });
        await items.create({ name: 'Filtro de Água', categoryId: 'water' });
        await items.create({ name: 'Hammer', categoryId: 'tools', notes: 'in the red toolbox' });
        await items.create({ name: 'Batteries', categoryId: 'power', barcode: '7891234567890' });
      });

      const names = async (search: string) =>
        (await items.list(CONTEXT, { filters: { search } })).rows.map((r) => r.name).sort();

      it('finds accented names typed without accents', async () => {
        expect(await names('agua')).toEqual(['Filtro de Água', 'Água Mineral']);
      });

      it('finds "Açúcar" typed as "acucar"', async () => {
        expect(await names('acucar')).toEqual(['Açúcar']);
      });

      it('matches partway through a word', async () => {
        // FTS token matching would miss this; substring matching does not.
        expect(await names('cuc')).toEqual(['Açúcar']);
      });

      it('is case-insensitive', async () => {
        expect(await names('HAMMER')).toEqual(['Hammer']);
      });

      it('searches notes', async () => {
        expect(await names('toolbox')).toEqual(['Hammer']);
      });

      it('searches barcodes', async () => {
        expect(await names('789123')).toEqual(['Batteries']);
      });

      it('searches location names, accent-insensitively', async () => {
        expect(await names('despensa')).toEqual(['Água Mineral']);
      });

      it('searches category names in the active language', async () => {
        const rows = await items.list(CONTEXT, { filters: { search: 'ferramentas' }, lang: 'pt-BR' });
        expect(rows.rows.map((r) => r.name)).toEqual(['Hammer']);
      });

      it('requires every term to match', async () => {
        expect(await names('agua mineral')).toEqual(['Água Mineral']);
        expect(await names('agua hammer')).toEqual([]);
      });

      it('treats a wildcard character literally', async () => {
        expect(await names('%')).toEqual([]);
      });

      it('returns everything for a blank search', async () => {
        expect(await names('   ')).toHaveLength(5);
      });
    });

    describe('filters', () => {
      it('combines category, stock status and expiry, as the specification asks', async () => {
        await items.create({
          name: 'Gauze',
          categoryId: 'medical',
          quantity: 1,
          minimumQuantity: 10,
          expirationDate: '2026-09-01',
        });
        await items.create({
          name: 'Bandages',
          categoryId: 'medical',
          quantity: 50,
          minimumQuantity: 10,
          expirationDate: '2026-09-01',
        });
        await items.create({ name: 'Rice', categoryId: 'food', quantity: 1, minimumQuantity: 10 });

        const page = await items.list(CONTEXT, {
          filters: {
            categoryIds: ['medical'],
            stockStatuses: ['critical'],
            expiryBuckets: ['soon'],
          },
        });
        expect(page.rows.map((r) => r.name)).toEqual(['Gauze']);
      });

      it('filters by location including sub-locations', async () => {
        const house = await locations.create({ name: 'House' });
        const pantry = await locations.create({ name: 'Pantry', parentId: house.id });
        const shelf = await locations.create({ name: 'Top shelf', parentId: pantry.id });
        await items.create({ name: 'Rice', locationId: shelf.id });
        await items.create({ name: 'Axe', locationId: null });

        const nested = await items.list(CONTEXT, {
          filters: { locationIds: [house.id], includeSublocations: true },
        });
        expect(nested.rows.map((r) => r.name)).toEqual(['Rice']);

        const flat = await items.list(CONTEXT, { filters: { locationIds: [house.id] } });
        expect(flat.rows).toHaveLength(0);
      });

      it('filters by priority and condition', async () => {
        await items.create({ name: 'Radio', priority: 1, condition: 'good' });
        await items.create({ name: 'Rope', priority: 4, condition: 'poor' });

        expect(
          (await items.list(CONTEXT, { filters: { priorities: [1] } })).rows.map((r) => r.name),
        ).toEqual(['Radio']);
        expect(
          (await items.list(CONTEXT, { filters: { conditions: ['poor'] } })).rows.map((r) => r.name),
        ).toEqual(['Rope']);
      });

      it('reports the total independently of the page size', async () => {
        for (let i = 0; i < 12; i++) await items.create({ name: `Item ${String(i).padStart(2, '0')}` });
        const page = await items.list(CONTEXT, { limit: 5 });
        expect(page.rows).toHaveLength(5);
        expect(page.total).toBe(12);
      });
    });

    describe('sorting and pagination', () => {
      beforeEach(async () => {
        await items.create({ name: 'Cherry', quantity: 3, expirationDate: '2026-09-01' });
        await items.create({ name: 'Apple', quantity: 10, expirationDate: '2026-08-20' });
        await items.create({ name: 'Banana', quantity: 1, expirationDate: null });
      });

      it('sorts by name', async () => {
        const page = await items.list(CONTEXT, { sort: { field: 'name', direction: 'asc' } });
        expect(page.rows.map((r) => r.name)).toEqual(['Apple', 'Banana', 'Cherry']);
      });

      it('sorts by quantity descending', async () => {
        const page = await items.list(CONTEXT, { sort: { field: 'quantity', direction: 'desc' } });
        expect(page.rows.map((r) => r.quantity)).toEqual([10, 3, 1]);
      });

      it('sorts by expiry with non-expiring items last, in both directions', async () => {
        const asc = await items.list(CONTEXT, { sort: { field: 'expiration', direction: 'asc' } });
        expect(asc.rows.map((r) => r.name)).toEqual(['Apple', 'Cherry', 'Banana']);

        const desc = await items.list(CONTEXT, { sort: { field: 'expiration', direction: 'desc' } });
        expect(desc.rows.map((r) => r.name)).toEqual(['Cherry', 'Apple', 'Banana']);
      });

      it('pages through every row exactly once', async () => {
        for (let i = 0; i < 25; i++) await items.create({ name: `Bulk ${String(i).padStart(3, '0')}` });

        const seen: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 20; guard++) {
          const page: Awaited<ReturnType<typeof items.list>> = await items.list(CONTEXT, {
            limit: 4,
            cursor,
          });
          seen.push(...page.rows.map((r) => r.id));
          cursor = page.nextCursor;
          if (cursor === null) break;
        }

        expect(seen).toHaveLength(28);
        expect(new Set(seen).size).toBe(28);
      });

      it('pages correctly when sorting by a nullable column', async () => {
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 10; guard++) {
          const page: Awaited<ReturnType<typeof items.list>> = await items.list(CONTEXT, {
            limit: 1,
            cursor,
            sort: { field: 'expiration', direction: 'asc' },
          });
          seen.push(...page.rows.map((r) => r.name));
          cursor = page.nextCursor;
          if (cursor === null) break;
        }
        expect(seen).toEqual(['Apple', 'Cherry', 'Banana']);
      });

      it('rejects a corrupt cursor with a message a user could act on', async () => {
        await expect(items.list(CONTEXT, { cursor: 'not-a-cursor' })).rejects.toThrow(/reload/i);
      });
    });

    describe('computed status on list rows', () => {
      it('carries stock status, expiry bucket and what is needed', async () => {
        await items.create({
          name: 'Rice',
          quantity: 4,
          minimumQuantity: 10,
          idealQuantity: 30,
          expirationDate: '2026-08-20',
          categoryId: 'food',
        });
        const row = (await items.list(CONTEXT)).rows[0];
        expect(row).toMatchObject({
          stockStatus: 'critical',
          expiryBucket: 'soon',
          daysUntilExpiry: 6,
          needed: 26,
          effectiveMinimum: 10,
          categoryName: 'Food',
        });
      });

      it('shows category names in the requested language', async () => {
        await items.create({ name: 'Rice', categoryId: 'food' });
        const row = (await items.list(CONTEXT, { lang: 'pt-BR' })).rows[0];
        expect(row?.categoryName).toBe('Alimentos');
      });

      it('falls back to English when the language has no name', async () => {
        await items.create({ name: 'Rice', categoryId: 'food' });
        const row = (await items.list(CONTEXT, { lang: 'de' })).rows[0];
        expect(row?.categoryName).toBe('Food');
      });
    });

    describe('dashboard statistics', () => {
      it('counts what the original dashboard counted, and more', async () => {
        // minimumQuantity: 0 on the expiry cases keeps them out of the stock
        // counters, so each assertion below tests one thing.
        await items.create({ name: 'Expired', quantity: 1, minimumQuantity: 0, expirationDate: '2026-01-01' });
        await items.create({ name: 'Today', quantity: 1, minimumQuantity: 0, expirationDate: TODAY });
        await items.create({ name: 'Soon', quantity: 1, minimumQuantity: 0, expirationDate: '2026-09-01' });
        await items.create({ name: 'Later', quantity: 1, minimumQuantity: 0, expirationDate: '2030-01-01' });
        await items.create({ name: 'Forever', quantity: 100, minimumQuantity: 1 });
        await items.create({ name: 'Empty', quantity: 0, minimumQuantity: 10 });
        const archived = await items.create({ name: 'Gone', quantity: 1 });
        await items.archive(archived.id);

        const stats = await items.dashboardStats(CONTEXT);
        expect(stats).toMatchObject({
          totalItems: 6,
          expired: 1,
          expiringToday: 1,
          expiringSoon: 1,
          noExpiration: 2,
          critical: 1,
          archived: 1,
        });
        expect(stats.totalQuantity).toBe(104);
      });

      it('excludes archived items from the totals', async () => {
        const created = await items.create({ name: 'Rice', quantity: 10 });
        await items.archive(created.id);
        const stats = await items.dashboardStats(CONTEXT);
        expect(stats.totalItems).toBe(0);
        expect(stats.totalQuantity).toBe(0);
        expect(stats.archived).toBe(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('categories', () => {
    it('lists the seeded taxonomy in order', async () => {
      const all = await categories.list();
      expect(all).toHaveLength(20);
      expect(all[0]?.id).toBe('food');
      expect(all[0]?.names['pt-BR']).toBe('Alimentos');
    });

    it('creates a user category with a slug derived from its name', async () => {
      const created = await categories.create({ names: { en: 'Bug Out Bag' } });
      expect(created.id).toBe('bug-out-bag');
      expect(created.isSystem).toBe(false);
    });

    it('refuses a duplicate', async () => {
      await categories.create({ names: { en: 'Bunker' } });
      await expect(categories.create({ names: { en: 'Bunker' } })).rejects.toThrow(/already exists/i);
    });

    it('renames without orphaning items', async () => {
      const item = await items.create({ name: 'Rice', categoryId: 'food' });
      await categories.update('food', { names: { en: 'Provisions' } });

      const reloaded = await items.getById(item.id);
      expect(reloaded?.categoryId).toBe('food');
      const row = (await items.list(CONTEXT)).rows[0];
      expect(row?.categoryName).toBe('Provisions');
    });

    it('refuses to delete a built-in category', async () => {
      await expect(categories.remove('food')).rejects.toBeInstanceOf(SystemCategoryError);
    });

    it('refuses to delete a category that still holds items', async () => {
      const created = await categories.create({ names: { en: 'Spare' } });
      await items.create({ name: 'Rope', categoryId: created.id });
      await expect(categories.remove(created.id)).rejects.toBeInstanceOf(CategoryInUseError);
    });

    it('reassigns items when told where to put them', async () => {
      const created = await categories.create({ names: { en: 'Spare' } });
      const item = await items.create({ name: 'Rope', categoryId: created.id });

      await categories.remove(created.id, { reassignTo: 'tools' });
      expect((await items.getById(item.id))?.categoryId).toBe('tools');
    });

    it('can hide a built-in category instead of deleting it', async () => {
      await categories.update('fuel', { active: false });
      expect((await categories.list()).map((c) => c.id)).not.toContain('fuel');
      expect((await categories.list(true)).map((c) => c.id)).toContain('fuel');
    });

    it('counts items per category', async () => {
      await items.create({ name: 'Rice', categoryId: 'food' });
      await items.create({ name: 'Beans', categoryId: 'food' });
      await items.create({ name: 'Axe', categoryId: 'tools' });
      const counts = await categories.itemCounts();
      expect(counts.get('food')).toBe(2);
      expect(counts.get('tools')).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('locations', () => {
    it('builds a hierarchy with depth, path and item counts', async () => {
      const property = await locations.create({ name: 'Property' });
      const house = await locations.create({ name: 'House', parentId: property.id });
      const pantry = await locations.create({ name: 'Pantry', parentId: house.id });
      await items.create({ name: 'Rice', locationId: pantry.id });

      const tree = await locations.tree();
      expect(tree).toHaveLength(1);
      expect(tree[0]?.name).toBe('Property');

      const pantryNode = tree[0]?.children[0]?.children[0];
      expect(pantryNode).toMatchObject({ name: 'Pantry', depth: 2, itemCount: 1 });
      expect(pantryNode?.path).toEqual(['Property', 'House', 'Pantry']);
    });

    it('refuses to make a location its own ancestor', async () => {
      const parent = await locations.create({ name: 'House' });
      const child = await locations.create({ name: 'Pantry', parentId: parent.id });
      await expect(locations.update(parent.id, { parentId: child.id })).rejects.toBeInstanceOf(
        LocationCycleError,
      );
    });

    it('refuses to make a location its own parent', async () => {
      const location = await locations.create({ name: 'House' });
      await expect(locations.update(location.id, { parentId: location.id })).rejects.toBeInstanceOf(
        LocationCycleError,
      );
    });

    it('refuses to delete a location that still holds things', async () => {
      const location = await locations.create({ name: 'Pantry' });
      await items.create({ name: 'Rice', locationId: location.id });
      await expect(locations.remove(location.id)).rejects.toBeInstanceOf(LocationInUseError);
    });

    it('reassigns items and re-parents children when told to', async () => {
      const house = await locations.create({ name: 'House' });
      const pantry = await locations.create({ name: 'Pantry', parentId: house.id });
      const shelf = await locations.create({ name: 'Shelf', parentId: pantry.id });
      const item = await items.create({ name: 'Rice', locationId: pantry.id });

      await locations.remove(pantry.id, { reassignItemsTo: house.id, reparentChildrenTo: house.id });

      expect((await items.getById(item.id))?.locationId).toBe(house.id);
      expect((await locations.getById(shelf.id))?.parentId).toBe(house.id);
    });

    it('matches an existing location by name regardless of case and accents', async () => {
      await locations.create({ name: 'Despensa' });
      const found = await locations.findByName('DESPENSA');
      expect(found?.name).toBe('Despensa');
    });

    it('reuses a location rather than creating a duplicate', async () => {
      const first = await locations.findOrCreateByName('Garagem');
      const second = await locations.findOrCreateByName('garagem');
      expect(second.id).toBe(first.id);
      expect(await locations.list()).toHaveLength(1);
    });

    it('surfaces an orphaned location instead of hiding it', async () => {
      const parent = await locations.create({ name: 'House' });
      await locations.create({ name: 'Pantry', parentId: parent.id });
      // Simulates a partial import that left a dangling parent reference.
      await db.execScript('PRAGMA foreign_keys = OFF');
      await db.exec('DELETE FROM locations WHERE id = ?', [parent.id]);
      await db.execScript('PRAGMA foreign_keys = ON');

      const tree = await locations.tree();
      expect(tree.map((n) => n.name)).toEqual(['Pantry']);
    });
  });

  // -------------------------------------------------------------------------
  describe('catalog', () => {
    it('holds all 194 reference items', async () => {
      expect(await catalog.total()).toBe(194);
    });

    it('finds reference items accent-insensitively', async () => {
      const results = await catalog.search({ search: 'agua', lang: 'pt-BR' });
      const names = results.map((r) => r.displayName);
      expect(names).toContain('Água Mineral');
      expect(names).toContain('Filtro de Água Portátil');
    });

    it('finds an item by its name in another language', async () => {
      const results = await catalog.search({ search: 'bottled water', lang: 'pt-BR' });
      expect(results[0]?.displayName).toBe('Água Mineral');
    });

    it('filters by category', async () => {
      const results = await catalog.search({ categoryIds: ['water'], limit: 1000 });
      expect(results).toHaveLength(21);
    });

    it('does NOT put a reference item into inventory just by browsing it', async () => {
      await catalog.search({ search: 'rice' });
      expect((await items.list(CONTEXT)).total).toBe(0);
    });

    it('reports how many inventory items came from a reference entry', async () => {
      await items.create({ name: 'Arroz', catalogItemId: 'rice', categoryId: 'food' });
      const results = await catalog.search({ search: 'rice' });
      expect(results.find((r) => r.id === 'rice')?.inInventory).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('settings', () => {
    it('loads the seeded defaults', async () => {
      const { settings: loaded, invalidKeys } = await settings.load();
      expect(loaded.language).toBe('en');
      expect(loaded.defaultLowStockThreshold).toBe(5);
      expect(invalidKeys).toEqual([]);
    });

    it('saves and reloads a change', async () => {
      await settings.save({ language: 'pt-BR', defaultLowStockThreshold: 0 });
      const { settings: loaded } = await settings.load();
      expect(loaded.language).toBe('pt-BR');
      expect(loaded.defaultLowStockThreshold).toBe(0);
    });

    it('falls back to the default for a corrupt value without losing the others', async () => {
      await settings.save({ language: 'es' });
      await db.exec('UPDATE settings SET value = ? WHERE key = ?', ['not json', 'dateFormat']);

      const { settings: loaded, invalidKeys } = await settings.load();
      expect(loaded.dateFormat).toBe('DD/MM/YYYY');
      expect(loaded.language).toBe('es');
      expect(invalidKeys).toContain('dateFormat');
    });

    it('rejects an out-of-range value rather than storing it', async () => {
      await db.exec('UPDATE settings SET value = ? WHERE key = ?', ['-3', 'defaultLowStockThreshold']);
      const { settings: loaded, invalidKeys } = await settings.load();
      expect(loaded.defaultLowStockThreshold).toBe(5);
      expect(invalidKeys).toContain('defaultLowStockThreshold');
    });
  });
});
