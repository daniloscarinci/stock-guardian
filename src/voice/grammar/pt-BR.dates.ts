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
  /** "dia 12" with no month. */
  dayOnlyPattern: /\bdia\s+(\d{1,2})\b/,
  /** "12 de setembro" or "doze de setembro". */
  dayMonthPattern: /(.+?)\s+de\s+([a-z]+)/,
  /** "em março", "no mes de março". */
  monthOnlyPattern: /(?:em|no mes de|para)\s+([a-z]+)$/,
  months: {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  },
};
