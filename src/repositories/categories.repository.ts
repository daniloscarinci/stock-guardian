/**
 * Category persistence.
 *
 * Categories are identified by a stable slug and named in a side table, one row
 * per language. That separation is the fix for the original application's most
 * damaging bug: it stored the localized label on every inventory record, so
 * switching from English to Portuguese orphaned every item and blanked the
 * category on the next save.
 */
import type { SqlDriver, SqlRow, SqlValue } from '../database/driver/types';
import { nowInstant } from '../domain/dates';
import { foldText } from '../domain/normalize';
import type { Category } from '../types/domain';

export interface CreateCategoryInput {
  readonly id?: string;
  readonly names: Readonly<Record<string, string>>;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly sortOrder?: number;
}

export interface UpdateCategoryInput {
  readonly names?: Readonly<Record<string, string>>;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly sortOrder?: number;
  readonly active?: boolean;
}

/** Thrown rather than cascading a delete through every item in the category. */
export class CategoryInUseError extends Error {
  constructor(
    readonly categoryId: string,
    readonly itemCount: number,
  ) {
    super(`This category still holds ${itemCount} item(s).`);
    this.name = 'CategoryInUseError';
  }
}

export class SystemCategoryError extends Error {
  constructor(readonly categoryId: string) {
    super('Built-in categories cannot be deleted. They can be hidden instead.');
    this.name = 'SystemCategoryError';
  }
}

function slugify(value: string): string {
  const slug = foldText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? `category-${crypto.randomUUID().slice(0, 8)}` : slug;
}

export function createCategoriesRepository(db: SqlDriver) {
  async function assemble(rows: readonly SqlRow[]): Promise<Category[]> {
    if (rows.length === 0) return [];
    const nameRows = await db.select<{ category_id: string; lang: string; name: string }>(
      'SELECT category_id, lang, name FROM category_names',
    );

    const namesById = new Map<string, Record<string, string>>();
    for (const row of nameRows) {
      const id = String(row.category_id);
      const bucket = namesById.get(id) ?? {};
      bucket[String(row.lang)] = String(row.name);
      namesById.set(id, bucket);
    }

    return rows.map((row) => ({
      id: String(row.id),
      icon: row.icon === null ? null : String(row.icon),
      color: row.color === null ? null : String(row.color),
      sortOrder: Number(row.sort_order),
      isSystem: Number(row.is_system) === 1,
      active: Number(row.active) === 1,
      names: namesById.get(String(row.id)) ?? {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  async function list(includeInactive = false): Promise<Category[]> {
    const rows = await db.select<SqlRow>(
      `SELECT * FROM categories
        ${includeInactive ? '' : 'WHERE active = 1'}
        ORDER BY sort_order, id`,
    );
    return assemble(rows);
  }

  return {
    list,

    async getById(id: string): Promise<Category | undefined> {
      const rows = await db.select<SqlRow>('SELECT * FROM categories WHERE id = :id', { id });
      return (await assemble(rows))[0];
    },

    /** Item counts per category, for the dashboard and category management. */
    async itemCounts(): Promise<Map<string, number>> {
      const rows = await db.select<{ category_id: string | null; n: number }>(
        `SELECT category_id, count(*) AS n FROM items
          WHERE archived_at IS NULL GROUP BY category_id`,
      );
      const counts = new Map<string, number>();
      for (const row of rows) {
        if (row.category_id === null) continue;
        counts.set(String(row.category_id), Number(row.n));
      }
      return counts;
    },

    async create(input: CreateCategoryInput): Promise<Category> {
      const names = Object.entries(input.names).filter(([, name]) => name.trim() !== '');
      if (names.length === 0) throw new Error('A category needs a name in at least one language.');

      const id = input.id ?? slugify(names[0]?.[1] ?? '');
      const now = nowInstant();

      const existing = await db.selectValue<number>(
        'SELECT count(*) FROM categories WHERE id = :id',
        { id },
      );
      if (Number(existing) > 0) {
        throw new Error(`A category named "${names[0]?.[1] ?? id}" already exists.`);
      }

      const nextOrder = Number(
        (await db.selectValue<number>('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories')) ?? 0,
      );

      await db.batch([
        {
          sql: `INSERT INTO categories (id, icon, color, sort_order, is_system, active, created_at, updated_at)
                VALUES (:id, :icon, :color, :sortOrder, 0, 1, :now, :now)`,
          params: {
            id,
            icon: input.icon ?? null,
            color: input.color ?? null,
            sortOrder: input.sortOrder ?? nextOrder,
            now,
          },
        },
        ...names.map(([lang, name]) => ({
          sql: `INSERT INTO category_names (category_id, lang, name, name_norm)
                VALUES (:id, :lang, :name, :norm)`,
          params: { id, lang, name: name.trim(), norm: foldText(name) },
        })),
      ]);

      const created = await db.select<SqlRow>('SELECT * FROM categories WHERE id = :id', { id });
      return (await assemble(created))[0] as Category;
    },

    async update(id: string, patch: UpdateCategoryInput): Promise<Category> {
      const now = nowInstant();
      const assignments: string[] = ['updated_at = :now'];
      const params: Record<string, SqlValue> = { id, now };

      if (patch.icon !== undefined) {
        params.icon = patch.icon;
        assignments.push('icon = :icon');
      }
      if (patch.color !== undefined) {
        params.color = patch.color;
        assignments.push('color = :color');
      }
      if (patch.sortOrder !== undefined) {
        params.sortOrder = patch.sortOrder;
        assignments.push('sort_order = :sortOrder');
      }
      if (patch.active !== undefined) {
        params.active = patch.active ? 1 : 0;
        assignments.push('active = :active');
      }

      const ops = [
        { sql: `UPDATE categories SET ${assignments.join(', ')} WHERE id = :id`, params },
      ];

      for (const [lang, name] of Object.entries(patch.names ?? {})) {
        const trimmed = name.trim();
        if (trimmed === '') continue;
        ops.push({
          // Renaming a category must never orphan an item, which is exactly why
          // the id is not derived from the name.
          sql: `INSERT INTO category_names (category_id, lang, name, name_norm)
                VALUES (:id, :lang, :name, :norm)
                ON CONFLICT (category_id, lang)
                DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm`,
          params: { id, lang, name: trimmed, norm: foldText(trimmed) },
        });
      }

      await db.batch(ops);
      const rows = await db.select<SqlRow>('SELECT * FROM categories WHERE id = :id', { id });
      const category = (await assemble(rows))[0];
      if (category === undefined) throw new Error(`No category with id "${id}".`);
      return category;
    },

    /**
     * Deletes a user-created category.
     *
     * Refuses while items still reference it rather than cascading. Losing the
     * category off forty items because of one tap is not a recoverable mistake
     * from the user's point of view.
     */
    async remove(id: string, options: { reassignTo?: string | null } = {}): Promise<void> {
      const row = await db.selectOne<{ is_system: number }>(
        'SELECT is_system FROM categories WHERE id = :id',
        { id },
      );
      if (row === undefined) return;
      if (Number(row.is_system) === 1) throw new SystemCategoryError(id);

      const inUse = Number(
        (await db.selectValue<number>('SELECT count(*) FROM items WHERE category_id = :id', { id })) ?? 0,
      );

      if (inUse > 0 && options.reassignTo === undefined) {
        throw new CategoryInUseError(id, inUse);
      }

      await db.batch([
        ...(inUse > 0
          ? [
              {
                sql: 'UPDATE items SET category_id = :target, updated_at = :now WHERE category_id = :id',
                params: { id, target: options.reassignTo ?? null, now: nowInstant() },
              },
            ]
          : []),
        { sql: 'DELETE FROM category_names WHERE category_id = :id', params: { id } },
        { sql: 'DELETE FROM categories WHERE id = :id', params: { id } },
      ]);
    },

    async reorder(orderedIds: readonly string[]): Promise<void> {
      const now = nowInstant();
      await db.batch(
        orderedIds.map((id, index) => ({
          sql: 'UPDATE categories SET sort_order = :order, updated_at = :now WHERE id = :id',
          params: { id, order: index, now },
        })),
      );
    },
  };
}

export type CategoriesRepository = ReturnType<typeof createCategoriesRepository>;
