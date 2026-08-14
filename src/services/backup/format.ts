/**
 * Backup file format.
 *
 * Two formats are readable:
 *
 *   v2   - this application's envelope, carrying inventory, categories,
 *          locations, contacts, movement history, settings and metadata.
 *   v1   - the original Stock Guardian export: a bare JSON array of
 *          `{name, qty, loc, expiry, cat}` records with no envelope at all.
 *          Reading it is a requirement, not a courtesy (§29).
 *
 * Every field is bounded. An import is the one place arbitrary data from outside
 * enters the database, and the original application's importer checked only
 * `Array.isArray` before replacing the entire inventory - so a malformed or
 * hostile file was a direct path to data loss.
 */
import { z } from 'zod';
import { LANGUAGES } from '../../domain/settings';

export const BACKUP_FORMAT = 'stock-guardian-backup';
export const BACKUP_FORMAT_VERSION = 2;

/**
 * Bounds. Chosen to be far above any plausible real inventory and far below
 * anything that would exhaust memory while being parsed.
 */
export const LIMITS = {
  /** 64 MB of JSON. A 10,000-item backup with no photos is well under 10 MB. */
  maxFileBytes: 64 * 1024 * 1024,
  maxItems: 200_000,
  maxCategories: 2_000,
  maxLocations: 10_000,
  maxContacts: 10_000,
  maxTransactions: 500_000,
  maxNameLength: 500,
  maxNotesLength: 20_000,
  maxIdLength: 200,
} as const;

/**
 * Trims, caps length, and strips control characters.
 *
 * Control characters are removed rather than rejected: they carry no meaning in
 * a name and would otherwise corrupt CSV exports and printed reports. Markup is
 * NOT stripped - React escapes on render, and silently mangling an item legibly
 * named `<3 rations` would be its own kind of data loss.
 */
// C0 controls except tab, newline and carriage return, plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Trims, strips control characters and caps length.
 *
 * Exported so the legacy mapper applies exactly the same rule - a v1 import must
 * not be able to smuggle in text that a v2 import would have cleaned.
 */
export function sanitizeText(value: string, max: number): string {
  return value.replace(CONTROL_CHARACTERS, '').trim().slice(0, max);
}

const boundedText = (max: number) => z.string().transform((value) => sanitizeText(value, max));

const optionalText = (max: number) => boundedText(max).nullish().transform((v) => v ?? null);

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v ?? null);

const instant = z.string().min(1).max(64);

const identifier = z.string().min(1).max(LIMITS.maxIdLength);

/** Coerces the legacy string quantities and guards against NaN and Infinity. */
const quantity = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

export const backupItemSchema = z.object({
  id: identifier.optional(),
  name: boundedText(LIMITS.maxNameLength),
  categoryId: identifier.nullish().transform((v) => v ?? null),
  locationId: identifier.nullish().transform((v) => v ?? null),
  quantity: quantity,
  unit: optionalText(32),
  minimumQuantity: quantity,
  idealQuantity: quantity,
  expirationDate: calendarDate,
  purchaseDate: calendarDate,
  openedDate: calendarDate,
  condition: z.enum(['new', 'good', 'fair', 'poor', 'unusable']).nullish().transform((v) => v ?? null),
  priority: z.coerce.number().int().min(1).max(4).nullish().transform((v) => v ?? 3),
  notes: optionalText(LIMITS.maxNotesLength),
  barcode: optionalText(200),
  catalogItemId: identifier.nullish().transform((v) => v ?? null),
  archivedAt: z.string().max(64).nullish().transform((v) => v ?? null),
  migrationNotes: optionalText(LIMITS.maxNotesLength),
  createdAt: instant.nullish().transform((v) => v ?? null),
  updatedAt: instant.nullish().transform((v) => v ?? null),
});

export const backupCategorySchema = z.object({
  id: identifier,
  names: z.record(z.string().max(16), boundedText(LIMITS.maxNameLength)),
  icon: optionalText(64),
  color: optionalText(64),
  sortOrder: z.coerce.number().int().nullish().transform((v) => v ?? 0),
  isSystem: z.boolean().nullish().transform((v) => v ?? false),
  active: z.boolean().nullish().transform((v) => v ?? true),
});

export const backupLocationSchema = z.object({
  id: identifier,
  name: boundedText(LIMITS.maxNameLength),
  description: optionalText(LIMITS.maxNotesLength),
  parentId: identifier.nullish().transform((v) => v ?? null),
  notes: optionalText(LIMITS.maxNotesLength),
  sortOrder: z.coerce.number().int().nullish().transform((v) => v ?? 0),
});

export const backupContactSchema = z.object({
  id: identifier,
  name: boundedText(LIMITS.maxNameLength),
  relationship: optionalText(200),
  phone: optionalText(100),
  email: optionalText(320),
  location: optionalText(LIMITS.maxNameLength),
  notes: optionalText(LIMITS.maxNotesLength),
  priority: z.coerce.number().int().min(1).max(4).nullish().transform((v) => v ?? 3),
});

export const backupTransactionSchema = z.object({
  id: identifier,
  itemId: identifier,
  type: z.enum(['add', 'remove', 'consume', 'transfer', 'correction', 'purchase']),
  quantity: z.coerce.number(),
  quantityBefore: z.coerce.number(),
  quantityAfter: z.coerce.number(),
  sourceLocationId: identifier.nullish().transform((v) => v ?? null),
  destinationLocationId: identifier.nullish().transform((v) => v ?? null),
  occurredAt: instant,
  notes: optionalText(LIMITS.maxNotesLength),
});

export const backupItemNameSchema = z.object({
  itemId: identifier,
  lang: z.enum(LANGUAGES),
  name: boundedText(LIMITS.maxNameLength),
});

export const backupDataSchema = z.object({
  items: z.array(backupItemSchema).max(LIMITS.maxItems).default([]),
  itemNames: z.array(backupItemNameSchema).max(LIMITS.maxItems * 3).default([]),
  categories: z.array(backupCategorySchema).max(LIMITS.maxCategories).default([]),
  locations: z.array(backupLocationSchema).max(LIMITS.maxLocations).default([]),
  contacts: z.array(backupContactSchema).max(LIMITS.maxContacts).default([]),
  transactions: z.array(backupTransactionSchema).max(LIMITS.maxTransactions).default([]),
  settings: z.record(z.string().max(64), z.unknown()).default({}),
});

export const backupEnvelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number().int().min(1),
  schemaVersion: z.number().int().min(0),
  appVersion: z.string().max(64),
  exportedAt: instant,
  counts: z.record(z.string().max(64), z.number()).optional(),
  checksum: z.string().max(200).optional(),
  data: backupDataSchema,
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
export type BackupData = z.infer<typeof backupDataSchema>;
export type BackupItem = z.infer<typeof backupItemSchema>;

/** The original application's export: a bare array with five string fields. */
export const legacyRecordSchema = z
  .object({
    name: z.string().optional(),
    qty: z.union([z.string(), z.number()]).optional(),
    loc: z.string().optional(),
    expiry: z.string().optional(),
    cat: z.string().optional(),
  })
  // Unknown keys are kept, not stripped: §29 requires that anything which
  // cannot be mapped is preserved rather than dropped.
  .passthrough();

export const legacyBackupSchema = z.array(legacyRecordSchema).max(LIMITS.maxItems);

export type LegacyRecord = z.infer<typeof legacyRecordSchema>;

/**
 * Deterministic JSON, so the same data always hashes to the same checksum.
 *
 * `JSON.stringify` preserves insertion order, which differs between a freshly
 * exported object and one round-tripped through a parser. Sorting keys removes
 * that as a source of spurious checksum mismatches.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** SHA-256 of the canonical form. Web Crypto, so no dependency and no network. */
export async function checksumOf(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}
