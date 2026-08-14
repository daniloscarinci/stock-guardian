/**
 * Building backups.
 *
 * A backup is everything the user created: inventory, the categories and
 * locations they organised it into, contacts, movement history and settings.
 * The reference catalog is deliberately excluded - it ships with the
 * application, so copying 194 fixed rows into every backup would only make the
 * file bigger and the restore slower.
 */
import type { SqlDriver, SqlRow } from '../../database/driver/types';
import { nowInstant } from '../../domain/dates';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  checksumOf,
  type BackupData,
  type BackupEnvelope,
} from './format';

export const APP_VERSION = '2.0.0';

export interface ExportOptions {
  /** Movement history can dwarf the inventory itself; opt in when needed. */
  readonly includeTransactions?: boolean;
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export async function buildBackup(
  db: SqlDriver,
  options: ExportOptions = {},
): Promise<BackupEnvelope> {
  const schemaVersion = Number((await db.selectValue<number>('PRAGMA user_version')) ?? 0);

  const itemRows = await db.select<SqlRow>('SELECT * FROM items ORDER BY created_at, id');
  const itemNameRows = await db.select<SqlRow>('SELECT * FROM item_names');
  const categoryRows = await db.select<SqlRow>('SELECT * FROM categories ORDER BY sort_order, id');
  const categoryNameRows = await db.select<SqlRow>('SELECT * FROM category_names');
  const locationRows = await db.select<SqlRow>('SELECT * FROM locations ORDER BY sort_order, id');
  const contactRows = await db.select<SqlRow>('SELECT * FROM contacts ORDER BY priority, name');
  const settingRows = await db.select<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  );
  const transactionRows =
    options.includeTransactions === true
      ? await db.select<SqlRow>('SELECT * FROM stock_transactions ORDER BY occurred_at')
      : [];

  const namesByCategory = new Map<string, Record<string, string>>();
  for (const row of categoryNameRows) {
    const id = String(row.category_id);
    const bucket = namesByCategory.get(id) ?? {};
    bucket[String(row.lang)] = String(row.name);
    namesByCategory.set(id, bucket);
  }

  const settings: Record<string, unknown> = {};
  for (const row of settingRows) {
    try {
      settings[String(row.key)] = JSON.parse(String(row.value));
    } catch {
      // A corrupt setting is skipped rather than aborting the whole backup:
      // losing one preference is recoverable, losing the inventory is not.
    }
  }

  const data: BackupData = {
    items: itemRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      categoryId: nullable(row.category_id),
      locationId: nullable(row.location_id),
      quantity: Number(row.quantity),
      unit: String(row.unit),
      minimumQuantity: row.minimum_quantity === null ? null : Number(row.minimum_quantity),
      idealQuantity: row.ideal_quantity === null ? null : Number(row.ideal_quantity),
      expirationDate: nullable(row.expiration_date),
      purchaseDate: nullable(row.purchase_date),
      openedDate: nullable(row.opened_date),
      condition: nullable(row.condition) as BackupData['items'][number]['condition'],
      priority: Number(row.priority),
      notes: nullable(row.notes),
      barcode: nullable(row.barcode),
      catalogItemId: nullable(row.catalog_item_id),
      archivedAt: nullable(row.archived_at),
      migrationNotes: nullable(row.migration_notes),
      createdAt: nullable(row.created_at),
      updatedAt: nullable(row.updated_at),
    })),
    itemNames: itemNameRows.map((row) => ({
      itemId: String(row.item_id),
      lang: String(row.lang) as BackupData['itemNames'][number]['lang'],
      name: String(row.name),
    })),
    categories: categoryRows.map((row) => ({
      id: String(row.id),
      names: namesByCategory.get(String(row.id)) ?? {},
      icon: nullable(row.icon),
      color: nullable(row.color),
      sortOrder: Number(row.sort_order),
      isSystem: Number(row.is_system) === 1,
      active: Number(row.active) === 1,
    })),
    locations: locationRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: nullable(row.description),
      parentId: nullable(row.parent_id),
      notes: nullable(row.notes),
      sortOrder: Number(row.sort_order),
    })),
    contacts: contactRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      relationship: nullable(row.relationship),
      phone: nullable(row.phone),
      email: nullable(row.email),
      location: nullable(row.location),
      notes: nullable(row.notes),
      priority: Number(row.priority),
    })),
    transactions: transactionRows.map((row) => ({
      id: String(row.id),
      itemId: String(row.item_id),
      type: String(row.type) as BackupData['transactions'][number]['type'],
      quantity: Number(row.quantity),
      quantityBefore: Number(row.quantity_before),
      quantityAfter: Number(row.quantity_after),
      sourceLocationId: nullable(row.source_location_id),
      destinationLocationId: nullable(row.destination_location_id),
      occurredAt: String(row.occurred_at),
      notes: nullable(row.notes),
    })),
    settings,
  };

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion,
    appVersion: APP_VERSION,
    exportedAt: nowInstant(),
    counts: {
      items: data.items.length,
      categories: data.categories.length,
      locations: data.locations.length,
      contacts: data.contacts.length,
      transactions: data.transactions.length,
    },
    checksum: await checksumOf(data),
    data,
  };
}

export async function serializeBackup(
  db: SqlDriver,
  options: ExportOptions = {},
): Promise<string> {
  return JSON.stringify(await buildBackup(db, options), null, 2);
}

/** `stock-guardian-backup-2026-08-14.json` */
export function backupFilename(now: Date = new Date()): string {
  const date = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return `stock-guardian-backup-${date}.json`;
}
