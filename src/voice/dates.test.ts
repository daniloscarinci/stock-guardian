import { describe, expect, it } from 'vitest';
import { parseSpokenDate } from './dates';
import { ptBRDates } from './grammar/pt-BR.dates';
import { ptBRNumbers } from './grammar/pt-BR.numbers';

const TODAY = '2026-09-07'; // a Monday

describe('parseSpokenDate (pt-BR)', () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ['hoje', '2026-09-07'],
    ['amanha', '2026-09-08'],
    ['depois de amanha', '2026-09-09'],
    ['semana que vem', '2026-09-14'],
    ['mes que vem', '2026-10-07'],
    ['daqui a 30 dias', '2026-10-07'],
    ['daqui a dez dias', '2026-09-17'],
    ['dia 12', '2026-09-12'],
    ['dia 3', '2026-10-03'],           // already past this month, so next month
    ['12 de setembro', '2026-09-12'],
    ['doze de setembro', '2026-09-12'],
    ['1 de janeiro', '2027-01-01'],    // January has passed, so next year
    ['em marco', '2027-03-31'],        // a bare month means its last day
    ['12/09/2026', '2026-09-12'],
    ['12/09', '2026-09-12'],
    ['2026-09-12', '2026-09-12'],
    ['feijao preto', null],
    ['', null],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${String(expected)}`, () => {
      expect(parseSpokenDate(ptBRDates, ptBRNumbers, input, TODAY)).toBe(expected);
    });
  }
});

/**
 * A spoken month must survive the words spoken in front of it.
 *
 * The day-month pattern used to open with a lazy `.+?`, which swallowed the
 * words before the day - "dia", "vence", "em" - and left `parseNumber` a token
 * stream it had to reject. The branch then failed and the phrase fell through
 * to the day-only branch, which has no idea a month was ever mentioned.
 *
 * Every case here needs a `today` outside September, because with the suite's
 * usual TODAY the wrong answer and the right one happen to coincide. That
 * coincidence is the whole reason this went unnoticed.
 */
describe('parseSpokenDate: the month is never dropped', () => {
  const JANUARY = '2026-01-15';

  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ['dia 12 de setembro', '2026-09-12'],
    ['vence 12 de setembro', '2026-09-12'],
    ['em 10 de outubro', '2026-10-10'],
    ['no dia 3 de abril', '2026-04-03'],
    // A numeral is not one token, so trimming the words in front of the day
    // must not trim the front of the numeral itself.
    ['vinte e cinco de dezembro', '2026-12-25'],
    // The date is still found when an earlier "de" belongs to the item.
    ['o pacote de arroz vence 12 de setembro', '2026-09-12'],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${String(expected)}`, () => {
      expect(parseSpokenDate(ptBRDates, ptBRNumbers, input, JANUARY)).toBe(expected);
    });
  }
});

/**
 * A date that does not exist is refused, not invented.
 *
 * Three branches built a date out of components and returned it without asking
 * whether that day exists in that month, so "29 de fevereiro" produced
 * 2027-02-29 and "12/13" produced a thirteenth month. Both are strings that
 * `calendarDaysBetween` throws on, written into an expiry field.
 *
 * The distinction the rows below draw: a day that exists but not yet ("dia 31"
 * in a 30-day month, the 29th of February) rolls forward to the next month or
 * year that really has it, which is what "the next time that day comes round"
 * already promised. A day that exists in no year at all is null, and the
 * phrase stays UNKNOWN so the user can see what was heard and correct it.
 */
describe('parseSpokenDate: an impossible date', () => {
  const cases: ReadonlyArray<readonly [string, string, string | null]> = [
    ['31 de abril', TODAY, null],              // April has never had 31 days
    ['12/13', TODAY, null],                    // there is no thirteenth month
    ['30 de fevereiro', TODAY, null],          // no February ever has one
    ['29 de fevereiro', TODAY, '2028-02-29'],  // the next February that does
    ['dia 31', '2026-09-29', '2026-10-31'],    // September has no 31st
    ['dia 30', '2027-02-10', '2027-03-30'],    // nor February a 30th
  ];

  for (const [input, today, expected] of cases) {
    it(`reads "${input}" on ${today} as ${String(expected)}`, () => {
      expect(parseSpokenDate(ptBRDates, ptBRNumbers, input, today)).toBe(expected);
    });
  }
});

/**
 * A fraction is not a day.
 *
 * The day-month branch used to round whatever numeral it found, and a spoken
 * numeral does not have to be a whole number: "meio" is 0.5 and "um e meio" is
 * 1.5. Rounding turned the second into the 2nd of January - a date nobody
 * said, with no error to notice, written into an expiry field.
 *
 * "meio de janeiro" was already null, because 0.5 failed the `day >= 1` guard
 * that stood next to the rounding. That is exactly what made the defect quiet:
 * the obvious phrase was safe and the ones a step past it were not.
 */
describe('parseSpokenDate: a fractional day', () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ['meio de janeiro', null],
    ['um e meio de janeiro', null],       // 1.5 used to round to the 2nd
    ['dois e meio de janeiro', null],     // and 2.5 to the 3rd
    ['dez e meio de janeiro', null],      // and 10.5 to the 11th
    // A numeral that lands on a whole number is still a day. "duzia e meia" is
    // 18 exactly, not 18.5 - the half attaches to the group word.
    ['meia duzia de janeiro', '2027-01-06'],
    ['duzia e meia de janeiro', '2027-01-18'],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${String(expected)}`, () => {
      expect(parseSpokenDate(ptBRDates, ptBRNumbers, input, TODAY)).toBe(expected);
    });
  }
});
