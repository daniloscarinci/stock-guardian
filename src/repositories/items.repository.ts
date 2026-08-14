/**
 * Inventory item persistence.
 *
 * Speaks only `SqlDriver`, so it runs unchanged against the browser worker, the
 * in-process test driver, and a future native desktop driver. Every row is
 * mapped explicitly - nothing above this layer sees a snake_case column or a
 * raw SQL null.
 */
import type { BatchOp, BindParams, SqlDriver, SqlRow, SqlValue } from '../database/driver/types';
import { addCalendarDays, nowInstant, toCalendarDate } from '../domain/dates';
import { DEFAULT_EXPIRY_WINDOWS, type ExpiryBucket } from '../domain/expiry';
import type { StockStatus } from '../domain/stock';
import { foldText, searchTerms } from '../domain/normalize';
import type {
  InventoryItem,
  InventoryItemView,
  ItemCondition,
  Page,
  Priority,
  StockTransactionType,
} from '../types/domain';
import { pickUsedParams } from './sql/bind';
import {
  buildKeysetCondition,
  buildKeysetPlan,
  cursorFromRow,
  decodeCursor,
  type KeyPart,
} from './sql/keyset';
import {
  daysUntilExpirySql,
  effectiveMinimumSql,
  expiryBucketSql,
  neededSql,
  stockStatusSql,
} from './sql/status-expressions';

export type ArchivedFilter = 'active' | 'archived' | 'all';

export type ItemSortField =
  | 'name'
  | 'quantity'
  | 'expiration'
  | 'updated'
  | 'created'
  | 'priority'
  | 'category'
  | 'location';

export interface ItemSort {
  readonly field: ItemSortField;
  readonly direction: 'asc' | 'desc';
}

export interface ItemFilters {
  readonly search?: string;
  readonly categoryIds?: readonly string[];
  readonly locationIds?: readonly string[];
  /** Include items in descendant locations of the selected ones. */
  readonly includeSublocations?: boolean;
  readonly stockStatuses?: readonly StockStatus[];
  readonly expiryBuckets?: readonly ExpiryBucket[];
  readonly priorities?: readonly Priority[];
  readonly conditions?: readonly ItemCondition[];
  readonly archived?: ArchivedFilter;
  readonly catalogItemId?: string;
}

export interface ListItemsOptions {
  readonly filters?: ItemFilters;
  readonly sort?: ItemSort;
  readonly limit?: number;
  readonly cursor?: string | null;
  /** UI language, used to resolve category names for display and search. */
  readonly lang?: string;
}

export interface ItemContext {
  readonly today: string;
  readonly defaultThreshold: number;
  readonly expiryWindows: readonly number[];
}

export interface CreateItemInput {
  readonly name: string;
  readonly categoryId?: string | null;
  readonly locationId?: string | null;
  readonly quantity?: number;
  readonly unit?: string;
  readonly minimumQuantity?: number | null;
  readonly idealQuantity?: number | null;
  readonly expirationDate?: string | null;
  readonly purchaseDate?: string | null;
  readonly openedDate?: string | null;
  readonly condition?: ItemCondition | null;
  readonly priority?: Priority;
  readonly notes?: string | null;
  readonly barcode?: string | null;
  readonly catalogItemId?: string | null;
  readonly migrationNotes?: string | null;
  readonly id?: string;
  readonly createdAt?: string;
}

export type UpdateItemInput = Partial<Omit<CreateItemInput, 'id' | 'createdAt'>>;

export interface AdjustQuantityOptions {
  readonly type?: StockTransactionType;
  readonly notes?: string | null;
  readonly occurredAt?: string;
}

export interface DashboardStats {
  readonly totalItems: number;
  readonly totalQuantity: number;
  readonly categoriesUsed: number;
  readonly locationsUsed: number;
  readonly expired: number;
  readonly expiringToday: number;
  readonly expiringSoon: number;
  readonly noExpiration: number;
  readonly critical: number;
  readonly low: number;
  readonly archived: number;
  readonly recentlyModified: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** Columns of `items`, aliased so the mapper reads one shape everywhere. */
const ITEM_COLUMNS = `
  i.id, i.name, i.category_id, i.location_id, i.quantity, i.unit,
  i.minimum_quantity, i.ideal_quantity, i.expiration_date, i.purchase_date,
  i.opened_date, i.condition, i.priority, i.notes, i.barcode, i.photo_id,
  i.catalog_item_id, i.archived_at, i.migration_notes, i.created_at, i.updated_at
`;

interface ItemRow extends SqlRow {
  id: string;
  name: string;
  category_id: string | null;
  location_id: string | null;
  quantity: number;
  unit: string;
  minimum_quantity: number | null;
  ideal_quantity: number | null;
  expiration_date: string | null;
  purchase_date: string | null;
  opened_date: string | null;
  condition: string | null;
  priority: number;
  notes: string | null;
  barcode: string | null;
  photo_id: string | null;
  catalog_item_id: string | null;
  archived_at: string | null;
  migration_notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapItem(row: ItemRow): InventoryItem {
  return {
    id: String(row.id),
    name: String(row.name),
    categoryId: row.category_id === null ? null : String(row.category_id),
    locationId: row.location_id === null ? null : String(row.location_id),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    minimumQuantity: row.minimum_quantity === null ? null : Number(row.minimum_quantity),
    idealQuantity: row.ideal_quantity === null ? null : Number(row.ideal_quantity),
    expirationDate: row.expiration_date === null ? null : String(row.expiration_date),
    purchaseDate: row.purchase_date === null ? null : String(row.purchase_date),
    openedDate: row.opened_date === null ? null : String(row.opened_date),
    condition: row.condition === null ? null : (String(row.condition) as ItemCondition),
    priority: Number(row.priority) as Priority,
    notes: row.notes === null ? null : String(row.notes),
    barcode: row.barcode === null ? null : String(row.barcode),
    photoId: row.photo_id === null ? null : String(row.photo_id),
    catalogItemId: row.catalog_item_id === null ? null : String(row.catalog_item_id),
    archivedAt: row.archived_at === null ? null : String(row.archived_at),
    migrationNotes: row.migration_notes === null ? null : String(row.migration_notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

interface ItemViewRow extends ItemRow {
  stock_status: string;
  expiry_bucket: string;
  days_until_expiry: number | null;
  needed: number;
  effective_minimum: number;
  category_name: string | null;
  location_name: string | null;
}

function mapItemView(row: ItemViewRow): InventoryItemView {
  return {
    ...mapItem(row),
    stockStatus: String(row.stock_status) as StockStatus,
    expiryBucket: String(row.expiry_bucket) as ExpiryBucket,
    daysUntilExpiry: row.days_until_expiry === null ? null : Number(row.days_until_expiry),
    needed: Number(row.needed),
    effectiveMinimum: Number(row.effective_minimum),
    categoryName: row.category_name === null ? null : String(row.category_name),
    locationName: row.location_name === null ? null : String(row.location_name),
  };
}

const SORT_KEYS: Record<ItemSortField, (direction: 'asc' | 'desc') => KeyPart[]> = {
  name: (direction) => [{ expr: 'i.name_norm', direction }],
  quantity: (direction) => [{ expr: 'i.quantity', direction }],
  expiration: (direction) => [{ expr: 'i.expiration_date', direction, nullsLast: true }],
  updated: (direction) => [{ expr: 'i.updated_at', direction }],
  created: (direction) => [{ expr: 'i.created_at', direction }],
  priority: (direction) => [
    { expr: 'i.priority', direction },
    { expr: 'i.name_norm', direction: 'asc' },
  ],
  category: (direction) => [
    { expr: 'category_name', direction, nullsLast: true },
    { expr: 'i.name_norm', direction: 'asc' },
  ],
  location: (direction) => [
    { expr: 'location_name', direction, nullsLast: true },
    { expr: 'i.name_norm', direction: 'asc' },
  ],
};

/** Builds `?, ?, ?` and appends the values, for an `IN` list of unknown length. */
function inClause(
  column: string,
  values: readonly string[] | readonly number[],
  params: Record<string, SqlValue>,
  prefix: string,
): string {
  const names = values.map((value, index) => {
    const key = `${prefix}${index}`;
    params[key] = value as SqlValue;
    return `:${key}`;
  });
  return `${column} IN (${names.join(', ')})`;
}

export function createItemsRepository(db: SqlDriver) {
  /**
   * The FROM/JOIN block shared by every read.
   *
   * Category names are resolved to the active language with an English
   * fallback, so a Portuguese interface still shows something sensible for a
   * category that has only been named in English.
   */
  const fromClause = `
    FROM items i
    LEFT JOIN category_names cn
      ON cn.category_id = i.category_id AND cn.lang = :lang
    LEFT JOIN category_names cn_fallback
      ON cn_fallback.category_id = i.category_id AND cn_fallback.lang = 'en'
    LEFT JOIN locations l ON l.id = i.location_id
  `;

  const categoryNameExpr = 'COALESCE(cn.name, cn_fallback.name)';

  function buildWhere(
    filters: ItemFilters,
    params: Record<string, SqlValue>,
  ): string {
    const clauses: string[] = [];

    switch (filters.archived ?? 'active') {
      case 'active':
        clauses.push('i.archived_at IS NULL');
        break;
      case 'archived':
        clauses.push('i.archived_at IS NOT NULL');
        break;
      case 'all':
        break;
    }

    if (filters.categoryIds && filters.categoryIds.length > 0) {
      clauses.push(inClause('i.category_id', filters.categoryIds, params, 'cat'));
    }

    if (filters.locationIds && filters.locationIds.length > 0) {
      if (filters.includeSublocations === true) {
        // Walks the location tree in SQL so selecting "House" also finds items
        // on a shelf three levels down.
        const seeds = inClause('id', filters.locationIds, params, 'loc');
        clauses.push(`i.location_id IN (
          WITH RECURSIVE subtree(id) AS (
            SELECT id FROM locations WHERE ${seeds}
            UNION
            SELECT l2.id FROM locations l2 JOIN subtree s ON l2.parent_id = s.id
          )
          SELECT id FROM subtree
        )`);
      } else {
        clauses.push(inClause('i.location_id', filters.locationIds, params, 'loc'));
      }
    }

    if (filters.priorities && filters.priorities.length > 0) {
      clauses.push(inClause('i.priority', filters.priorities, params, 'prio'));
    }

    if (filters.conditions && filters.conditions.length > 0) {
      clauses.push(inClause('i.condition', filters.conditions, params, 'cond'));
    }

    if (filters.catalogItemId !== undefined) {
      params.catalogItemId = filters.catalogItemId;
      clauses.push('i.catalog_item_id = :catalogItemId');
    }

    if (filters.stockStatuses && filters.stockStatuses.length > 0) {
      clauses.push(inClause(`(${stockStatusSql()})`, filters.stockStatuses, params, 'stock'));
    }

    if (filters.expiryBuckets && filters.expiryBuckets.length > 0) {
      clauses.push(inClause(`(${expiryBucketSql()})`, filters.expiryBuckets, params, 'exp'));
    }

    // Multi-term search: every term must match somewhere, so "arroz despensa"
    // finds rice in the pantry rather than everything matching either word.
    const terms = searchTerms(filters.search ?? '');
    terms.forEach((term, index) => {
      const key = `q${index}`;
      params[key] = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      clauses.push(`(
        i.name_norm LIKE :${key} ESCAPE '\\'
        OR COALESCE(LOWER(i.notes), '') LIKE :${key} ESCAPE '\\'
        OR COALESCE(LOWER(i.barcode), '') LIKE :${key} ESCAPE '\\'
        OR COALESCE(l.name_norm, '') LIKE :${key} ESCAPE '\\'
        OR COALESCE(cn.name_norm, cn_fallback.name_norm, '') LIKE :${key} ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM item_names inm
           WHERE inm.item_id = i.id AND inm.name_norm LIKE :${key} ESCAPE '\\'
        )
      )`);
    });

    return clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
  }

  function contextParams(context: ItemContext, lang: string): Record<string, SqlValue> {
    const windows = context.expiryWindows.length > 0 ? context.expiryWindows : DEFAULT_EXPIRY_WINDOWS;
    return {
      lang,
      today: context.today,
      expiryHorizon: addCalendarDays(context.today, Math.max(...windows)),
      defaultThreshold: context.defaultThreshold,
    };
  }

  async function getById(id: string): Promise<InventoryItem | undefined> {
    const row = await db.selectOne<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = :id`,
      { id },
    );
    return row === undefined ? undefined : mapItem(row);
  }

  async function requireById(id: string): Promise<InventoryItem> {
    const item = await getById(id);
    if (item === undefined) {
      throw new Error(`No inventory item with id "${id}".`);
    }
    return item;
  }

  function insertOp(input: CreateItemInput, id: string, now: string): BatchOp {
    const values: Record<string, SqlValue> = {
      id,
      name: input.name.trim(),
      name_norm: foldText(input.name),
      category_id: input.categoryId ?? null,
      location_id: input.locationId ?? null,
      quantity: input.quantity ?? 0,
      unit: input.unit ?? 'un',
      minimum_quantity: input.minimumQuantity ?? null,
      ideal_quantity: input.idealQuantity ?? null,
      expiration_date: toCalendarDate(input.expirationDate ?? null),
      purchase_date: toCalendarDate(input.purchaseDate ?? null),
      opened_date: toCalendarDate(input.openedDate ?? null),
      condition: input.condition ?? null,
      priority: input.priority ?? 3,
      notes: input.notes ?? null,
      barcode: input.barcode ?? null,
      catalog_item_id: input.catalogItemId ?? null,
      migration_notes: input.migrationNotes ?? null,
      created_at: input.createdAt ?? now,
      updated_at: now,
    };
    const columns = Object.keys(values);
    return {
      sql: `INSERT INTO items (${columns.join(', ')})
            VALUES (${columns.map((c) => `:${c}`).join(', ')})`,
      params: values,
    };
  }

  return {
    getById,

    async create(input: CreateItemInput): Promise<InventoryItem> {
      const id = input.id ?? crypto.randomUUID();
      const now = nowInstant();
      const op = insertOp(input, id, now);
      await db.exec(op.sql, op.params as BindParams);
      return requireById(id);
    },

    /** Inserts many items atomically. Used by import; chunked by the caller. */
    async createMany(inputs: readonly CreateItemInput[]): Promise<number> {
      if (inputs.length === 0) return 0;
      const now = nowInstant();
      const ops = inputs.map((input) => insertOp(input, input.id ?? crypto.randomUUID(), now));
      await db.batch(ops);
      return ops.length;
    },

    async update(id: string, patch: UpdateItemInput): Promise<InventoryItem> {
      const columnByField: Record<string, string> = {
        name: 'name',
        categoryId: 'category_id',
        locationId: 'location_id',
        quantity: 'quantity',
        unit: 'unit',
        minimumQuantity: 'minimum_quantity',
        idealQuantity: 'ideal_quantity',
        expirationDate: 'expiration_date',
        purchaseDate: 'purchase_date',
        openedDate: 'opened_date',
        condition: 'condition',
        priority: 'priority',
        notes: 'notes',
        barcode: 'barcode',
        catalogItemId: 'catalog_item_id',
        migrationNotes: 'migration_notes',
      };

      const assignments: string[] = [];
      const params: Record<string, SqlValue> = { id, updated_at: nowInstant() };

      for (const [field, column] of Object.entries(columnByField)) {
        if (!(field in patch)) continue;
        let value = (patch as Record<string, unknown>)[field] as SqlValue;

        if (field === 'expirationDate' || field === 'purchaseDate' || field === 'openedDate') {
          value = toCalendarDate(value as string | null);
        }
        if (field === 'name') {
          const name = String(value ?? '').trim();
          if (name === '') throw new Error('An item needs a name.');
          value = name;
          params.name_norm = foldText(name);
          assignments.push('name_norm = :name_norm');
        }
        params[column] = value;
        assignments.push(`${column} = :${column}`);
      }

      if (assignments.length === 0) return requireById(id);

      assignments.push('updated_at = :updated_at');
      const result = await db.exec(
        `UPDATE items SET ${assignments.join(', ')} WHERE id = :id`,
        params,
      );
      if (result.rowsAffected === 0) throw new Error(`No inventory item with id "${id}".`);
      return requireById(id);
    },

    async remove(id: string): Promise<void> {
      await db.exec('DELETE FROM items WHERE id = :id', { id });
    },

    async archive(id: string): Promise<InventoryItem> {
      const now = nowInstant();
      await db.exec('UPDATE items SET archived_at = :now, updated_at = :now WHERE id = :id', {
        id,
        now,
      });
      return requireById(id);
    },

    async restore(id: string): Promise<InventoryItem> {
      const now = nowInstant();
      await db.exec('UPDATE items SET archived_at = NULL, updated_at = :now WHERE id = :id', {
        id,
        now,
      });
      return requireById(id);
    },

    /** Copies an item, including its settings but not its history. */
    async duplicate(id: string, nameSuffix = ' (copy)'): Promise<InventoryItem> {
      const source = await requireById(id);
      return this.create({
        name: `${source.name}${nameSuffix}`,
        categoryId: source.categoryId,
        locationId: source.locationId,
        quantity: source.quantity,
        unit: source.unit,
        minimumQuantity: source.minimumQuantity,
        idealQuantity: source.idealQuantity,
        expirationDate: source.expirationDate,
        purchaseDate: source.purchaseDate,
        openedDate: source.openedDate,
        condition: source.condition,
        priority: source.priority,
        notes: source.notes,
        barcode: source.barcode,
        catalogItemId: source.catalogItemId,
      });
    },

    /**
     * Changes quantity by a delta and records why, atomically.
     *
     * The quantity and its history move together or not at all: a `+`/`-` tap
     * that updated the count but lost the record would make the transaction log
     * quietly untrustworthy.
     */
    async adjustQuantity(
      id: string,
      delta: number,
      options: AdjustQuantityOptions = {},
    ): Promise<InventoryItem> {
      if (!Number.isFinite(delta) || delta === 0) return requireById(id);

      return db.transaction(async (tx) => {
        const current = await tx.selectOne<{ quantity: number; location_id: string | null }>(
          'SELECT quantity, location_id FROM items WHERE id = :id',
          { id },
        );
        if (current === undefined) throw new Error(`No inventory item with id "${id}".`);

        const before = Number(current.quantity);
        // Clamped at zero: the schema forbids negative stock, and silently
        // failing the whole adjustment would be worse than taking it to empty.
        const after = Math.max(0, Math.round((before + delta) * 1e6) / 1e6);
        const now = nowInstant();

        await tx.exec('UPDATE items SET quantity = :after, updated_at = :now WHERE id = :id', {
          id,
          after,
          now,
        });

        await tx.exec(
          `INSERT INTO stock_transactions
             (id, item_id, type, quantity, quantity_before, quantity_after,
              source_location_id, destination_location_id, occurred_at, notes, created_at)
           VALUES (:id, :item_id, :type, :quantity, :before, :after, :source, NULL, :occurred, :notes, :now)`,
          {
            id: crypto.randomUUID(),
            item_id: id,
            type: options.type ?? (delta > 0 ? 'add' : 'consume'),
            quantity: Math.abs(after - before),
            before,
            after,
            source: current.location_id,
            occurred: options.occurredAt ?? now,
            notes: options.notes ?? null,
            now,
          },
        );

        const row = await tx.selectOne<ItemRow>(
          `SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = :id`,
          { id },
        );
        return mapItem(row as ItemRow);
      });
    },

    /** Moves an item to another location, recording the move. */
    async transfer(
      id: string,
      destinationLocationId: string | null,
      notes?: string | null,
    ): Promise<InventoryItem> {
      return db.transaction(async (tx) => {
        const current = await tx.selectOne<{ quantity: number; location_id: string | null }>(
          'SELECT quantity, location_id FROM items WHERE id = :id',
          { id },
        );
        if (current === undefined) throw new Error(`No inventory item with id "${id}".`);

        const now = nowInstant();
        await tx.exec(
          'UPDATE items SET location_id = :destination, updated_at = :now WHERE id = :id',
          { id, destination: destinationLocationId, now },
        );

        await tx.exec(
          `INSERT INTO stock_transactions
             (id, item_id, type, quantity, quantity_before, quantity_after,
              source_location_id, destination_location_id, occurred_at, notes, created_at)
           VALUES (:id, :item_id, 'transfer', :quantity, :quantity, :quantity,
                   :source, :destination, :now, :notes, :now)`,
          {
            id: crypto.randomUUID(),
            item_id: id,
            quantity: Number(current.quantity),
            source: current.location_id,
            destination: destinationLocationId,
            notes: notes ?? null,
            now,
          },
        );

        const row = await tx.selectOne<ItemRow>(
          `SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = :id`,
          { id },
        );
        return mapItem(row as ItemRow);
      });
    },

    async list(
      context: ItemContext,
      options: ListItemsOptions = {},
    ): Promise<Page<InventoryItemView>> {
      const lang = options.lang ?? 'en';
      const filters = options.filters ?? {};
      const sort = options.sort ?? { field: 'name', direction: 'asc' };
      const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

      const params = contextParams(context, lang);
      const where = buildWhere(filters, params);

      const keyParts: KeyPart[] = [
        ...(SORT_KEYS[sort.field]?.(sort.direction) ?? SORT_KEYS.name('asc')),
        { expr: 'i.id', direction: 'asc' },
      ];
      const plan = buildKeysetPlan(keyParts);

      let keysetWhere = '';
      if (options.cursor != null && options.cursor !== '') {
        const condition = buildKeysetCondition(keyParts, decodeCursor(options.cursor));
        keysetWhere = where === '' ? `WHERE ${condition.sql}` : ` AND ${condition.sql}`;
        Object.assign(params, condition.params);
      }

      const selectExtras = plan.cursorColumns
        .map((c) => `${c.expr} AS ${c.alias}`)
        .join(',\n           ');

      const sql = `
        SELECT ${ITEM_COLUMNS},
               ${stockStatusSql()} AS stock_status,
               ${expiryBucketSql()} AS expiry_bucket,
               ${daysUntilExpirySql()} AS days_until_expiry,
               ${neededSql()} AS needed,
               ${effectiveMinimumSql()} AS effective_minimum,
               ${categoryNameExpr} AS category_name,
               l.name AS location_name,
               ${selectExtras}
        ${fromClause}
        ${where}${keysetWhere}
        ORDER BY ${plan.orderBy}
        LIMIT :limit
      `;

      const rows = await db.select<ItemViewRow>(
        sql,
        pickUsedParams(sql, { ...params, limit: limit + 1 }),
      );

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);

      const countSql = `SELECT count(*) ${fromClause} ${where}`;
      const total = Number(
        (await db.selectValue<number>(countSql, pickUsedParams(countSql, params))) ?? 0,
      );

      return {
        rows: page.map(mapItemView),
        nextCursor: hasMore && last !== undefined ? cursorFromRow(plan, last) : null,
        total,
      };
    },

    /**
     * Minimal fields for whole-inventory analysis (preparedness, replenishment).
     *
     * Deliberately narrow: eight columns over ten thousand rows is small enough
     * to score in memory, where the rules already live and are tested.
     */
    async listForAnalysis(): Promise<
      {
        id: string;
        name: string;
        unit: string;
        categoryId: string | null;
        locationId: string | null;
        quantity: number;
        minimumQuantity: number | null;
        idealQuantity: number | null;
        expirationDate: string | null;
        priority: Priority;
      }[]
    > {
      const rows = await db.select<ItemRow>(
        `SELECT i.id, i.name, i.unit, i.category_id, i.location_id, i.quantity,
                i.minimum_quantity, i.ideal_quantity, i.expiration_date, i.priority
           FROM items i WHERE i.archived_at IS NULL`,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        unit: String(row.unit),
        categoryId: row.category_id === null ? null : String(row.category_id),
        locationId: row.location_id === null ? null : String(row.location_id),
        quantity: Number(row.quantity),
        minimumQuantity: row.minimum_quantity === null ? null : Number(row.minimum_quantity),
        idealQuantity: row.ideal_quantity === null ? null : Number(row.ideal_quantity),
        expirationDate: row.expiration_date === null ? null : String(row.expiration_date),
        priority: Number(row.priority) as Priority,
      }));
    },

    async dashboardStats(context: ItemContext): Promise<DashboardStats> {
      const params = contextParams(context, 'en');
      const recentSince = addCalendarDays(context.today, -7);

      const statsSql = `SELECT
           count(*) FILTER (WHERE i.archived_at IS NULL) AS total_items,
           COALESCE(SUM(i.quantity) FILTER (WHERE i.archived_at IS NULL), 0) AS total_quantity,
           count(DISTINCT i.category_id) FILTER (WHERE i.archived_at IS NULL) AS categories_used,
           count(DISTINCT i.location_id) FILTER (WHERE i.archived_at IS NULL) AS locations_used,
           count(*) FILTER (WHERE i.archived_at IS NOT NULL) AS archived,
           count(*) FILTER (WHERE i.archived_at IS NULL AND (${expiryBucketSql()}) = 'expired') AS expired,
           count(*) FILTER (WHERE i.archived_at IS NULL AND (${expiryBucketSql()}) = 'today') AS expiring_today,
           count(*) FILTER (WHERE i.archived_at IS NULL AND (${expiryBucketSql()}) = 'soon') AS expiring_soon,
           count(*) FILTER (WHERE i.archived_at IS NULL AND (${expiryBucketSql()}) = 'none') AS no_expiration,
           count(*) FILTER (WHERE i.archived_at IS NULL AND (${stockStatusSql()}) = 'critical') AS critical,
           count(*) FILTER (WHERE i.archived_at IS NULL AND (${stockStatusSql()}) = 'low') AS low,
           count(*) FILTER (WHERE i.archived_at IS NULL AND i.updated_at >= :recentSince) AS recently_modified
         FROM items i`;

      const row = await db.selectOne<Record<string, number>>(
        statsSql,
        pickUsedParams(statsSql, { ...params, recentSince }),
      );

      const value = (key: string) => Number(row?.[key] ?? 0);
      return {
        totalItems: value('total_items'),
        totalQuantity: Math.round(value('total_quantity') * 1e6) / 1e6,
        categoriesUsed: value('categories_used'),
        locationsUsed: value('locations_used'),
        expired: value('expired'),
        expiringToday: value('expiring_today'),
        expiringSoon: value('expiring_soon'),
        noExpiration: value('no_expiration'),
        critical: value('critical'),
        low: value('low'),
        archived: value('archived'),
        recentlyModified: value('recently_modified'),
      };
    },

    /** Movement history for one item, newest first. */
    async history(itemId: string, limit = 100) {
      return db.select<SqlRow>(
        `SELECT id, item_id, type, quantity, quantity_before, quantity_after,
                source_location_id, destination_location_id, occurred_at, notes, created_at
           FROM stock_transactions
          WHERE item_id = :itemId
          -- rowid breaks the tie: two adjustments in the same millisecond share
          -- a timestamp, and without it their order would be undefined.
          ORDER BY occurred_at DESC, created_at DESC, rowid DESC
          LIMIT :limit`,
        { itemId, limit },
      );
    },
  };
}

export type ItemsRepository = ReturnType<typeof createItemsRepository>;
