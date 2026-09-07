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

/**
 * The longest numeral at the end of a phrase, or null.
 *
 * A day capture arrives carrying whatever words preceded it - "dia 12",
 * "vence 12", "em 10" - because a spoken numeral can be several tokens ("vinte
 * e cinco") and so no pattern can mark where it starts. Leading tokens are
 * dropped one at a time and the first remainder that parses is returned, which
 * is the longest one: "vinte e cinco" stays 25 instead of collapsing to 5.
 */
function trailingNumber(numbers: NumberWords, phrase: string): number | null {
  const tokens = phrase.split(' ').filter((token) => token !== '');

  for (let start = 0; start < tokens.length; start += 1) {
    const value = parseNumber(numbers, tokens.slice(start).join(' '));
    if (value !== null) return value;
  }

  return null;
}

/**
 * Rolls a month/day forward to the next occurrence at or after `today`, or
 * null if that day never comes.
 *
 * The search is a loop rather than one check because a day can be missing from
 * its month: "29 de fevereiro" is real but rare, and the next February that
 * has one may be four years out - eight across a century boundary. "31 de
 * abril" is not real in any year, so it returns null and the phrase stays
 * UNKNOWN. Returning the string "2027-04-31" instead would put a value in the
 * database that `calendarDaysBetween` throws on, and would tell the user a
 * date they never said.
 */
function nextOccurrence(today: CalendarDate, month: number, day: number): CalendarDate | null {
  const startYear = parts(today).year;

  for (let year = startYear; year <= startYear + 8; year += 1) {
    const candidate = iso(year, month, day);
    if (candidate >= today && isValidCalendarDate(candidate)) return candidate;
  }

  return null;
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
    // The day is read from the END of its capture, because the pattern hands
    // over the words in front of it too - see `trailingNumber`.
    const day = trailingNumber(numbers, dayMonth[1]);
    // A day has to be a whole one. `Math.round` used to stand in the call
    // below, and a numeral does not have to be an integer: "um e meio de
    // janeiro" is 1.5, which rounded to the 2nd of January - a date nobody
    // said, written into an expiry field with nothing to notice it. Same
    // family as the impossible dates handled by `nextOccurrence`, and the same
    // answer: refuse it, and the phrase stays UNKNOWN for the user to correct.
    if (
      month !== undefined
      && day !== null
      && Number.isInteger(day)
      && day >= 1
      && day <= 31
    ) {
      const occurrence = nextOccurrence(today, month, day);
      if (occurrence !== null) return occurrence;
    }
  }

  const dayOnly = value.match(words.dayOnlyPattern);
  if (dayOnly?.[1] !== undefined) {
    const day = Number(dayOnly[1]);
    const now = parts(today);
    if (day >= 1 && day <= 31) {
      // Walk forward a month at a time rather than assuming the next month will
      // do. "dia 31" said on the 29th of September has to skip September, which
      // has no 31st, and land on the 31st of October - not on a 2026-09-31 that
      // does not exist and that every date helper downstream throws on.
      for (let step = 0; step <= 12; step += 1) {
        const month = ((now.month - 1 + step) % 12) + 1;
        const year = now.year + Math.floor((now.month - 1 + step) / 12);
        const candidate = iso(year, month, day);
        if (candidate >= today && isValidCalendarDate(candidate)) return candidate;
      }
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
