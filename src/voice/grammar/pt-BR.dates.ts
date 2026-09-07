import type { DateWords } from '../dates';

/** Folded: no accents, lowercase. `março` is `marco`, `amanhã` is `amanha`. */
export const ptBRDates: DateWords = {
  today: ['hoje'],
  tomorrow: ['amanha'],
  dayAfterTomorrow: ['depois de amanha'],
  nextWeek: ['semana que vem', 'proxima semana'],
  nextMonth: ['mes que vem', 'proximo mes'],
  /** "daqui a N dias" / "em N dias" — the captured group is the count. */
  inDaysPattern: /(?:daqui a|em|dentro de)\s+(.+?)\s+dias?/,
  /**
   * "dia 12" with no month.
   *
   * The lookahead stops this from answering a question it was not asked. A
   * speaker who says "dia 12 de setembro" named a month; if the day-month
   * branch could not use it, this branch must not quietly supply a different
   * one. Without the lookahead "dia 12 de setembro" heard in January became the
   * 12th of FEBRUARY - a date nobody said, silently.
   */
  dayOnlyPattern: /\bdia\s+(\d{1,2})\b(?!\s+de\s+[a-z]+)/,
  /**
   * "12 de setembro", "doze de setembro", and the same with words in front of
   * them: "dia 12 de setembro", "vence 12 de setembro", "em 10 de outubro".
   *
   * The day capture is greedy and deliberately loose, and both halves of that
   * are load-bearing.
   *
   * Greedy, so the split lands on the LAST "de" in the phrase. A lazy capture
   * splits "o pacote de arroz vence 12 de setembro" at the first "de" and
   * offers "arroz" as the month; it is not one, the branch fails, and the date
   * is lost.
   *
   * Loose, because a Portuguese numeral is not one token - "vinte e cinco de
   * dezembro" - so no pattern can mark where the day begins. It captures
   * whatever words precede the month and `parseSpokenDate` trims them.
   */
  dayMonthPattern: /(.+)\s+de\s+([a-z]+)/,
  /** "em março", "no mes de março". */
  monthOnlyPattern: /(?:em|no mes de|para)\s+([a-z]+)$/,
  months: {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  },
};
