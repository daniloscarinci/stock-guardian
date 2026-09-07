import type { DateWords } from '../dates';

/**
 * English date words.
 *
 * `dayMonthPattern` reads the day BEFORE the month, the order Portuguese and
 * Spanish speak in, even though English usually says "september 12". A pattern
 * numbers its groups left to right, so a month-first regex would hand the month
 * to the day slot; rather than teach the shared parser about word order,
 * `en.ts` turns "september 12" around into "12 of september" before the phrase
 * gets here. Both English orders therefore arrive in one shape.
 *
 * Ordinal suffixes are stripped there too, so "the 12th of september" reaches
 * these patterns as "the 12 of september".
 */
export const enDates: DateWords = {
  today: ['today'],
  tomorrow: ['tomorrow'],
  dayAfterTomorrow: ['day after tomorrow', 'the day after tomorrow'],
  nextWeek: ['next week', 'in a week'],
  nextMonth: ['next month', 'in a month'],
  /** "in 5 days", "within 30 days" - the captured group is the count. */
  inDaysPattern: /(?:in|within|after)\s+(.+?)\s+days?/,
  /**
   * "the 12th" with no month, the English counterpart of "dia 12".
   *
   * The lookahead is the same guard the Portuguese pattern carries: a speaker
   * who said "the 12th of september" named a month, and if the day-month branch
   * could not use it this branch must not quietly supply a different one.
   */
  dayOnlyPattern: /\b(?:the|on)\s+(\d{1,2})\b(?!\s+of\s+[a-z]+)/,
  /**
   * "12 of september", and the same with words in front of it: "on 12 of
   * september", "expires 12 of september".
   *
   * Greedy and loose for the reasons the Portuguese pattern is - see
   * `pt-BR.dates.ts`. The day capture keeps whatever words precede it and
   * `parseSpokenDate` trims them.
   */
  dayMonthPattern: /(.+)\s+of\s+([a-z]+)/,
  /** "in march", "by december". */
  monthOnlyPattern: /(?:in|by|during|before the end of)\s+([a-z]+)$/,
  months: {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
    sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  },
};
