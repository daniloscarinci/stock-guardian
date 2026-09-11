import type { NumberWords } from '../numbers';

/**
 * English number words.
 *
 * `a` and `an` are numbers here, and that is not a shortcut. "add a can of
 * beans" names a quantity as plainly as "adiciona uma lata de feijao" does, and
 * `uma` is a unit in the Portuguese table for exactly the same reason. Without
 * them the sentence has no amount, which the grammar refuses to guess at, and
 * the most ordinary way an English speaker adds one of something would stay
 * UNKNOWN.
 *
 * The article is also what makes English say a fraction differently from the
 * other two languages - "half a dozen", not "meia duzia" - and that extra word
 * is taken back out in `en.ts` before a phrase reaches `parseNumber`.
 */
export const enNumbers: NumberWords = {
  units: {
    zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  },
  /**
   * Words that multiply what precedes them: "two dozen" is 2 x 12 and "five
   * hundred" is 5 x 100, while a bare "dozen" is 1 x 12.
   *
   * English builds its hundreds and thousands out of these rather than out of
   * single words, which is the one place this table is weaker than the
   * Portuguese one: "two thousand five hundred" multiplies where it should add.
   * Nobody stocks a pantry in those numbers, and a wrong reading there would be
   * shown on the confirmation card before anything was written.
   */
  groups: { hundred: 100, thousand: 1000, dozen: 12, dozens: 12, pair: 2, pairs: 2 },
  /** Standalone quantities that need no numeral. */
  literals: { half: 0.5 },
  /** Joins hundreds to the rest: "one hundred and twenty". */
  joiner: 'and',
  /**
   * "five oh five" is 505. The letter O read as a zero, which is a thing
   * English does only while spelling a number out and never means a quantity
   * by - "oh" is in no other table here for exactly that reason.
   */
  digitAliases: { oh: 0 },
};
