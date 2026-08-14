/**
 * Reading backups.
 *
 * This is the most dangerous operation in the application, so it is split in two
 * and the halves are separated by the user:
 *
 *   inspectBackup()  reads and validates a file and reports what it contains.
 *                    Touches nothing.
 *   applyImport()    writes, in a single transaction, only after the user has
 *                    seen that report and chosen merge or replace.
 *
 * The original application did none of this: `importData` checked
 * `Array.isArray`, assigned the parsed value straight over the inventory, and
 * the very next render persisted it. One mis-click destroyed everything with no
 * confirmation and no undo.
 *
 * Nothing here throws at the user. Every failure becomes a readable message on
 * the report, because "Unexpected token < in JSON at position 0" tells someone
 * trying to recover their inventory precisely nothing.
 */
import type { SqlDriver, SqlValue } from '../../database/driver/types';
import { nowInstant, toCalendarDate } from '../../domain/dates';
import { foldText } from '../../domain/normalize';
import { LATEST_SCHEMA_VERSION } from '../../database/migrations';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  LIMITS,
  backupEnvelopeSchema,
  checksumOf,
  legacyBackupSchema,
  type BackupData,
  type BackupEnvelope,
} from './format';
import { mapLegacyBackup, type LegacyMappingSummary } from './legacy';

export type ImportMode = 'merge' | 'replace';
export type BackupSource = 'v2' | 'legacy';

export type ImportProblemCode =
  | 'file-too-large'
  | 'not-json'
  | 'unrecognised-format'
  | 'invalid-structure'
  | 'checksum-mismatch'
  | 'newer-schema'
  | 'newer-format'
  | 'record-rejected'
  | 'field-unreadable';

export interface ImportProblem {
  readonly code: ImportProblemCode;
  /** `error` blocks the import; `warning` is shown but does not. */
  readonly severity: 'error' | 'warning';
  readonly detail: string;
  readonly count?: number;
}

export interface ImportPreview {
  readonly ok: boolean;
  readonly source: BackupSource | null;
  readonly formatVersion: number | null;
  readonly schemaVersion: number | null;
  readonly appVersion: string | null;
  readonly exportedAt: string | null;
  readonly checksumValid: boolean | null;
  readonly counts: {
    readonly items: number;
    readonly categories: number;
    readonly locations: number;
    readonly contacts: number;
    readonly transactions: number;
  };
  /** Items already present, matched on folded name + category + expiry. */
  readonly duplicates: number;
  readonly problems: readonly ImportProblem[];
  /** Opaque payload for `applyImport`; never rendered. */
  readonly payload: PreparedImport | null;
}

export interface PreparedImport {
  readonly source: BackupSource;
  readonly data: BackupData;
  readonly legacy: LegacyMappingSummary | null;
}

export interface ImportResult {
  readonly mode: ImportMode;
  readonly itemsInserted: number;
  readonly itemsSkipped: number;
  readonly categoriesInserted: number;
  readonly locationsInserted: number;
  readonly contactsInserted: number;
  readonly transactionsInserted: number;
  readonly settingsApplied: number;
}

const EMPTY_COUNTS = {
  items: 0,
  categories: 0,
  locations: 0,
  contacts: 0,
  transactions: 0,
} as const;

function failure(problems: ImportProblem[]): ImportPreview {
  return {
    ok: false,
    source: null,
    formatVersion: null,
    schemaVersion: null,
    appVersion: null,
    exportedAt: null,
    checksumValid: null,
    counts: EMPTY_COUNTS,
    duplicates: 0,
    problems,
    payload: null,
  };
}

/** Identity used to recognise "this item is already here" on a merge. */
function duplicateKey(name: string, categoryId: string | null, expiry: string | null): string {
  return `${foldText(name)}|${categoryId ?? ''}|${expiry ?? ''}`;
}

/**
 * Reads a backup and reports what it holds. Never writes.
 */
export async function inspectBackup(text: string, db: SqlDriver): Promise<ImportPreview> {
  // Bounded before parsing: a 2 GB file must be refused, not loaded.
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > LIMITS.maxFileBytes) {
    return failure([
      {
        code: 'file-too-large',
        severity: 'error',
        detail: `This file is ${(byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${String(
          LIMITS.maxFileBytes / 1024 / 1024,
        )} MB.`,
      },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure([
      {
        code: 'not-json',
        severity: 'error',
        detail: 'This file is not readable as a backup. It may be damaged or incomplete.',
      },
    ]);
  }

  return Array.isArray(parsed)
    ? inspectLegacy(parsed, db)
    : inspectEnvelope(parsed, db);
}

async function inspectLegacy(parsed: unknown[], db: SqlDriver): Promise<ImportPreview> {
  const result = legacyBackupSchema.safeParse(parsed);
  if (!result.success) {
    return failure([
      {
        code: 'invalid-structure',
        severity: 'error',
        detail:
          'This looks like a Stock Guardian v1 backup, but its records are not in the expected ' +
          'shape. Your existing data has NOT been changed.',
      },
    ]);
  }

  const mapping = mapLegacyBackup(result.data);
  const problems: ImportProblem[] = [];

  if (mapping.rejected.length > 0) {
    problems.push({
      code: 'record-rejected',
      severity: 'warning',
      count: mapping.rejected.length,
      detail: `${String(mapping.rejected.length)} record(s) have no name and cannot be imported.`,
    });
  }
  for (const [count, what] of [
    [mapping.counts.quantityUnreadable, 'quantity'],
    [mapping.counts.expiryUnreadable, 'expiry date'],
    [mapping.counts.categoryUnrecognised, 'category'],
  ] as const) {
    if (count === 0) continue;
    problems.push({
      code: 'field-unreadable',
      severity: 'warning',
      count,
      detail:
        `${String(count)} record(s) have a ${what} that could not be read. The original value ` +
        `is kept with the item so nothing is lost.`,
    });
  }

  const data: BackupData = {
    items: mapping.items.map((item) => ({
      name: item.name,
      categoryId: item.categoryId,
      locationId: null,
      quantity: item.quantity,
      unit: item.unit,
      minimumQuantity: null,
      idealQuantity: null,
      expirationDate: item.expirationDate,
      purchaseDate: null,
      openedDate: null,
      condition: null,
      priority: 3,
      notes: null,
      barcode: null,
      catalogItemId: null,
      archivedAt: null,
      migrationNotes: item.migrationNotes,
      createdAt: null,
      updatedAt: null,
    })),
    itemNames: [],
    categories: [],
    locations: [],
    contacts: [],
    transactions: [],
    settings: {},
  };

  const duplicates = await countDuplicates(db, data.items);

  return {
    ok: true,
    source: 'legacy',
    formatVersion: 1,
    schemaVersion: null,
    appVersion: null,
    exportedAt: null,
    checksumValid: null,
    counts: { ...EMPTY_COUNTS, items: mapping.items.length },
    duplicates,
    problems,
    payload: { source: 'legacy', data, legacy: mapping },
  };
}

async function inspectEnvelope(parsed: unknown, db: SqlDriver): Promise<ImportPreview> {
  const candidate = parsed as { format?: unknown };
  if (candidate?.format !== BACKUP_FORMAT) {
    return failure([
      {
        code: 'unrecognised-format',
        severity: 'error',
        detail:
          'This is not a Stock Guardian backup. Your existing data has NOT been changed.',
      },
    ]);
  }

  const result = backupEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return failure([
      {
        code: 'invalid-structure',
        severity: 'error',
        detail:
          'This backup is damaged and cannot be read safely' +
          (first === undefined ? '' : ` (problem at "${first.path.join('.')}")`) +
          '. Your existing data has NOT been changed.',
      },
    ]);
  }

  const envelope: BackupEnvelope = result.data;
  const problems: ImportProblem[] = [];

  if (envelope.formatVersion > BACKUP_FORMAT_VERSION) {
    problems.push({
      code: 'newer-format',
      severity: 'error',
      detail:
        `This backup uses format version ${String(envelope.formatVersion)}; this version of ` +
        `Stock Guardian understands up to ${String(BACKUP_FORMAT_VERSION)}. Update the app first.`,
    });
  }

  if (envelope.schemaVersion > LATEST_SCHEMA_VERSION) {
    problems.push({
      code: 'newer-schema',
      severity: 'error',
      detail:
        `This backup was made by a newer version of Stock Guardian (schema v${String(
          envelope.schemaVersion,
        )}; this version supports v${String(LATEST_SCHEMA_VERSION)}). Update the app first.`,
    });
  }

  // A mismatch means the file changed after it was written. It is reported
  // rather than treated as fatal: a hand-edited backup is still the user's data,
  // and refusing outright could strand someone's only copy.
  let checksumValid: boolean | null = null;
  if (envelope.checksum !== undefined) {
    checksumValid = (await checksumOf(envelope.data)) === envelope.checksum;
    if (!checksumValid) {
      problems.push({
        code: 'checksum-mismatch',
        severity: 'warning',
        detail:
          'This backup has been modified since it was created. It can still be imported, but ' +
          'check the contents below before continuing.',
      });
    }
  }

  const duplicates = await countDuplicates(db, envelope.data.items);

  return {
    ok: problems.every((p) => p.severity !== 'error'),
    source: 'v2',
    formatVersion: envelope.formatVersion,
    schemaVersion: envelope.schemaVersion,
    appVersion: envelope.appVersion,
    exportedAt: envelope.exportedAt,
    checksumValid,
    counts: {
      items: envelope.data.items.length,
      categories: envelope.data.categories.length,
      locations: envelope.data.locations.length,
      contacts: envelope.data.contacts.length,
      transactions: envelope.data.transactions.length,
    },
    duplicates,
    problems,
    payload: { source: 'v2', data: envelope.data, legacy: null },
  };
}

async function countDuplicates(
  db: SqlDriver,
  items: BackupData['items'],
): Promise<number> {
  if (items.length === 0) return 0;
  const existing = await db.select<{ name_norm: string; category_id: string | null; expiration_date: string | null }>(
    'SELECT name_norm, category_id, expiration_date FROM items',
  );
  const keys = new Set(
    existing.map((row) =>
      duplicateKey(
        String(row.name_norm),
        row.category_id === null ? null : String(row.category_id),
        row.expiration_date === null ? null : String(row.expiration_date),
      ),
    ),
  );
  // The stored value is already folded, so fold only what is incoming.
  return items.filter((item) =>
    keys.has(`${foldText(item.name)}|${item.categoryId ?? ''}|${item.expirationDate ?? ''}`),
  ).length;
}

/**
 * Applies a previously inspected import.
 *
 * Everything happens inside one transaction: either the whole backup lands or
 * the database is exactly as it was. `replace` clears user data first, but only
 * inside that same transaction, so a failure halfway cannot leave the user with
 * neither their old inventory nor their new one.
 */
export async function applyImport(
  db: SqlDriver,
  prepared: PreparedImport,
  mode: ImportMode,
): Promise<ImportResult> {
  const now = nowInstant();
  const data = prepared.data;

  return db.transaction(async (tx) => {
    if (mode === 'replace') {
      // Reference data (system categories, the catalog) is left alone: it ships
      // with the app and is re-seeded, not restored.
      for (const sql of [
        'DELETE FROM stock_transactions',
        'DELETE FROM item_names',
        'DELETE FROM items',
        'DELETE FROM contacts',
        'DELETE FROM locations',
        'DELETE FROM category_names WHERE category_id IN (SELECT id FROM categories WHERE is_system = 0)',
        'DELETE FROM categories WHERE is_system = 0',
      ]) {
        await tx.execScript(sql);
      }
    }

    let categoriesInserted = 0;
    let locationsInserted = 0;
    let contactsInserted = 0;
    let transactionsInserted = 0;

    // ---- categories --------------------------------------------------------
    const existingCategories = new Set(
      (await tx.select<{ id: string }>('SELECT id FROM categories')).map((r) => String(r.id)),
    );

    for (const category of data.categories) {
      if (existingCategories.has(category.id)) continue;
      await tx.exec(
        `INSERT INTO categories (id, icon, color, sort_order, is_system, active, created_at, updated_at)
         VALUES (:id, :icon, :color, :sortOrder, 0, :active, :now, :now)`,
        {
          id: category.id,
          icon: category.icon,
          color: category.color,
          sortOrder: category.sortOrder,
          active: category.active ? 1 : 0,
          now,
        },
      );
      for (const [lang, name] of Object.entries(category.names)) {
        await tx.exec(
          `INSERT INTO category_names (category_id, lang, name, name_norm)
           VALUES (:id, :lang, :name, :norm)
           ON CONFLICT (category_id, lang) DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm`,
          { id: category.id, lang, name, norm: foldText(name) },
        );
      }
      existingCategories.add(category.id);
      categoriesInserted += 1;
    }

    // A legacy record whose category label matched nothing keeps that label as a
    // real category rather than losing the classification entirely.
    const legacyCategoryIdByLabel = new Map<string, string>();
    if (prepared.legacy !== null) {
      const labels = new Set(
        prepared.legacy.items
          .map((item) => item.categoryLabel)
          .filter((label): label is string => label !== null),
      );
      for (const label of labels) {
        const id = `imported-${foldText(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
        legacyCategoryIdByLabel.set(label, id);
        if (existingCategories.has(id)) continue;
        await tx.exec(
          `INSERT INTO categories (id, sort_order, is_system, active, created_at, updated_at)
           VALUES (:id, 999, 0, 1, :now, :now)`,
          { id, now },
        );
        await tx.exec(
          `INSERT INTO category_names (category_id, lang, name, name_norm)
           VALUES (:id, 'en', :name, :norm)`,
          { id, name: label, norm: foldText(label) },
        );
        existingCategories.add(id);
        categoriesInserted += 1;
      }
    }

    // ---- locations ---------------------------------------------------------
    const existingLocations = new Map(
      (await tx.select<{ id: string; name_norm: string }>('SELECT id, name_norm FROM locations')).map(
        (r) => [String(r.name_norm), String(r.id)],
      ),
    );
    const locationIds = new Set(existingLocations.values());

    // Inserted without parents first, then linked: a backup may list a child
    // before its parent, and a foreign key would reject that ordering.
    for (const location of data.locations) {
      if (locationIds.has(location.id)) continue;
      await tx.exec(
        `INSERT INTO locations (id, name, name_norm, description, parent_id, notes, sort_order, created_at, updated_at)
         VALUES (:id, :name, :norm, :description, NULL, :notes, :sortOrder, :now, :now)`,
        {
          id: location.id,
          name: location.name,
          norm: foldText(location.name),
          description: location.description,
          notes: location.notes,
          sortOrder: location.sortOrder,
          now,
        },
      );
      locationIds.add(location.id);
      existingLocations.set(foldText(location.name), location.id);
      locationsInserted += 1;
    }
    for (const location of data.locations) {
      if (location.parentId === null || !locationIds.has(location.parentId)) continue;
      await tx.exec('UPDATE locations SET parent_id = :parent WHERE id = :id', {
        id: location.id,
        parent: location.parentId,
      });
    }

    // Legacy records carried a free-text location; match one that already exists
    // (accent- and case-insensitively) before creating another.
    const legacyLocationIdByName = new Map<string, string>();
    if (prepared.legacy !== null) {
      const names = new Set(
        prepared.legacy.items
          .map((item) => item.locationName)
          .filter((name): name is string => name !== null),
      );
      for (const name of names) {
        const norm = foldText(name);
        const existing = existingLocations.get(norm);
        if (existing !== undefined) {
          legacyLocationIdByName.set(name, existing);
          continue;
        }
        const id = crypto.randomUUID();
        await tx.exec(
          `INSERT INTO locations (id, name, name_norm, sort_order, created_at, updated_at)
           VALUES (:id, :name, :norm, 0, :now, :now)`,
          { id, name, norm, now },
        );
        existingLocations.set(norm, id);
        locationIds.add(id);
        legacyLocationIdByName.set(name, id);
        locationsInserted += 1;
      }
    }

    // ---- items -------------------------------------------------------------
    const existingKeys = new Set(
      (
        await tx.select<{ name_norm: string; category_id: string | null; expiration_date: string | null }>(
          'SELECT name_norm, category_id, expiration_date FROM items',
        )
      ).map((row) =>
        `${String(row.name_norm)}|${row.category_id === null ? '' : String(row.category_id)}|${
          row.expiration_date === null ? '' : String(row.expiration_date)
        }`,
      ),
    );
    const existingItemIds = new Set(
      (await tx.select<{ id: string }>('SELECT id FROM items')).map((r) => String(r.id)),
    );

    let itemsInserted = 0;
    let itemsSkipped = 0;
    const idByIndex = new Map<number, string>();

    const legacyItems = prepared.legacy?.items ?? [];

    for (const [index, item] of data.items.entries()) {
      const legacy = prepared.legacy === null ? undefined : legacyItems[index];
      const categoryId =
        item.categoryId ??
        (legacy?.categoryLabel != null
          ? (legacyCategoryIdByLabel.get(legacy.categoryLabel) ?? null)
          : null);
      const locationId =
        item.locationId ??
        (legacy?.locationName != null
          ? (legacyLocationIdByName.get(legacy.locationName) ?? null)
          : null);

      const key = `${foldText(item.name)}|${categoryId ?? ''}|${item.expirationDate ?? ''}`;
      if (mode === 'merge' && existingKeys.has(key)) {
        itemsSkipped += 1;
        continue;
      }

      let id = item.id ?? crypto.randomUUID();
      if (existingItemIds.has(id)) id = crypto.randomUUID();

      const values: Record<string, SqlValue> = {
        id,
        name: item.name,
        name_norm: foldText(item.name),
        category_id: existingCategories.has(categoryId ?? '') ? categoryId : null,
        location_id: locationId !== null && locationIds.has(locationId) ? locationId : null,
        quantity: item.quantity ?? 0,
        unit: item.unit ?? 'un',
        minimum_quantity: item.minimumQuantity,
        ideal_quantity: item.idealQuantity,
        expiration_date: toCalendarDate(item.expirationDate),
        purchase_date: toCalendarDate(item.purchaseDate),
        opened_date: toCalendarDate(item.openedDate),
        condition: item.condition,
        priority: item.priority,
        notes: item.notes,
        barcode: item.barcode,
        catalog_item_id: null,
        archived_at: item.archivedAt,
        migration_notes: item.migrationNotes,
        created_at: item.createdAt ?? now,
        updated_at: item.updatedAt ?? now,
      };
      const columns = Object.keys(values);
      await tx.exec(
        `INSERT INTO items (${columns.join(', ')}) VALUES (${columns.map((c) => `:${c}`).join(', ')})`,
        values,
      );

      existingKeys.add(key);
      existingItemIds.add(id);
      idByIndex.set(index, id);
      itemsInserted += 1;
    }

    // ---- item names, contacts, transactions --------------------------------
    for (const entry of data.itemNames) {
      if (!existingItemIds.has(entry.itemId)) continue;
      await tx.exec(
        `INSERT INTO item_names (item_id, lang, name, name_norm) VALUES (:id, :lang, :name, :norm)
         ON CONFLICT (item_id, lang) DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm`,
        { id: entry.itemId, lang: entry.lang, name: entry.name, norm: foldText(entry.name) },
      );
    }

    const existingContacts = new Set(
      (await tx.select<{ id: string }>('SELECT id FROM contacts')).map((r) => String(r.id)),
    );
    for (const contact of data.contacts) {
      if (existingContacts.has(contact.id)) continue;
      await tx.exec(
        `INSERT INTO contacts (id, name, name_norm, relationship, phone, email, location, notes, priority, created_at, updated_at)
         VALUES (:id, :name, :norm, :relationship, :phone, :email, :location, :notes, :priority, :now, :now)`,
        {
          id: contact.id,
          name: contact.name,
          norm: foldText(contact.name),
          relationship: contact.relationship,
          phone: contact.phone,
          email: contact.email,
          location: contact.location,
          notes: contact.notes,
          priority: contact.priority,
          now,
        },
      );
      contactsInserted += 1;
    }

    for (const transaction of data.transactions) {
      // History for an item that was skipped as a duplicate would be orphaned.
      if (!existingItemIds.has(transaction.itemId)) continue;
      await tx.exec(
        `INSERT INTO stock_transactions
           (id, item_id, type, quantity, quantity_before, quantity_after,
            source_location_id, destination_location_id, occurred_at, notes, created_at)
         VALUES (:id, :itemId, :type, :quantity, :before, :after, :source, :destination, :occurred, :notes, :now)
         ON CONFLICT (id) DO NOTHING`,
        {
          id: transaction.id,
          itemId: transaction.itemId,
          type: transaction.type,
          quantity: transaction.quantity,
          before: transaction.quantityBefore,
          after: transaction.quantityAfter,
          source:
            transaction.sourceLocationId !== null && locationIds.has(transaction.sourceLocationId)
              ? transaction.sourceLocationId
              : null,
          destination:
            transaction.destinationLocationId !== null &&
            locationIds.has(transaction.destinationLocationId)
              ? transaction.destinationLocationId
              : null,
          occurred: transaction.occurredAt,
          notes: transaction.notes,
          now,
        },
      );
      transactionsInserted += 1;
    }

    // ---- settings ----------------------------------------------------------
    let settingsApplied = 0;
    for (const [key, value] of Object.entries(data.settings)) {
      await tx.exec(
        `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :now)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        { key, value: JSON.stringify(value), now },
      );
      settingsApplied += 1;
    }

    return {
      mode,
      itemsInserted,
      itemsSkipped,
      categoriesInserted,
      locationsInserted,
      contactsInserted,
      transactionsInserted,
      settingsApplied,
    };
  }, 'IMMEDIATE');
}
