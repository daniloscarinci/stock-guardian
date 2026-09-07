import { describe, expect, it } from 'vitest';
import { GRAMMARS, grammarFor } from './registry';
import { LANGUAGES } from '../../domain/settings';
import { parse } from '../parse';

const CTX = { today: '2026-09-07' };

describe('grammar registry', () => {
  it('has a grammar for every language the application offers', () => {
    for (const language of LANGUAGES) {
      expect(GRAMMARS[language]).toBeDefined();
      expect(GRAMMARS[language].language).toBe(language);
    }
  });

  it('gives every grammar at least three examples for HELP', () => {
    for (const language of LANGUAGES) {
      expect(GRAMMARS[language].examples.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('parses every grammar own examples into something other than UNKNOWN', () => {
    for (const language of LANGUAGES) {
      for (const example of GRAMMARS[language].examples) {
        expect(parse(GRAMMARS[language], example, CTX).kind).not.toBe('UNKNOWN');
      }
    }
  });

  it('understands English', () => {
    expect(parse(grammarFor('en'), 'how much rice do i have', CTX)).toEqual({
      kind: 'QUERY_QUANTITY', item: 'rice',
    });
  });

  it('understands Spanish', () => {
    expect(parse(grammarFor('es'), 'cuanto arroz tengo', CTX)).toEqual({
      kind: 'QUERY_QUANTITY', item: 'arroz',
    });
  });
});
