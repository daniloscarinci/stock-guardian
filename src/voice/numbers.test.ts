import { describe, expect, it } from 'vitest';
import { parseNumber } from './numbers';
import { ptBRNumbers } from './grammar/pt-BR.numbers';

describe('parseNumber (pt-BR)', () => {
  const cases: ReadonlyArray<readonly [string, number | null]> = [
    ['5', 5],
    ['12', 12],
    ['1,5', 1.5],
    ['0,25', 0.25],
    ['um', 1],
    ['uma', 1],
    ['dois', 2],
    ['duas', 2],
    ['tres', 3],
    ['dez', 10],
    ['onze', 11],
    ['quinze', 15],
    ['vinte', 20],
    ['vinte e cinco', 25],
    ['trinta e um', 31],
    ['cem', 100],
    ['cento e vinte', 120],
    ['duzentos', 200],
    ['mil', 1000],
    ['meia duzia', 6],
    ['uma duzia', 12],
    ['duas duzias', 24],
    ['um par', 2],
    ['meio', 0.5],
    ['metade', 0.5],
    ['', null],
    ['feijao', null],
    ['e', null],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${String(expected)}`, () => {
      expect(parseNumber(ptBRNumbers, input)).toBe(expected);
    });
  }
});
