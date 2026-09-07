/**
 * Transcript to Intent.
 *
 * Pure, and deliberately dull: fold the text, take the punctuation back off,
 * walk the rules in order, take the first that both matches and builds. A rule
 * may decline by returning null, which is how "tira zero de arroz" fails to
 * become an adjustment instead of becoming a wrong one.
 */
import { foldText } from '../domain/normalize';
import type { Intent } from './intents';
import type { Grammar, RuleTools, SlotContext } from './grammar/types';

/**
 * Sentence punctuation: characters that open or close a sentence and can never
 * belong to a product name or a number.
 *
 * Removing `?` cannot cost a match. Every rule that mentions one writes it as
 * `\??`, optional, so a pattern that accepted the question mark still accepts
 * the sentence without it - and the rules that never mentioned it stop losing
 * a stray `?` into a captured item or a captured date.
 *
 * Removing `¿` is what lets Spanish work at all. `foldText` decomposes to NFD
 * and drops COMBINING marks, and U+00BF is not one: "¿cuánto arroz tengo?"
 * reaches a rule as "¿cuanto arroz tengo?" with the opener still on the front.
 * Every Spanish question rule is anchored at `^`, so every one of them would
 * silently never match.
 */
const SENTENCE_PUNCTUATION = /[¿¡?!;"“”«»…]/g;

/**
 * A period or a comma that is not INSIDE a number.
 *
 * Both are decimal separators - "1,5 kg" as Portuguese and Spanish write it,
 * "1.5 kg" as English does - and `parseNumber` reads either. So they are
 * dropped only where a digit does not stand on both sides: "feijao." loses its
 * period and "arroz, feijao" its comma, while "1,5" and "1.5" keep theirs.
 */
const DOT_OR_COMMA_OUTSIDE_A_NUMBER = /(?<!\d)[.,]|[.,](?!\d)/g;

/**
 * Folded text with the punctuation a recognizer adds taken back off.
 *
 * Chrome's recognizer ends a phrase with a period often enough to matter, and
 * the typed box certainly can. Left in place it reaches `resolve.ts` inside the
 * item phrase, which searches for `%feijao.%` and reports, with confidence,
 * that the user has none of it.
 *
 * The fix belongs here and not in `foldText`. That function builds the `*_norm`
 * columns as well as the queries run against them, so a period removed there
 * would have to be removed from data already written, in a migration, to keep
 * the two sides identical. One regex in the voice layer costs nothing and
 * changes nothing outside it.
 *
 * Four characters survive on purpose:
 *
 *   `/`  separates a spoken date - "12/09" is read by `parseSpokenDate`.
 *   `-`  holds an ISO date together and appears inside real names.
 *   `'`  belongs to the name that carries it, and the item search is a
 *        substring match against text stored with the apostrophe still in it.
 *   `:`  is read by the CREATE_ITEM rules themselves - "criar item: arroz".
 */
function stripPunctuation(folded: string): string {
  return folded
    .replace(SENTENCE_PUNCTUATION, '')
    .replace(DOT_OR_COMMA_OUTSIDE_A_NUMBER, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parse(grammar: Grammar, transcript: string, context: SlotContext): Intent {
  const text = stripPunctuation(foldText(transcript));
  if (text === '') return { kind: 'UNKNOWN', transcript };

  const tools: RuleTools = {
    numbers: grammar.numbers,
    dates: grammar.dates,
    units: grammar.units,
  };

  for (const rule of grammar.rules) {
    const match = text.match(rule.pattern);
    if (match === null) continue;

    const intent = rule.build(match, tools, context);
    if (intent !== null) return intent;
  }

  return { kind: 'UNKNOWN', transcript };
}
