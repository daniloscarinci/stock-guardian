/**
 * Calendar-date handling.
 *
 * An expiry is a date printed on a package. It is not an instant, it has no
 * time, and it belongs to no timezone. The original application blurred that
 * distinction - it compared `<input type="date">` values (local calendar dates)
 * against `new Date().toISOString().split('T')[0]` (a UTC calendar date). In
 * Brazil, at UTC-3, any evening after 21:00 the UTC date has already rolled
 * over, so items expiring today were reported as expired.
 *
 * The rules that avoid it, applied everywhere in this file:
 *
 *   - "Today" is derived from LOCAL date components.
 *   - Arithmetic runs in UTC on those components. Adding 30 days to a local
 *     `Date` crosses daylight-saving boundaries and yields 29.958 days, which
 *     truncates to the wrong answer twice a year.
 */
import type { DateFormat } from './settings';

/** A calendar date in `YYYY-MM-DD` form. */
export type CalendarDate = string;

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parseParts(value: string): DateParts | null {
  const match = PATTERN.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-tripping through UTC rejects dates that match the pattern but do not
  // exist - 2026-02-30 and 2025-02-29 both normalize to a different day.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function isValidCalendarDate(value: string): boolean {
  return parseParts(value) !== null;
}

/**
 * Narrows arbitrary input to a trustworthy calendar date, or null.
 *
 * The importer relies on this: anything it returns null for is preserved in
 * `migration_notes` rather than discarded, so a malformed date costs the user
 * information about that field and nothing else.
 */
export function toCalendarDate(value: string | null | undefined): CalendarDate | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return isValidCalendarDate(trimmed) ? trimmed : null;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** The user's local calendar date. Never derived from `toISOString()`. */
export function todayLocal(now: Date = new Date()): CalendarDate {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toUtcMillis(date: CalendarDate): number | null {
  const parts = parseParts(date);
  if (parts === null) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

const MILLIS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from `from` to `to`. Negative when `to` is earlier.
 *
 * Computed in UTC so daylight-saving transitions cannot shorten or lengthen a
 * day out from under the arithmetic.
 */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  const start = toUtcMillis(from);
  const end = toUtcMillis(to);
  if (start === null || end === null) {
    throw new Error(`calendarDaysBetween received an invalid date: "${from}" -> "${to}"`);
  }
  return Math.round((end - start) / MILLIS_PER_DAY);
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const start = toUtcMillis(date);
  if (start === null) throw new Error(`addCalendarDays received an invalid date: "${date}"`);
  const shifted = new Date(start + days * MILLIS_PER_DAY);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Formats for display.
 *
 * Deliberately not `Intl.DateTimeFormat`: constructing a `Date` from a calendar
 * date to format it reintroduces exactly the timezone shift this module exists
 * to avoid, and the three supported formats are unambiguous as literals.
 */
export function formatCalendarDate(
  date: CalendarDate | null | undefined,
  format: DateFormat,
): string {
  const safe = toCalendarDate(date ?? null);
  if (safe === null) return '';
  const parts = parseParts(safe);
  if (parts === null) return '';

  const year = pad(parts.year, 4);
  const month = pad(parts.month);
  const day = pad(parts.day);

  switch (format) {
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
  }
}

/** ISO-8601 UTC instant, for `*_at` columns. */
export function nowInstant(now: Date = new Date()): string {
  return now.toISOString();
}
