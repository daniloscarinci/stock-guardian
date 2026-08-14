/**
 * Reference catalog reads.
 *
 * The catalog is what a prepared household *could* hold; `items` is what this
 * household *does* hold. The specification is explicit that browsing one must
 * never change the other, so nothing in this file writes to `items` - adding to
 * inventory is an explicit call on the items repository with the catalog entry
 * as a starting point.
 */
import type { SqlDriver, SqlRow, SqlValue } from '../database/driver/types';
import { searchTerms } from '../domain/normalize';
import type { CatalogItem } from '../types/domain';

export interface CatalogQuery {
  readonly search?: string;
  readonly categoryIds?: readonly string[];
  readonly lang?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CatalogEntry extends CatalogItem {
  /** Name in the requested language, falling back to English then any name. */
  readonly displayName: string;
  /** How many inventory items were created from this entry. */
  readonly inInventory: number;
}

export function createCatalogRepository(db: SqlDriver) {
  return {
    async search(query: CatalogQuery = {}): Promise<CatalogEntry[]> {
      const lang = query.lang ?? 'en';
      const params: Record<string, SqlValue> = {
        lang,
        limit: Math.min(Math.max(1, query.limit ?? 200), 1000),
        offset: Math.max(0, query.offset ?? 0),
      };
      const clauses: string[] = [];

      if (query.categoryIds && query.categoryIds.length > 0) {
        const names = query.categoryIds.map((id, index) => {
          params[`cat${index}`] = id;
          return `:cat${index}`;
        });
        clauses.push(`ci.category_id IN (${names.join(', ')})`);
      }

      // Searches every language at once, so a Portuguese interface still finds
      // an item the user knows by its English name.
      searchTerms(query.search ?? '').forEach((term, index) => {
        const key = `q${index}`;
        params[key] = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        clauses.push(`EXISTS (
          SELECT 1 FROM catalog_item_names n
           WHERE n.catalog_item_id = ci.id AND n.name_norm LIKE :${key} ESCAPE '\\'
        )`);
      });

      const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;

      const rows = await db.select<SqlRow>(
        `SELECT ci.id, ci.category_id, ci.default_unit, ci.sort_order, ci.is_system,
                COALESCE(nl.name, ne.name, na.name) AS display_name,
                (SELECT count(*) FROM items it
                  WHERE it.catalog_item_id = ci.id AND it.archived_at IS NULL) AS in_inventory
           FROM catalog_items ci
           LEFT JOIN catalog_item_names nl ON nl.catalog_item_id = ci.id AND nl.lang = :lang
           LEFT JOIN catalog_item_names ne ON ne.catalog_item_id = ci.id AND ne.lang = 'en'
           LEFT JOIN catalog_item_names na ON na.catalog_item_id = ci.id
           ${where}
          GROUP BY ci.id
          ORDER BY ci.sort_order, display_name
          LIMIT :limit OFFSET :offset`,
        params,
      );

      const ids = rows.map((row) => String(row.id));
      const names = await this.namesFor(ids);

      return rows.map((row) => ({
        id: String(row.id),
        categoryId: String(row.category_id),
        defaultUnit: row.default_unit === null ? null : String(row.default_unit),
        sortOrder: Number(row.sort_order),
        isSystem: Number(row.is_system) === 1,
        names: names.get(String(row.id)) ?? {},
        displayName: String(row.display_name ?? row.id),
        inInventory: Number(row.in_inventory ?? 0),
      }));
    },

    async namesFor(ids: readonly string[]): Promise<Map<string, Record<string, string>>> {
      const result = new Map<string, Record<string, string>>();
      if (ids.length === 0) return result;

      const params: Record<string, SqlValue> = {};
      const placeholders = ids.map((id, index) => {
        params[`id${index}`] = id;
        return `:id${index}`;
      });

      const rows = await db.select<{ catalog_item_id: string; lang: string; name: string }>(
        `SELECT catalog_item_id, lang, name FROM catalog_item_names
          WHERE catalog_item_id IN (${placeholders.join(', ')})`,
        params,
      );

      for (const row of rows) {
        const id = String(row.catalog_item_id);
        const bucket = result.get(id) ?? {};
        bucket[String(row.lang)] = String(row.name);
        result.set(id, bucket);
      }
      return result;
    },

    async countByCategory(): Promise<Map<string, number>> {
      const rows = await db.select<{ category_id: string; n: number }>(
        'SELECT category_id, count(*) AS n FROM catalog_items GROUP BY category_id',
      );
      return new Map(rows.map((row) => [String(row.category_id), Number(row.n)]));
    },

    async total(): Promise<number> {
      return Number((await db.selectValue<number>('SELECT count(*) FROM catalog_items')) ?? 0);
    },
  };
}

export type CatalogRepository = ReturnType<typeof createCatalogRepository>;
