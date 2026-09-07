import { describe, expect, it } from 'vitest';
import { parse } from './parse';
import { ptBRGrammar } from './grammar/pt-BR';

const CTX = { today: '2026-09-07' };

describe('parse', () => {
  it('folds accents and case before matching', () => {
    expect(parse(ptBRGrammar, 'Quanto ARROZ eu tenho?', CTX)).toEqual({
      kind: 'QUERY_QUANTITY',
      item: 'arroz',
    });
  });

  it('returns UNKNOWN for empty input, carrying the transcript', () => {
    expect(parse(ptBRGrammar, '   ', CTX)).toEqual({ kind: 'UNKNOWN', transcript: '   ' });
  });

  it('returns UNKNOWN rather than guessing at a bare item name', () => {
    expect(parse(ptBRGrammar, 'feijao preto', CTX).kind).toBe('UNKNOWN');
  });

  it('prefers SET_QUANTITY over QUERY_QUANTITY when both could match', () => {
    expect(parse(ptBRGrammar, 'agora tenho 12 latas de feijao', CTX)).toEqual({
      kind: 'SET_QUANTITY',
      item: 'feijao',
      amount: 12,
      unit: 'latas',
    });
  });

  it('prefers QUERY_EXPIRY_OF over SET_EXPIRY for a question', () => {
    expect(parse(ptBRGrammar, 'quando vence o leite?', CTX)).toEqual({
      kind: 'QUERY_EXPIRY_OF',
      item: 'leite',
    });
  });

  /**
   * Punctuation is taken off after folding, because `foldText` does not remove
   * it and must not learn to - it builds the stored `*_norm` columns too.
   *
   * A trailing period is the case that actually happens: Chrome's recognizer
   * ends a phrase with one, and the typed box certainly can. Left in place it
   * rides along inside the item phrase and the search looks for "%arroz.%".
   */
  it('ignores a trailing period', () => {
    expect(parse(ptBRGrammar, 'quanto arroz eu tenho.', CTX)).toEqual({
      kind: 'QUERY_QUANTITY',
      item: 'arroz',
    });
  });

  it('ignores a period on the end of an item being adjusted', () => {
    expect(parse(ptBRGrammar, 'usei 3 ovos.', CTX)).toMatchObject({
      kind: 'ADJUST_QUANTITY',
      item: 'ovos',
      amount: 3,
    });
  });

  it('ignores a trailing question mark', () => {
    expect(parse(ptBRGrammar, 'onde esta o arroz?', CTX)).toEqual({
      kind: 'QUERY_WHERE',
      item: 'arroz',
      location: null,
    });
  });

  /**
   * The Spanish opener, tested here because the character is what matters
   * rather than the language: U+00BF is not a combining mark, so `foldText`
   * leaves it on the front of the string, where it defeats every rule anchored
   * at `^`. `es.phrases.test.ts` covers the same thing in real Spanish.
   */
  it('ignores an inverted question mark opening the sentence', () => {
    expect(parse(ptBRGrammar, '¿Quanto arroz eu tenho?', CTX)).toEqual({
      kind: 'QUERY_QUANTITY',
      item: 'arroz',
    });
  });

  it('is UNKNOWN for a transcript that is nothing but punctuation', () => {
    expect(parse(ptBRGrammar, '...?', CTX)).toEqual({ kind: 'UNKNOWN', transcript: '...?' });
  });

  /**
   * A comma between digits is a decimal separator, not punctuation. Stripping
   * it turns "1,5 kg" into fifteen kilos of rice - a wrong quantity written
   * into the inventory with nothing to notice it.
   */
  it('keeps a decimal comma inside a number', () => {
    expect(parse(ptBRGrammar, 'comprei 1,5 kg de arroz.', CTX)).toMatchObject({
      kind: 'ADJUST_QUANTITY',
      item: 'arroz',
      amount: 1.5,
      unit: 'kg',
    });
  });

  /** A slash separates a date, so it is left alone. */
  it('keeps the slashes in a spoken date', () => {
    expect(parse(ptBRGrammar, 'o leite vence 12/09.', CTX)).toEqual({
      kind: 'SET_EXPIRY',
      item: 'leite',
      expiresOn: '2026-09-12',
    });
  });

  it('declines a rule whose build returns null and tries the next', () => {
    // "tira zero de arroz" matches the ADJUST pattern but has no usable amount,
    // so ADJUST declines and no later rule claims it.
    expect(parse(ptBRGrammar, 'tira zero de arroz', CTX).kind).toBe('UNKNOWN');
  });
});
