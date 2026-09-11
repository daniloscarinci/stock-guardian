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

/**
 * A spoken phone number as the string of digits it is.
 *
 * NOT `parseNumber`, and the difference is the whole reason this exists. A
 * phone number is a string that happens to be written in digits: "five five
 * five" is 555 to anyone reading it back and 15 to anything that adds. Put
 * through arithmetic it stops being the number somebody said, and the sentence
 * that stored it would be recorded as a number they never gave.
 *
 * So there is no arithmetic here at all. Every token is either a run of digits,
 * kept as written, or a word this language's `units` table maps to a SINGLE
 * digit, written out as that digit. Anything else returns null:
 *
 *   A group word - "hundred", "mil", "docena" - is a quantity, not a digit.
 *   "five hundred" read as 5 then 100 would store 5100, a number nobody said.
 *   A ten or a hundred in `units` - "twenty", "cem" - is refused for the same
 *   reason: "five five five twenty" could be 55520 or 5552 0 and a guess
 *   between them is a wrong phone number either way.
 *   A literal ("half"), and the joiner ("and", "y", "e"), are not digits, so
 *   they are refused rather than skipped.
 *
 * Every digit word in all three languages comes out of `units` already -
 * zero/cero, um/uno/one, and the rest - so nothing here carries a table of its
 * own. That table also maps English's article "a" and the Spanish and
 * Portuguese "un"/"una"/"um"/"uma" to 1, which is an overreach this accepts:
 * "uno" IS how a digit is read aloud in two of these languages, and no phone
 * number anybody speaks has an English "a" inside it.
 *
 * What it will not read is the English "oh" for zero. It is a LETTER being
 * used as a digit, so it has no place in a table of number words - putting it
 * there would make "oh" a spoken zero everywhere else in the grammar - and a
 * shared helper has no language of its own to keep an English-only alias in.
 * A number said that way is refused whole rather than stored with a hole in
 * it, which is what every caller of this function is expected to do with null.
 *
 * SEPARATORS. A recognizer, and a person typing, put spaces, hyphens and
 * parentheses between the groups of a phone number. None of them carries a
 * digit, so all of them are dropped: "(11) 5555-1234" and "11 5555 1234" are
 * the same number written twice. A leading "+" is the one non-digit character
 * that is part of the number itself - it is what tells a dialler the digits
 * after it are a country code - so it is kept. A "+" anywhere else is in no
 * phone number, and the whole thing is refused rather than quietly straightened
 * out.
 */
export function spokenDigits(words: NumberWords, text: string): string | null {
  const trimmed = text.trim();
  const international = trimmed.startsWith('+');
  const body = international ? trimmed.slice(1) : trimmed;
  if (body.includes('+')) return null;

  const tokens = body
    .replace(/[-()]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) return null;

  let digits = '';
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      digits += token;
      continue;
    }

    const unit = words.units[token];
    if (unit === undefined || !Number.isInteger(unit) || unit < 0 || unit > 9) return null;
    digits += String(unit);
  }

  return international ? `+${digits}` : digits;
}
