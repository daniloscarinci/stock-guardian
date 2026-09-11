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
  /**
   * Words that are a DIGIT when digits are being read out, and something else
   * the rest of the time.
   *
   * Read only by `spokenDigits`, never by `parseNumber`, and that separation is
   * the whole point of the field. Brazilians dictate a phone number saying
   * "meia" for six - it is half a dozen - and "meia" is already a `literals`
   * entry worth 0.5, which is what it means in "meia duzia de ovos". English
   * says "oh" for zero while reading digits and never means a number by it
   * anywhere else. Putting either in `units` would fix the phone number and
   * break the pantry: "meia duzia" would become 6 dozen, and "oh" would become
   * a spoken zero in every sentence in the grammar.
   *
   * Required rather than optional, so a fourth language has to answer the
   * question instead of inheriting an empty answer. Spanish's is empty because
   * Spanish has no such word - "cero" is what a Spanish speaker says.
   */
  readonly digitAliases: Readonly<Record<string, number>>;
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
 * zero/cero, um/uno/one, and the rest - so the tables carry nothing extra for
 * the ordinary case. That table also maps English's articles "a" and "an", and
 * the Spanish and Portuguese "un"/"uno"/"una"/"um"/"uma", to 1, which is an
 * overreach this accepts: "uno" IS how a digit is read aloud in two of these
 * languages, and no phone number anybody speaks has an English "a" or "an"
 * inside it.
 *
 * `digitAliases` is for the words that are a digit HERE and something else
 * everywhere else. Brazilians say "meia" for six when reading a number out -
 * it is half a dozen - and "meia" is a `literals` entry worth 0.5, which is
 * what it means in "meia duzia de ovos". English says "oh" for zero while
 * reading digits and means no number at all by it anywhere else. Both are read
 * here and neither is read by `parseNumber`, so "cinco meia sete" is 567 and
 * "meia duzia" is still six eggs.
 *
 * A word that is in both tables is a digit here on the alias's terms: the
 * alias is consulted first, because a table that has to be consulted second to
 * be worth having would not have been worth adding. In practice only "meia"
 * is in both, and 0.5 was never a digit anyway.
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

    const value = words.digitAliases[token] ?? words.units[token];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 9) return null;
    digits += String(value);
  }

  return international ? `+${digits}` : digits;
}
