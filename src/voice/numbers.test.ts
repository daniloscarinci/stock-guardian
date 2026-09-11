import { describe, expect, it } from 'vitest';
import { parseNumber, spokenDigits } from './numbers';
import { ptBRNumbers } from './grammar/pt-BR.numbers';
import { enNumbers } from './grammar/en.numbers';
import { esNumbers } from './grammar/es.numbers';

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

/**
 * The one reader in this file that does no arithmetic.
 *
 * Every case below is a number somebody could say into the ask box, and the
 * third block is the point of the function: a phrase that is a QUANTITY comes
 * back as null rather than as a phone number nobody gave.
 */
describe('spokenDigits', () => {
  it('reads digits said one at a time as the digits they are', () => {
    expect(spokenDigits(enNumbers, 'five five five one two three four')).toBe('5551234');
    expect(spokenDigits(ptBRNumbers, 'cinco cinco cinco um dois tres quatro')).toBe('5551234');
    expect(spokenDigits(esNumbers, 'cinco cinco cinco uno dos tres cuatro')).toBe('5551234');
  });

  it('keeps a run of digits as written, and joins it to the rest', () => {
    expect(spokenDigits(enNumbers, '555 1234')).toBe('5551234');
    expect(spokenDigits(enNumbers, '555 one two three four')).toBe('5551234');
  });

  /**
   * The guard the whole function exists for. "five hundred" is a quantity, and
   * reading it digit by digit would store 5100 - a number nobody said, with
   * nothing to notice it by. Refusing is the only honest answer.
   */
  it('refuses a quantity, in every language', () => {
    expect(spokenDigits(enNumbers, 'five hundred')).toBeNull();
    expect(spokenDigits(ptBRNumbers, 'dois mil')).toBeNull();
    expect(spokenDigits(esNumbers, 'dos docenas')).toBeNull();
  });

  /** A ten is not a digit either, for the same reason and with the same answer. */
  it('refuses a ten, a hundred, a fraction and the joiner', () => {
    expect(spokenDigits(enNumbers, 'five twenty')).toBeNull();
    expect(spokenDigits(ptBRNumbers, 'cinco cem')).toBeNull();
    expect(spokenDigits(enNumbers, 'five half')).toBeNull();
    expect(spokenDigits(enNumbers, 'five and five')).toBeNull();
  });

  it('refuses anything that is not a number word at all', () => {
    expect(spokenDigits(enNumbers, 'ana')).toBeNull();
    expect(spokenDigits(enNumbers, '')).toBeNull();
    expect(spokenDigits(enNumbers, 'five ana five')).toBeNull();
  });

  /**
   * The words that are a digit HERE and something else everywhere else.
   *
   * "meia" matters most: it is the ordinary way a Brazilian dictates a six,
   * and it is a `literals` entry worth 0.5 because that is what it means in
   * "meia duzia". Both readings have to stand, which is why the aliases are a
   * table `spokenDigits` reads and `parseNumber` does not - the last two
   * assertions below are the ones that would break if somebody moved "meia"
   * into `units` to fix the phone number.
   */
  it('reads the words that are a digit only while digits are being read', () => {
    expect(spokenDigits(ptBRNumbers, 'cinco meia sete')).toBe('567');
    expect(spokenDigits(enNumbers, 'five oh five')).toBe('505');
    // Spanish has no such word and its table is empty, so nothing changes.
    expect(spokenDigits(esNumbers, 'cinco media siete')).toBeNull();

    expect(parseNumber(ptBRNumbers, 'meia duzia')).toBe(6);
    expect(parseNumber(ptBRNumbers, 'meia')).toBe(0.5);
    expect(parseNumber(enNumbers, 'oh')).toBeNull();
  });

  it('reads a spoken zero, because every units table already has one', () => {
    expect(spokenDigits(enNumbers, 'zero one two')).toBe('012');
    expect(spokenDigits(esNumbers, 'cero uno dos')).toBe('012');
    expect(spokenDigits(ptBRNumbers, 'zero um dois')).toBe('012');
  });

  /** Grouping marks carry no digit, so they come off; the country code stays. */
  it('drops the separators a recognizer emits and keeps a leading plus', () => {
    expect(spokenDigits(ptBRNumbers, '(11) 5555-1234')).toBe('1155551234');
    expect(spokenDigits(ptBRNumbers, '+55 11 5555 1234')).toBe('+551155551234');
    // A plus that is not the country code is in no phone number at all.
    expect(spokenDigits(enNumbers, '555+1234')).toBeNull();
    expect(spokenDigits(enNumbers, '+')).toBeNull();
  });
});
