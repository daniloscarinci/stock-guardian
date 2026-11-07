/**
 * When to remind somebody to back up.
 *
 * Pure: no clock, no database, no interface. Everything it needs comes in as an
 * argument, so every state and every boundary is testable without a browser.
 *
 * The rule, and why each half is there:
 *
 *   due  = the reference is at least `thresholdDays` old
 *          AND (there has never been a backup OR something changed after it)
 *
 * The reference is the last backup, or - when there has never been one - the
 * oldest data, so somebody who installed yesterday is not nagged. The "changed
 * since" half is why a person who has not touched their stock for three months
 * is left alone: an old backup of unchanged data is not a risk. The quiet line
 * still says how old it is.
 */

export const DAY_MS = 86_400_000;

/** What Settings offers. A stored value outside this list is kept and shown. */
export const REMINDER_DAY_CHOICES = [7, 14, 30, 60, 90] as const;

export interface BackupReminderInput {
  readonly enabled: boolean;
  readonly thresholdDays: number;
  /** Milliseconds since the epoch. Passed in, never read from a clock here. */
  readonly nowMs: number;
  readonly lastBackupAt: string | null;
  /** Oldest `created_at` across items, locations and contacts. */
  readonly earliestDataAt: string | null;
  /** Newest `updated_at` across the same three tables. */
  readonly latestChangeAt: string | null;
  /** False means the inventory is empty, the same test the dashboard uses. */
  readonly hasData: boolean;
}

export type BackupReminderStatus =
  | { readonly kind: 'off' }
  | { readonly kind: 'never' }
  | { readonly kind: 'recent'; readonly days: number }
  | { readonly kind: 'due'; readonly days: number; readonly never: boolean };

/** Milliseconds for an ISO-8601 instant, or null when it is missing or unparseable. */
export function parseInstant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** The instant inside a stored settings value (`"2026-..."` as JSON), or null. */
export function parseStoredInstant(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' && parseInstant(value) !== null ? value : null;
  } catch {
    return null;
  }
}

function validInstant(value: string | null | undefined): string | null {
  return parseInstant(value) === null ? null : (value ?? null);
}

/** The later of two instants. One valid value wins over an invalid one; a tie returns the first. */
export function newerInstant(
  first: string | null | undefined,
  second: string | null | undefined,
): string | null {
  const a = validInstant(first);
  const b = validInstant(second);
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Whole elapsed days, never negative. */
export function wholeDaysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

/** The day choices to offer, with a stored value outside the list kept in order. */
export function reminderDayChoices(current: number): readonly number[] {
  const base: readonly number[] = REMINDER_DAY_CHOICES;
  return base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
}

export function evaluateBackupReminder(input: BackupReminderInput): BackupReminderStatus {
  if (!input.enabled || !input.hasData) return { kind: 'off' };

  const last = parseInstant(input.lastBackupAt);
  const earliest = parseInstant(input.earliestDataAt);
  const latestChange = parseInstant(input.latestChangeAt);

  const reference = last ?? earliest;
  const days = reference === null ? 0 : wholeDaysBetween(reference, input.nowMs);
  const changedSince = last === null || (latestChange !== null && latestChange > last);

  if (reference !== null && days >= input.thresholdDays && changedSince) {
    return { kind: 'due', days, never: last === null };
  }
  return last === null ? { kind: 'never' } : { kind: 'recent', days };
}
