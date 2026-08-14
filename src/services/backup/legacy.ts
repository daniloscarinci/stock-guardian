/**
 * Maps a record from the original application into the new schema.
 *
 * The original inventory record was five strings:
 *
 *     { name, qty, loc, expiry, cat }
 *
 * with no identifier, no unit, no timestamps, and a `cat` holding the *localized
 * category label* in whichever language happened to be active when the item was
 * saved. Getting that last one right is the whole point: a record saved in
 * English says "Food" and one saved in Portuguese says "Alimentos", and both
 * must land in the same category.
 *
 * The governing rule (§29, §48): nothing is discarded. A field that cannot be
 * mapped is recorded in `migrationNotes` rather than dropped, so a user can
 * always see what their old data said even where this code could not interpret
 * it.
 *
 * Pure and I/O-free. Resolving location and category names to identifiers needs
 * the database, so it belongs to the import service; everything decidable
 * without one is decided here and tested without one.
 */
import { toCalendarDate } from '../../domain/dates';
import { foldText } from '../../domain/normalize';
import { LEGACY_CATEGORY_ID_BY_FOLDED_LABEL } from '../../data/catalog.generated';
import { LIMITS, sanitizeText, type LegacyRecord } from './format';

/** Fields the original application defined. Anything else is unrecognised. */
const KNOWN_LEGACY_FIELDS = new Set(['name', 'qty', 'loc', 'expiry', 'cat']);

/** Legacy exports carried no unit, so quantities are counted in "units". */
export const LEGACY_DEFAULT_UNIT = 'un';

export type LegacyMappingNote =
  | { readonly kind: 'quantity-unreadable'; readonly original: string }
  | { readonly kind: 'expiry-unreadable'; readonly original: string }
  | { readonly kind: 'category-unrecognised'; readonly original: string }
  | { readonly kind: 'extra-fields'; readonly fields: Readonly<Record<string, unknown>> };

export interface MappedLegacyItem {
  readonly name: string;
  readonly quantity: number;
  readonly unit: string;
  /** Original label; the service resolves or creates the location. */
  readonly locationName: string | null;
  /** Resolved from the 27 known labels, or null when unrecognised. */
  readonly categoryId: string | null;
  /** The original label, kept when it could not be resolved. */
  readonly categoryLabel: string | null;
  readonly expirationDate: string | null;
  readonly notes: readonly LegacyMappingNote[];
  readonly migrationNotes: string | null;
}

export interface RejectedLegacyRecord {
  readonly index: number;
  readonly reason: 'missing-name';
  readonly record: LegacyRecord;
}

export type LegacyMappingResult =
  | { readonly ok: true; readonly item: MappedLegacyItem }
  | { readonly ok: false; readonly rejection: Omit<RejectedLegacyRecord, 'index'> };

export function mapLegacyRecord(record: LegacyRecord): LegacyMappingResult {
  const notes: LegacyMappingNote[] = [];

  // Same sanitizer the v2 path uses: a v1 file must not be able to carry text
  // that a v2 file would have had cleaned.
  const name = sanitizeText(String(record.name ?? ''), LIMITS.maxNameLength);

  // A record with no name cannot become an inventory item. It is reported in the
  // import summary rather than silently skipped.
  if (name === '') {
    return { ok: false, rejection: { reason: 'missing-name', record } };
  }

  // ---- quantity ------------------------------------------------------------
  // The original stored whatever the number input produced, as a string, and
  // never validated it. `parseFloat('')` is NaN, which its own dashboard then
  // silently excluded from the low-stock count.
  const rawQty = record.qty;
  let quantity = 0;
  if (rawQty !== undefined && rawQty !== null && String(rawQty).trim() !== '') {
    const parsed = typeof rawQty === 'number' ? rawQty : Number.parseFloat(String(rawQty));
    if (Number.isFinite(parsed) && parsed >= 0) {
      quantity = parsed;
    } else {
      notes.push({ kind: 'quantity-unreadable', original: String(rawQty) });
    }
  }

  // ---- expiry --------------------------------------------------------------
  // Anything that is not a real calendar date becomes "does not expire", with
  // the original string preserved. The alternative - guessing - would silently
  // change what the user's data means.
  const rawExpiry = record.expiry;
  let expirationDate: string | null = null;
  if (rawExpiry !== undefined && String(rawExpiry).trim() !== '') {
    expirationDate = toCalendarDate(String(rawExpiry));
    if (expirationDate === null) {
      notes.push({ kind: 'expiry-unreadable', original: String(rawExpiry) });
    }
  }

  // ---- category ------------------------------------------------------------
  const rawCat = sanitizeText(String(record.cat ?? ''), LIMITS.maxNameLength);
  let categoryId: string | null = null;
  let categoryLabel: string | null = null;
  if (rawCat !== '') {
    categoryId = LEGACY_CATEGORY_ID_BY_FOLDED_LABEL[foldText(rawCat)] ?? null;
    if (categoryId === null) {
      // Not one of the original nine in any of the three languages - most
      // likely a category the user typed themselves. Kept so the service can
      // recreate it rather than dropping the classification.
      categoryLabel = rawCat.slice(0, LIMITS.maxNameLength);
      notes.push({ kind: 'category-unrecognised', original: categoryLabel });
    }
  }

  // ---- location ------------------------------------------------------------
  const rawLoc = sanitizeText(String(record.loc ?? ''), LIMITS.maxNameLength);
  const locationName = rawLoc === '' ? null : rawLoc;

  // ---- anything the original app did not define ----------------------------
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_LEGACY_FIELDS.has(key)) extras[key] = value;
  }
  if (Object.keys(extras).length > 0) {
    notes.push({ kind: 'extra-fields', fields: extras });
  }

  return {
    ok: true,
    item: {
      name,
      quantity,
      unit: LEGACY_DEFAULT_UNIT,
      locationName,
      categoryId,
      categoryLabel,
      expirationDate,
      notes,
      migrationNotes: notes.length === 0 ? null : JSON.stringify({ importedFrom: 'v1', notes }),
    },
  };
}

export interface LegacyMappingSummary {
  readonly items: readonly MappedLegacyItem[];
  readonly rejected: readonly RejectedLegacyRecord[];
  readonly counts: {
    readonly total: number;
    readonly mapped: number;
    readonly rejected: number;
    readonly quantityUnreadable: number;
    readonly expiryUnreadable: number;
    readonly categoryUnrecognised: number;
    readonly extraFields: number;
  };
}

export function mapLegacyBackup(records: readonly LegacyRecord[]): LegacyMappingSummary {
  const items: MappedLegacyItem[] = [];
  const rejected: RejectedLegacyRecord[] = [];
  let quantityUnreadable = 0;
  let expiryUnreadable = 0;
  let categoryUnrecognised = 0;
  let extraFields = 0;

  records.forEach((record, index) => {
    const result = mapLegacyRecord(record);
    if (!result.ok) {
      rejected.push({ ...result.rejection, index });
      return;
    }
    items.push(result.item);
    for (const note of result.item.notes) {
      if (note.kind === 'quantity-unreadable') quantityUnreadable += 1;
      if (note.kind === 'expiry-unreadable') expiryUnreadable += 1;
      if (note.kind === 'category-unrecognised') categoryUnrecognised += 1;
      if (note.kind === 'extra-fields') extraFields += 1;
    }
  });

  return {
    items,
    rejected,
    counts: {
      total: records.length,
      mapped: items.length,
      rejected: rejected.length,
      quantityUnreadable,
      expiryUnreadable,
      categoryUnrecognised,
      extraFields,
    },
  };
}
