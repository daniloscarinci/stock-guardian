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

    // "mil" multiplies rather than adds. As a plain unit these read 1002, 1003
    // and 1010 - a wrong quantity, silently stored.
    ['mil', 1000],
    ['dois mil', 2000],
    ['tres mil', 3000],
    ['dez mil', 10000],
    ['mil e quinhentos', 1500],
    ['dois mil e quinhentos', 2500],
    ['cem mil', 100000],

    ['meia duzia', 6],
    ['uma duzia', 12],
    ['duas duzias', 24],
    ['um par', 2],
    ['meio', 0.5],
    ['metade', 0.5],

    // A half after a group is half of THAT group: a dozen and a half is 18,
    // not 12.5, and two dozen and a half is 30 - not 24.5, and not 36 either.
    ['duzia e meia', 18],
    ['duas duzias e meia', 30],
    ['um par e meio', 3],
    ['mil e meio', 1500],
    // The group closes as soon as another quantity is spoken, so this half is
    // a plain 0.5 rather than half a dozen.
    ['duzia e vinte e meia', 32.5],

    ['', null],
    ['feijao', null],
    ['e', null],
    // One good word plus one bad one still fails the whole parse: a partial
    // reading would put 20 in the stock and drop what "manga" was meant to say.
    ['vinte manga', null],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${String(expected)}`, () => {
      expect(parseNumber(ptBRNumbers, input)).toBe(expected);
    });
  }
});
