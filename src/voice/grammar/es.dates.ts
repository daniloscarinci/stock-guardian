import type { DateWords } from '../dates';

/**
 * Spanish date words, already folded: `mañana` is `manana` and `próxima` is
 * `proxima`.
 *
 * Spanish shares Portuguese's day-before-month order and its "de" between them,
 * so these patterns are close to `pt-BR.dates.ts` on purpose. English is the
 * one that needed turning around.
 */
export const esDates: DateWords = {
  today: ['hoy'],
  tomorrow: ['manana'],
  dayAfterTomorrow: ['pasado manana'],
  nextWeek: ['la semana que viene', 'semana que viene', 'la proxima semana', 'proxima semana'],
  nextMonth: ['el mes que viene', 'mes que viene', 'el proximo mes', 'proximo mes'],
  /** "en N dias" / "dentro de N dias" - the captured group is the count. */
  inDaysPattern: /(?:dentro de|en|despues de)\s+(.+?)\s+dias?/,
  /**
   * "el 12", "dia 12", with no month.
   *
   * The lookahead is the guard `pt-BR.dates.ts` explains: a speaker who says
   * "el 12 de septiembre" named a month, and if the day-month branch could not
   * use it this branch must not quietly supply a different one.
   */
  dayOnlyPattern: /\b(?:el|dia)\s+(\d{1,2})\b(?!\s+de\s+[a-z]+)/,
  /**
   * "12 de septiembre", "doce de septiembre", and the same with words in front
   * of them: "el 12 de septiembre", "vence 10 de octubre".
   *
   * Greedy and loose for the reasons `pt-BR.dates.ts` sets out: greedy so the
   * split lands on the LAST "de" and an item name containing one cannot steal
   * it, loose because a Spanish numeral is not one token either ("veinticinco
   * de diciembre" is, but "treinta y uno de marzo" is four).
   */
  dayMonthPattern: /(.+)\s+de\s+([a-z]+)/,
  /** "en marzo", "el mes de marzo". */
  monthOnlyPattern: /(?:en|el mes de|para)\s+([a-z]+)$/,
  months: {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
    noviembre: 11, diciembre: 12,
  },
};
