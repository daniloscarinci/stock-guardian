/**
 * Transcript to Intent.
 *
 * Pure, and deliberately dull: fold the text, walk the rules in order, take the
 * first that both matches and builds. A rule may decline by returning null,
 * which is how "tira zero de arroz" fails to become an adjustment instead of
 * becoming a wrong one.
 */
import { foldText } from '../domain/normalize';
import type { Intent } from './intents';
import type { Grammar, RuleTools, SlotContext } from './grammar/types';

export function parse(grammar: Grammar, transcript: string, context: SlotContext): Intent {
  const text = foldText(transcript);
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
