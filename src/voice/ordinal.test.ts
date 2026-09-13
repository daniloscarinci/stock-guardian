/**
 * The closed vocabulary that answers "Which one?".
 *
 * What is being pinned here is mostly what it REFUSES. The matcher is the only
 * thing standing between a room full of talking and a list of names being picked
 * from, so the substring cases below - "first thing tomorrow", "primeiro de
 * setembro" - matter more than the ones that work: each of them is a sentence
 * somebody could say next to a phone, and each of them contains a word that
 * would have matched if this were a `includes` rather than an equality.
 */
import { describe, expect, it } from 'vitest';
import { matchChoice } from './ordinal';

/** Two names, as a question that had just read them out would have left them. */
const TWO = ['Arroz Branco', 'Arroz Integral'] as const;

/** Three, which is the most `renderChoice` ever names. */
const THREE = ['Arroz Branco', 'Arroz Integral', 'Arroz Parboilizado'] as const;

describe('matchChoice: positions', () => {
  const cases: ReadonlyArray<readonly [Parameters<typeof matchChoice>[0], string, number]> = [
    ['en', 'first', 0],
    ['en', 'the first', 0],
    ['en', 'the first one', 0],
    ['en', 'number one', 0],
    ['en', 'the number two', 1],
    ['en', 'number three', 2],
    ['en', 'the number three', 2],
    ['en', 'second', 1],
    ['en', 'the second one', 1],
    ['en', 'third', 2],
    ['en', 'the third one', 2],

    ['es', 'primero', 0],
    ['es', 'la primera', 0],
    ['es', 'el segundo', 1],
    ['es', 'tercera', 2],
    ['es', 'el numero dos', 1],
    ['es', 'primer', 0],
    ['es', 'tercer', 2],

    ['pt-BR', 'primeiro', 0],
    ['pt-BR', 'o primeiro', 0],
    ['pt-BR', 'a segunda', 1],
    ['pt-BR', 'o terceiro', 2],
    ['pt-BR', 'o numero dois', 1],
    ['pt-BR', 'o número três', 2],
  ];

  for (const [language, said, index] of cases) {
    it(`reads "${said}" in ${language} as position ${index + 1}`, () => {
      expect(matchChoice(language, said, THREE)).toBe(index);
    });
  }

  /**
   * The recognizer's punctuation, and the speaker's capitals and accents.
   *
   * `stripPunctuation` is imported from `parse.ts` rather than written again
   * here, so a trailing period is the same non-event it is for every other
   * sentence this application listens to.
   */
  it('reads a position through punctuation, capitals and accents', () => {
    expect(matchChoice('pt-BR', 'O primeiro.', TWO)).toBe(0);
    expect(matchChoice('es', '¿La segunda?', TWO)).toBe(1);
    expect(matchChoice('en', 'The Second One!', TWO)).toBe(1);
  });
});

/**
 * A table that answers one position and not the next is a worse surprise than
 * one that answers neither: the first success teaches a form the second refuses.
 * These walk the same shape across all three positions rather than spot-checking,
 * which is what caught "number one" being listed in English while "number two"
 * was not.
 */
describe('matchChoice: the same shapes at every position', () => {
  const shapes: Readonly<
    Record<Parameters<typeof matchChoice>[0], readonly (readonly [string, string, string])[]>
  > = {
    en: [
      ['first', 'second', 'third'],
      ['the first', 'the second', 'the third'],
      ['first one', 'second one', 'third one'],
      ['the first one', 'the second one', 'the third one'],
      ['number one', 'number two', 'number three'],
      ['the number one', 'the number two', 'the number three'],
    ],
    es: [
      ['primero', 'segundo', 'tercero'],
      ['primera', 'segunda', 'tercera'],
      ['el primero', 'el segundo', 'el tercero'],
      ['la primera', 'la segunda', 'la tercera'],
      ['numero uno', 'numero dos', 'numero tres'],
      ['el numero uno', 'el numero dos', 'el numero tres'],
    ],
    'pt-BR': [
      ['primeiro', 'segundo', 'terceiro'],
      ['primeira', 'segunda', 'terceira'],
      ['o primeiro', 'o segundo', 'o terceiro'],
      ['a primeira', 'a segunda', 'a terceira'],
      ['numero um', 'numero dois', 'numero tres'],
      ['o numero um', 'o numero dois', 'o numero tres'],
    ],
  };

  for (const [language, rows] of Object.entries(shapes)) {
    for (const row of rows) {
      it(`answers all three of "${row.join('" / "')}" in ${language}`, () => {
        row.forEach((said, index) => {
          expect(
            matchChoice(language as Parameters<typeof matchChoice>[0], said, THREE),
            said,
          ).toBe(index);
        });
      });
    }
  }

  /**
   * Spanish clips the masculine before a noun, and only for one and three -
   * "segundo" has no such form. Listed apart from the sweep above for exactly
   * that reason: this is a gap in the language, not a gap in the table.
   */
  it('answers the two Spanish forms that clip, and knows there is no third', () => {
    expect(matchChoice('es', 'primer', THREE)).toBe(0);
    expect(matchChoice('es', 'tercer', THREE)).toBe(2);
    expect(matchChoice('es', 'segund', THREE)).toBeNull();
  });
});

describe('matchChoice: what it refuses', () => {
  /**
   * THE ASSERTION THIS MODULE EXISTS FOR. Every one of these contains a word
   * from the table and is not one, so a substring match would pick an item out
   * of a list because somebody mentioned the morning.
   */
  it('refuses a sentence that merely contains a position word', () => {
    expect(matchChoice('en', 'first thing tomorrow', TWO)).toBeNull();
    expect(matchChoice('en', 'the first one is fine but check the second', TWO)).toBeNull();
    expect(matchChoice('pt-BR', 'primeiro de setembro', TWO)).toBeNull();
    expect(matchChoice('es', 'el primero de mayo', TWO)).toBeNull();
  });

  /**
   * A position past the end of what was read out.
   *
   * Refused rather than clamped to the last one. "The third one" after a
   * question that named two is somebody who misheard the question, and picking
   * the second would be answering something they did not ask.
   */
  it('refuses a position the question never named', () => {
    expect(matchChoice('en', 'third', TWO)).toBeNull();
    expect(matchChoice('en', 'the second one', ['Only One'])).toBeNull();
  });

  it('refuses a position word from another language', () => {
    expect(matchChoice('en', 'o primeiro', TWO)).toBeNull();
    expect(matchChoice('pt-BR', 'the first one', TWO)).toBeNull();
  });

  /** A bare numeral is a quantity in every other sentence here. */
  it('refuses a bare number', () => {
    expect(matchChoice('en', 'one', TWO)).toBeNull();
    expect(matchChoice('en', '1', TWO)).toBeNull();
    expect(matchChoice('pt-BR', 'dois', TWO)).toBeNull();
  });

  it('refuses silence and an empty list', () => {
    expect(matchChoice('en', '', TWO)).toBeNull();
    expect(matchChoice('en', '   ', TWO)).toBeNull();
    expect(matchChoice('en', 'first', [])).toBeNull();
  });
});

describe('matchChoice: the names themselves', () => {
  /**
   * The more natural answer of the two. The question just read these names out,
   * so saying one back requires no counting.
   */
  it('reads a whole name, folded, as the item it names', () => {
    expect(matchChoice('pt-BR', 'arroz integral', TWO)).toBe(1);
    expect(matchChoice('pt-BR', 'Arroz Branco', TWO)).toBe(0);
    expect(matchChoice('pt-BR', 'arroz branco.', TWO)).toBe(0);
  });

  it('refuses half a name, and a name with something else attached', () => {
    expect(matchChoice('pt-BR', 'arroz', TWO)).toBeNull();
    expect(matchChoice('pt-BR', 'integral', TWO)).toBeNull();
    expect(matchChoice('pt-BR', 'quero o arroz branco', TWO)).toBeNull();
  });

  it('refuses a name that was not one of the ones read out', () => {
    expect(matchChoice('pt-BR', 'feijao preto', TWO)).toBeNull();
  });

  /**
   * Two rows with the same name is the exact case "Which one?" exists for, and
   * saying that name back has not narrowed anything. Refusing leaves the list on
   * screen, where the quantities beside each row tell them apart.
   */
  it('refuses a name that two of the offered items share', () => {
    expect(matchChoice('en', 'rice', ['Rice', 'Rice'])).toBeNull();
  });

  /** A position word wins where an item happens to be called one. */
  it('reads a position word as a position even where an item is named it', () => {
    expect(matchChoice('pt-BR', 'primeiro', ['Segundo', 'Primeiro'])).toBe(0);
  });
});
