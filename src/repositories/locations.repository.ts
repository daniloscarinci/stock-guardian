/**
 * Location persistence, including the storage hierarchy.
 *
 *   Property
 *    ├── House
 *    │    ├── Pantry
 *    │    └── Garage
 *    └── Rural Property
 *         └── Shed
 *
 * The original application had a free-text `loc` field per item and nothing
 * else, so "Pantry" and "pantry" were different places and nothing could be
 * rolled up. Locations are now real records with a parent link.
 */
import type { SqlDriver, SqlRow, SqlValue } from '../database/driver/types';
import { nowInstant } from '../domain/dates';
import { foldText } from '../domain/normalize';
import type { Location, LocationNode } from '../types/domain';

export interface CreateLocationInput {
  readonly id?: string;
  readonly name: string;
  readonly description?: string | null;
  readonly parentId?: string | null;
  readonly notes?: string | null;
  readonly sortOrder?: number;
}

export type UpdateLocationInput = Partial<Omit<CreateLocationInput, 'id'>>;

/** Refuses a move that would make a location its own ancestor. */
export class LocationCycleError extends Error {
  constructor(
    readonly locationId: string,
    readonly parentId: string,
  ) {
    super('A location cannot be moved inside itself or one of its own sub-locations.');
    this.name = 'LocationCycleError';
  }
}

export class LocationInUseError extends Error {
  constructor(
    readonly locationId: string,
    readonly itemCount: number,
    readonly childCount: number,
  ) {
    super(
      `This location still holds ${itemCount} item(s) and ${childCount} sub-location(s).`,
    );
    this.name = 'LocationInUseError';
  }
}

function mapLocation(row: SqlRow): Location {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    parentId: row.parent_id === null ? null : String(row.parent_id),
    notes: row.notes === null ? null : String(row.notes),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createLocationsRepository(db: SqlDriver) {
  async function list(): Promise<Location[]> {
    const rows = await db.select<SqlRow>('SELECT * FROM locations ORDER BY sort_order, name');
    return rows.map(mapLocation);
  }

  /** Ids of a location and everything beneath it. */
  async function descendantIds(id: string): Promise<string[]> {
    const rows = await db.select<{ id: string }>(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM locations WHERE id = :id
         UNION
         SELECT l.id FROM locations l JOIN subtree s ON l.parent_id = s.id
       )
       SELECT id FROM subtree`,
      { id },
    );
    return rows.map((row) => String(row.id));
  }

  async function assertNoCycle(id: string, parentId: string | null): Promise<void> {
    if (parentId === null) return;
    if (parentId === id) throw new LocationCycleError(id, parentId);
    const descendants = await descendantIds(id);
    if (descendants.includes(parentId)) throw new LocationCycleError(id, parentId);
  }

  return {
    list,
    descendantIds,

    async getById(id: string): Promise<Location | undefined> {
      const row = await db.selectOne<SqlRow>('SELECT * FROM locations WHERE id = :id', { id });
      return row === undefined ? undefined : mapLocation(row);
    },

    /** Case- and accent-insensitive lookup, used by the legacy importer. */
    async findByName(name: string): Promise<Location | undefined> {
      const row = await db.selectOne<SqlRow>(
        'SELECT * FROM locations WHERE name_norm = :norm LIMIT 1',
        { norm: foldText(name) },
      );
      return row === undefined ? undefined : mapLocation(row);
    },

    async create(input: CreateLocationInput): Promise<Location> {
      const name = input.name.trim();
      if (name === '') throw new Error('A location needs a name.');

      const id = input.id ?? crypto.randomUUID();
      const now = nowInstant();
      const nextOrder = Number(
        (await db.selectValue<number>('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM locations')) ?? 0,
      );

      await db.exec(
        `INSERT INTO locations (id, name, name_norm, description, parent_id, notes, sort_order, created_at, updated_at)
         VALUES (:id, :name, :norm, :description, :parentId, :notes, :sortOrder, :now, :now)`,
        {
          id,
          name,
          norm: foldText(name),
          description: input.description ?? null,
          parentId: input.parentId ?? null,
          notes: input.notes ?? null,
          sortOrder: input.sortOrder ?? nextOrder,
          now,
        },
      );

      const created = await db.selectOne<SqlRow>('SELECT * FROM locations WHERE id = :id', { id });
      return mapLocation(created as SqlRow);
    },

    /** Finds a location by name or creates it. Used when importing legacy data. */
    async findOrCreateByName(name: string): Promise<Location> {
      const existing = await this.findByName(name);
      return existing ?? this.create({ name });
    },

    async update(id: string, patch: UpdateLocationInput): Promise<Location> {
      if (patch.parentId !== undefined) await assertNoCycle(id, patch.parentId);

      const assignments: string[] = ['updated_at = :now'];
      const params: Record<string, SqlValue> = { id, now: nowInstant() };

      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (name === '') throw new Error('A location needs a name.');
        params.name = name;
        params.norm = foldText(name);
        assignments.push('name = :name', 'name_norm = :norm');
      }
      if (patch.description !== undefined) {
        params.description = patch.description;
        assignments.push('description = :description');
      }
      if (patch.parentId !== undefined) {
        params.parentId = patch.parentId;
        assignments.push('parent_id = :parentId');
      }
      if (patch.notes !== undefined) {
        params.notes = patch.notes;
        assignments.push('notes = :notes');
      }
      if (patch.sortOrder !== undefined) {
        params.sortOrder = patch.sortOrder;
        assignments.push('sort_order = :sortOrder');
      }

      const result = await db.exec(
        `UPDATE locations SET ${assignments.join(', ')} WHERE id = :id`,
        params,
      );
      if (result.rowsAffected === 0) throw new Error(`No location with id "${id}".`);

      const row = await db.selectOne<SqlRow>('SELECT * FROM locations WHERE id = :id', { id });
      return mapLocation(row as SqlRow);
    },

    /**
     * Deletes a location.
     *
     * Refuses while anything still lives there unless told what to do with it.
     * Deleting a shelf must not silently delete everything on it.
     */
    async remove(
      id: string,
      options: { reassignItemsTo?: string | null; reparentChildrenTo?: string | null } = {},
    ): Promise<void> {
      const itemCount = Number(
        (await db.selectValue<number>('SELECT count(*) FROM items WHERE location_id = :id', { id })) ?? 0,
      );
      const childCount = Number(
        (await db.selectValue<number>('SELECT count(*) FROM locations WHERE parent_id = :id', { id })) ?? 0,
      );

      if (
        (itemCount > 0 && options.reassignItemsTo === undefined) ||
        (childCount > 0 && options.reparentChildrenTo === undefined)
      ) {
        throw new LocationInUseError(id, itemCount, childCount);
      }

      const now = nowInstant();
      await db.batch([
        ...(itemCount > 0
          ? [
              {
                sql: 'UPDATE items SET location_id = :target, updated_at = :now WHERE location_id = :id',
                params: { id, target: options.reassignItemsTo ?? null, now },
              },
            ]
          : []),
        ...(childCount > 0
          ? [
              {
                sql: 'UPDATE locations SET parent_id = :target, updated_at = :now WHERE parent_id = :id',
                params: { id, target: options.reparentChildrenTo ?? null, now },
              },
            ]
          : []),
        { sql: 'DELETE FROM locations WHERE id = :id', params: { id } },
      ]);
    },

    /** The full hierarchy with item counts, ready for a tree view. */
    async tree(): Promise<LocationNode[]> {
      const locations = await list();
      const countRows = await db.select<{ location_id: string | null; n: number }>(
        `SELECT location_id, count(*) AS n FROM items
          WHERE archived_at IS NULL GROUP BY location_id`,
      );
      const counts = new Map<string, number>();
      for (const row of countRows) {
        if (row.location_id === null) continue;
        counts.set(String(row.location_id), Number(row.n));
      }

      const childrenByParent = new Map<string | null, Location[]>();
      for (const location of locations) {
        const bucket = childrenByParent.get(location.parentId) ?? [];
        bucket.push(location);
        childrenByParent.set(location.parentId, bucket);
      }

      // Guards against a cycle introduced by a hand-edited or imported database:
      // without `seen`, a parent loop would recurse until the stack overflows.
      const seen = new Set<string>();
      const build = (parentId: string | null, depth: number, path: string[]): LocationNode[] =>
        (childrenByParent.get(parentId) ?? [])
          .filter((location) => !seen.has(location.id))
          .map((location) => {
            seen.add(location.id);
            const nextPath = [...path, location.name];
            return {
              ...location,
              depth,
              path: nextPath,
              itemCount: counts.get(location.id) ?? 0,
              children: build(location.id, depth + 1, nextPath),
            };
          });

      const roots = build(null, 0, []);

      // Anything unreachable from a root (an orphan whose parent was removed by
      // a partial import) is surfaced at the top rather than disappearing.
      const orphans = locations
        .filter((location) => !seen.has(location.id))
        .map((location) => ({
          ...location,
          depth: 0,
          path: [location.name],
          itemCount: counts.get(location.id) ?? 0,
          children: [] as LocationNode[],
        }));

      return [...roots, ...orphans];
    },
  };
}

export type LocationsRepository = ReturnType<typeof createLocationsRepository>;
