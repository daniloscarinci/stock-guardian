/**
 * Spoken dates to `CalendarDate`.
 *
 * Two rules decide the cases a speaker leaves open, and both follow from what
 * these dates are FOR - an expiry date is in the future.
 *
 *   A day with no month ("dia 3") means the next time that day comes round.
 *   A month with no day ("em marco") means that month's LAST day, because
 *   "vence em marco" names a deadline, not an instant.
 */
import { addCalendarDays, isValidCalendarDate, type CalendarDate } from '../domain/dates';
import { parseNumber, type NumberWords } from './numbers';

export interface DateWords {
  readonly today: readonly string[];
  readonly tomorrow: readonly string[];
  readonly dayAfterTomorrow: readonly string[];
  readonly nextWeek: readonly string[];
  readonly nextMonth: readonly string[];
  readonly inDaysPattern: RegExp;
  readonly dayOnlyPattern: RegExp;
  readonly dayMonthPattern: RegExp;
  readonly monthOnlyPattern: RegExp;
  readonly months: Readonly<Record<string, number>>;
}

function iso(year: number, month: number, day: number): CalendarDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(date: CalendarDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Rolls a month/day forward to the next occurrence at or after `today`. */
function nextOccurrence(today: CalendarDate, month: number, day: number): CalendarDate {
  const now = parts(today);
  const candidate = iso(now.year, month, day);
  return candidate >= today ? candidate : iso(now.year + 1, month, day);
}

export function parseSpokenDate(
  words: DateWords,
  numbers: NumberWords,
  text: string,
  today: CalendarDate,
): CalendarDate | null {
  const value = text.trim();
  if (value === '') return null;

  if (words.today.includes(value)) return today;
  if (words.tomorrow.includes(value)) return addCalendarDays(today, 1);
  if (words.dayAfterTomorrow.includes(value)) return addCalendarDays(today, 2);
  if (words.nextWeek.includes(value)) return addCalendarDays(today, 7);

  if (words.nextMonth.includes(value)) {
    const now = parts(today);
    const month = now.month === 12 ? 1 : now.month + 1;
    const year = now.month === 12 ? now.year + 1 : now.year;
    return iso(year, month, Math.min(now.day, lastDayOfMonth(year, month)));
  }

  // ISO and slashed forms first: they are unambiguous and cheap to reject.
  if (isValidCalendarDate(value)) return value;

  const slashed = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashed !== null) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    const rawYear = slashed[3];
    if (rawYear === undefined) return nextOccurrence(today, month, day);
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const candidate = iso(year, month, day);
    return isValidCalendarDate(candidate) ? candidate : null;
  }

  const inDays = value.match(words.inDaysPattern);
  if (inDays?.[1] !== undefined) {
    const count = parseNumber(numbers, inDays[1]);
    if (count !== null) return addCalendarDays(today, Math.round(count));
  }

  const dayMonth = value.match(words.dayMonthPattern);
  if (dayMonth?.[1] !== undefined && dayMonth[2] !== undefined) {
    const month = words.months[dayMonth[2]];
    const day = parseNumber(numbers, dayMonth[1]);
    if (month !== undefined && day !== null && day >= 1 && day <= 31) {
      return nextOccurrence(today, month, Math.round(day));
    }
  }

  const dayOnly = value.match(words.dayOnlyPattern);
  if (dayOnly?.[1] !== undefined) {
    const day = Number(dayOnly[1]);
    const now = parts(today);
    if (day >= 1 && day <= 31) {
      const thisMonth = iso(now.year, now.month, day);
      if (thisMonth >= today) return thisMonth;
      const month = now.month === 12 ? 1 : now.month + 1;
      const year = now.month === 12 ? now.year + 1 : now.year;
      return iso(year, month, day);
    }
  }

  const monthOnly = value.match(words.monthOnlyPattern);
  if (monthOnly?.[1] !== undefined) {
    const month = words.months[monthOnly[1]];
    if (month !== undefined) {
      const now = parts(today);
      const year = month >= now.month ? now.year : now.year + 1;
      return iso(year, month, lastDayOfMonth(year, month));
    }
  }

  return null;
}
