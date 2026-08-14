/**
 * Expiry evaluation.
 *
 * Pure and I/O-free: every rule the dashboard, the expiration centre and the
 * reports depend on is decided here and can be tested without a database.
 *
 * Two behaviours are inherited deliberately from the original application,
 * because changing them would change what the user's existing data means:
 *
 *   - An item expiring TODAY is not expired. The original rule was
 *     `expiry < today`, so today's date still counted as usable.
 *   - 30 days remains a default warning window.
 *
 * One behaviour is deliberately corrected: an item with no expiration date is
 * "does not expire", not "expired". The original compared `'' < today`, which is
 * true, so every dateless item was flagged - and since the form demanded a date,
 * users were pushed into inventing one for tools that never expire.
 */
import { calendarDaysBetween, toCalendarDate, type CalendarDate } from './dates';

export const DEFAULT_EXPIRY_WINDOWS: readonly number[] = [7, 30, 90];

export type ExpiryBucket = 'none' | 'expired' | 'today' | 'soon' | 'valid';

export interface ExpiryStatus {
  readonly bucket: ExpiryBucket;
  /** Negative when past. Null when the item does not expire. */
  readonly daysUntil: number | null;
  /** The smallest configured window containing this date, when `soon`. */
  readonly windowDays: number | null;
  /** Expired, expiring today, or inside a warning window. */
  readonly needsAttention: boolean;
}

const NO_EXPIRATION: ExpiryStatus = {
  bucket: 'none',
  daysUntil: null,
  windowDays: null,
  needsAttention: false,
};

export function evaluateExpiry(
  expirationDate: string | null | undefined,
  today: CalendarDate,
  windows: readonly number[] = DEFAULT_EXPIRY_WINDOWS,
): ExpiryStatus {
  const date = toCalendarDate(expirationDate ?? null);
  if (date === null) return NO_EXPIRATION;

  const daysUntil = calendarDaysBetween(today, date);

  if (daysUntil < 0) {
    return { bucket: 'expired', daysUntil, windowDays: null, needsAttention: true };
  }
  if (daysUntil === 0) {
    return { bucket: 'today', daysUntil, windowDays: null, needsAttention: true };
  }

  // Callers may configure these in any order; the smallest containing window is
  // the one that describes the urgency.
  const sorted = [...windows].sort((a, b) => a - b);
  const window = sorted.find((days) => daysUntil <= days);

  if (window === undefined) {
    return { bucket: 'valid', daysUntil, windowDays: null, needsAttention: false };
  }
  return { bucket: 'soon', daysUntil, windowDays: window, needsAttention: true };
}

/**
 * Whether an item falls inside a specific window - the dashboard's
 * "expiring in 30 days" question.
 *
 * Already-expired items count: the question being asked is "what needs action
 * in the next N days", and something already past due needs it most.
 */
export function expiresWithin(
  expirationDate: string | null | undefined,
  today: CalendarDate,
  days: number,
): boolean {
  const date = toCalendarDate(expirationDate ?? null);
  if (date === null) return false;
  return calendarDaysBetween(today, date) <= days;
}

/**
 * Comparator ordering by expiry, with non-expiring items always last.
 *
 * Sorting by expiry asks "what runs out first". An item that never runs out
 * belongs at the end - not at the top, which is where a null would land if it
 * were treated as an empty string, as the original app effectively did.
 *
 * `direction` is a parameter rather than something the caller achieves by
 * flipping the arguments, because "nulls last" is not a directional rule: a
 * sign flip would drag every non-expiring item to the top of a descending sort.
 */
export function compareByExpiry(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: 'asc' | 'desc' = 'asc',
): number {
  const left = toCalendarDate(a ?? null);
  const right = toCalendarDate(b ?? null);

  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const order = left < right ? -1 : left > right ? 1 : 0;
  return direction === 'asc' ? order : -order;
}
