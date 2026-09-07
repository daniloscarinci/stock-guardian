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

  it('declines a rule whose build returns null and tries the next', () => {
    // "tira zero de arroz" matches the ADJUST pattern but has no usable amount,
    // so ADJUST declines and no later rule claims it.
    expect(parse(ptBRGrammar, 'tira zero de arroz', CTX).kind).toBe('UNKNOWN');
  });
});
