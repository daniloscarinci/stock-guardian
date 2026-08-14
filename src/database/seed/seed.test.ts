import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../driver/memory.driver';
import type { SqlDriver } from '../driver/types';
import { migrate } from '../migrations/runner';
import { seedDatabase } from './seed';
import { SEED_CATEGORIES, ORIGINAL_CATEGORY_IDS } from './categories';
import {
  LEGACY_CATALOG_CATEGORIES,
  LEGACY_CATALOG_ITEMS,
  LEGACY_CATALOG_ITEM_COUNT,
  LEGACY_CATEGORY_ID_BY_FOLDED_LABEL,
} from '../../data/catalog.generated';
import { foldText } from '../../domain/normalize';
import { DEFAULT_SETTINGS, parseSettings } from '../../domain/settings';

describe('seeding', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  const count = async (table: string) =>
    (await db.selectValue<number>(`SELECT count(*) FROM ${table}`)) ?? 0;

  describe('reference data is complete', () => {
    it('seeds all twenty categories', async () => {
      const result = await seedDatabase(db);
      expect(result.categoriesInserted).toBe(20);
      expect(await count('categories')).toBe(SEED_CATEGORIES.length);
    });

    it('seeds every category in all three languages', async () => {
      await seedDatabase(db);
      expect(await count('category_names')).toBe(SEED_CATEGORIES.length * 3);
    });

    it('seeds all 194 original catalog items', async () => {
      const result = await seedDatabase(db);
      expect(result.catalogItemsInserted).toBe(LEGACY_CATALOG_ITEM_COUNT);
      expect(await count('catalog_items')).toBe(194);
    });

    it('seeds every catalog item in all three languages', async () => {
      await seedDatabase(db);
      expect(await count('catalog_item_names')).toBe(194 * 3);
    });

    it('preserves the original per-category item counts exactly', async () => {
      await seedDatabase(db);
      const rows = await db.select<{ category_id: string; n: number }>(
        'SELECT category_id, count(*) AS n FROM catalog_items GROUP BY category_id',
      );
      const actual = new Map(rows.map((r) => [String(r.category_id), Number(r.n)]));

      for (const original of LEGACY_CATALOG_CATEGORIES) {
        expect(actual.get(original.id)).toBe(original.itemCount);
      }
      // 22+21+22+21+22+22+21+22+21
      expect([...actual.values()].reduce((a, b) => a + b, 0)).toBe(194);
    });

    it('leaves the eleven added categories empty rather than reclassifying items', async () => {
      await seedDatabase(db);
      const added = SEED_CATEGORIES.map((c) => c.id).filter(
        (id) => !ORIGINAL_CATEGORY_IDS.includes(id),
      );
      expect(added).toHaveLength(11);

      for (const id of added) {
        const n = await db.selectValue<number>(
          'SELECT count(*) FROM catalog_items WHERE category_id = ?',
          [id],
        );
        expect(n).toBe(0);
      }
    });

    it('keeps the original Portuguese and Spanish category labels', async () => {
      await seedDatabase(db);
      const row = await db.selectOne<{ name: string }>(
        'SELECT name FROM category_names WHERE category_id = ? AND lang = ?',
        ['power', 'pt-BR'],
      );
      expect(row?.name).toBe('Energia');
    });

    it('seeds default settings', async () => {
      await seedDatabase(db);
      const rows = await db.select<{ key: string; value: string }>('SELECT key, value FROM settings');
      const { settings, invalidKeys } = parseSettings(rows);
      expect(invalidKeys).toEqual([]);
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('search normalization', () => {
    it('stores folded names so accented text is findable without accents', async () => {
      await seedDatabase(db);
      const rows = await db.select<{ name: string }>(
        `SELECT n.name FROM catalog_item_names n
          WHERE n.name_norm LIKE ? ESCAPE '\\' ORDER BY n.name`,
        ['%agua%'],
      );
      const names = rows.map((r) => String(r.name));
      // The specification's worked example: searching "agua" finds all of these.
      expect(names).toContain('Água Mineral');
      expect(names).toContain('Agua Embotellada');
      expect(names).toContain('Filtro de Água Portátil');
    });

    it('finds "acucar" for "Açúcar"', async () => {
      await seedDatabase(db);
      const row = await db.selectOne<{ name: string }>(
        `SELECT name FROM catalog_item_names WHERE name_norm = ? AND lang = 'pt-BR'`,
        [foldText('Açúcar')],
      );
      expect(row?.name).toBe('Açúcar');
    });

    it('normalizes category names too', async () => {
      await seedDatabase(db);
      const row = await db.selectOne<{ name_norm: string }>(
        `SELECT name_norm FROM category_names WHERE category_id = 'communication' AND lang = 'pt-BR'`,
      );
      expect(row?.name_norm).toBe('comunicacao');
    });
  });

  describe('idempotence', () => {
    it('inserts nothing on a second run', async () => {
      await seedDatabase(db);
      const second = await seedDatabase(db);

      expect(second).toEqual({
        categoriesInserted: 0,
        categoryNamesInserted: 0,
        catalogItemsInserted: 0,
        catalogNamesInserted: 0,
        settingsInserted: 0,
      });
      expect(await count('catalog_items')).toBe(194);
      expect(await count('categories')).toBe(20);
    });

    it('survives many startups without duplicating anything', async () => {
      await seedDatabase(db);
      await seedDatabase(db);
      await seedDatabase(db);
      expect(await count('catalog_item_names')).toBe(194 * 3);
    });

    it('never overwrites a user edit to a system category', async () => {
      await seedDatabase(db);
      await db.exec('UPDATE category_names SET name = ? WHERE category_id = ? AND lang = ?', [
        'Provisions',
        'food',
        'en',
      ]);

      await seedDatabase(db);

      const row = await db.selectOne<{ name: string }>(
        'SELECT name FROM category_names WHERE category_id = ? AND lang = ?',
        ['food', 'en'],
      );
      expect(row?.name).toBe('Provisions');
    });

    it('never removes a user-created category', async () => {
      await seedDatabase(db);
      const now = new Date().toISOString();
      await db.exec(
        `INSERT INTO categories (id, sort_order, is_system, active, created_at, updated_at)
         VALUES (?, 99, 0, 1, ?, ?)`,
        ['my-bunker', now, now],
      );

      await seedDatabase(db);
      expect(await db.selectValue<number>('SELECT count(*) FROM categories WHERE id = ?', ['my-bunker'])).toBe(1);
    });

    it('adds a newly shipped category without disturbing existing ones', async () => {
      await seedDatabase(db);
      await db.exec('DELETE FROM category_names WHERE category_id = ?', ['fuel']);
      await db.exec('DELETE FROM categories WHERE id = ?', ['fuel']);

      const result = await seedDatabase(db);
      expect(result.categoriesInserted).toBe(1);
      expect(result.catalogItemsInserted).toBe(0);
      expect(await count('categories')).toBe(20);
    });

    it('does not overwrite a changed setting', async () => {
      await seedDatabase(db);
      await db.exec('UPDATE settings SET value = ? WHERE key = ?', ['"pt-BR"', 'language']);
      await seedDatabase(db);

      const rows = await db.select<{ key: string; value: string }>('SELECT key, value FROM settings');
      expect(parseSettings(rows).settings.language).toBe('pt-BR');
    });
  });

  describe('referential integrity', () => {
    it('links every catalog item to a real category', async () => {
      await seedDatabase(db);
      expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
    });

    it('leaves the database consistent', async () => {
      await seedDatabase(db);
      expect(await db.selectValue<string>('PRAGMA integrity_check')).toBe('ok');
    });
  });

  describe('legacy category label mapping', () => {
    it('maps every original label in all three languages to a seeded category', async () => {
      await seedDatabase(db);
      const seeded = new Set(SEED_CATEGORIES.map((c) => c.id));

      for (const [label, categoryId] of Object.entries(LEGACY_CATEGORY_ID_BY_FOLDED_LABEL)) {
        expect(seeded.has(categoryId), `"${label}" -> "${categoryId}"`).toBe(true);
      }
    });

    it('accepts both the original "Power" and the current "Energy" label', async () => {
      expect(LEGACY_CATEGORY_ID_BY_FOLDED_LABEL[foldText('Power')]).toBe('power');
      expect(LEGACY_CATEGORY_ID_BY_FOLDED_LABEL[foldText('Energy')]).toBe('power');
      expect(LEGACY_CATEGORY_ID_BY_FOLDED_LABEL[foldText('Energia')]).toBe('power');
      expect(LEGACY_CATEGORY_ID_BY_FOLDED_LABEL[foldText('Energía')]).toBe('power');
    });

    it('folds the accented Portuguese and Spanish labels to the same key', async () => {
      expect(foldText('Água')).toBe(foldText('Agua'));
      expect(LEGACY_CATEGORY_ID_BY_FOLDED_LABEL[foldText('Água')]).toBe('water');
    });
  });

  describe('catalog provenance', () => {
    it('agrees with the extraction script on folded text', () => {
      // The extraction script cannot import from src, so it carries its own copy
      // of the folding rule. If the two ever diverge, legacy category labels stop
      // matching and imported records lose their category silently.
      for (const item of LEGACY_CATALOG_ITEMS) {
        expect(item.id).toBe(
          foldText(item.names.en)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, ''),
        );
      }
    });

    it('has unique catalog ids', () => {
      const ids = LEGACY_CATALOG_ITEMS.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
