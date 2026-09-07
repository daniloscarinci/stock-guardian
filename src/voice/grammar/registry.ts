/**
 * Language to grammar.
 *
 * The same rule `translate.ts` follows: adding a language is one file and one
 * entry here, and no application logic changes.
 */
import type { Language } from '../../domain/settings';
import type { Grammar } from './types';
import { ptBRGrammar } from './pt-BR';
import { enGrammar } from './en';
import { esGrammar } from './es';

export const GRAMMARS: Readonly<Record<Language, Grammar>> = {
  'pt-BR': ptBRGrammar,
  en: enGrammar,
  es: esGrammar,
};

export function grammarFor(language: Language): Grammar {
  return GRAMMARS[language] ?? ptBRGrammar;
}
