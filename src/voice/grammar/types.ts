/**
 * A language's grammar.
 *
 * `translate.ts` states the rule this follows: a new language is one file and
 * one registry entry, and no application logic changes. `parse.ts` takes a
 * Grammar and a string and knows nothing about any particular language.
 *
 * RULE ORDER IS LOAD-BEARING. The first rule whose pattern matches and whose
 * `build` returns non-null wins, so specific forms must precede general ones:
 * "agora tenho 12 latas" is a SET_QUANTITY and must be tried before the
 * QUERY_QUANTITY rule that also matches "tenho". `parse.test.ts` pins this.
 */
import type { Language } from '../../domain/settings';
import type { Intent } from '../intents';
import type { NumberWords } from '../numbers';
import type { DateWords } from '../dates';

export interface SlotContext {
  /** Today, passed in rather than read, so every date test is deterministic. */
  readonly today: string;
}

export interface RuleTools {
  readonly numbers: NumberWords;
  readonly dates: DateWords;
  readonly units: readonly string[];
}

export interface Rule {
  /** For test failure messages and nothing else. */
  readonly name: string;
  /** Run against folded text: lowercase, unaccented, whitespace collapsed. */
  readonly pattern: RegExp;
  /** Returns null to decline the match and let a later rule try. */
  readonly build: (
    match: RegExpMatchArray,
    tools: RuleTools,
    context: SlotContext,
  ) => Intent | null;
}

export interface Grammar {
  readonly language: Language;
  readonly rules: readonly Rule[];
  readonly numbers: NumberWords;
  readonly dates: DateWords;
  /** Spoken unit words, stripped from an item phrase before it is resolved. */
  readonly units: readonly string[];
  /** Filler words removed from an item phrase: articles, "de", "do", "da". */
  readonly fillers: readonly string[];
  /** Shown by HELP and by UNKNOWN. Drawn from here so they cannot drift. */
  readonly examples: readonly string[];
}
