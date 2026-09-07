/**
 * Spoken numerals to numbers.
 *
 * Mostly additive: "vinte e cinco" is 20 + 5, "cento e vinte" is 100 + 20. The
 * hundreds ("duzentos") are table entries rather than arithmetic, because
 * listing nine words is shorter and more obviously correct than a general
 * algorithm.
 *
 * Two constructions are not additive, and pretending otherwise produced silent
 * wrong quantities:
 *
 *   - A GROUP word multiplies what precedes it. "duas dúzias" is 2 × 12 and
 *     "dois mil" is 2 × 1000 - never 2 + 12 or 2 + 1000.
 *   - A LITERAL right after a group scales by that group, not by one.
 *     "dúzia e meia" is a dozen plus HALF A DOZEN, 18. Adding the bare literal
 *     gave 12.5, and "mil e meio" gave 1000.5 instead of 1500. Both are numbers
 *     a speaker would never mean, and neither raises an error on the way into
 *     the inventory.
 *
 * Everything else stays additive, so the tables carry no arithmetic of their
 * own beyond the two multiplying cases above.
 */
export interface NumberWords {
  readonly units: Readonly<Record<string, number>>;
  readonly groups: Readonly<Record<string, number>>;
  readonly literals: Readonly<Record<string, number>>;
  readonly joiner: string;
}

/** Digits, with a comma decimal separator as Portuguese and Spanish write it. */
function parseDigits(token: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(token)) return null;
  const value = Number(token.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Returns null rather than 0 for text that holds no number, so a caller can
 * tell "he said zero" from "he said nothing".
 */
export function parseNumber(words: NumberWords, text: string): number | null {
  const tokens = text.split(' ').filter((token) => token !== '');
  if (tokens.length === 0) return null;

  let total: number | null = null;

  /**
   * The size of the group word most recently applied, while a trailing literal
   * could still refer to it: "dúzia e MEIA" means half of a dúzia.
   *
   * The joiner does not disturb it - it is the word that stands between the
   * group and the literal in every phrase this exists for. Anything else
   * clears it, so "dúzia e vinte e meia" adds a plain 0.5 rather than half a
   * dozen: once another quantity has been spoken, "meia" is no longer about
   * the group.
   */
  let openGroup: number | null = null;

  for (const token of tokens) {
    if (token === words.joiner) continue;

    const group = words.groups[token];
    if (group !== undefined) {
      // "meia duzia" -> 0.5 × 12; a bare "duzia" -> 1 × 12; "dois mil" -> 2 × 1000.
      total = (total ?? 1) * group;
      openGroup = group;
      continue;
    }

    const digits = parseDigits(token);
    if (digits !== null) {
      total = (total ?? 0) + digits;
      openGroup = null;
      continue;
    }

    const unit = words.units[token];
    if (unit !== undefined) {
      total = (total ?? 0) + unit;
      openGroup = null;
      continue;
    }

    const literal = words.literals[token];
    if (literal !== undefined) {
      /*
       * Scaled by the open group, so "duas dúzias e meia" is 24 + half of ONE
       * dúzia = 30 - two and a half dozen, which is what the phrase means.
       *
       * Note this is not `total × (1 + literal)`, the shape the rule first
       * suggests: that reads the half as half of everything said so far and
       * turns "duas dúzias e meia" into 36. The half attaches to the group
       * word, not to the running total, and the two only agree when exactly
       * one group was spoken.
       */
      total = (total ?? 0) + literal * (openGroup ?? 1);
      openGroup = null;
      continue;
    }

    return null;
  }

  return total;
}
