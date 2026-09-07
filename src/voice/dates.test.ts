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
