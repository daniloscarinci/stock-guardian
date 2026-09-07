/**
 * Spoken numerals to numbers.
 *
 * Additive only, which is all any language here needs: "vinte e cinco" is
 * 20 + 5, "cento e vinte" is 100 + 20. Multiplicative forms ("duzentos") are
 * table entries rather than arithmetic, because listing nine hundreds words is
 * shorter and more obviously correct than a general algorithm.
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

  for (const token of tokens) {
    if (token === words.joiner) continue;

    const group = words.groups[token];
    if (group !== undefined) {
      // "meia duzia" -> 0.5 × 12; a bare "duzia" -> 1 × 12.
      total = (total ?? 1) * group;
      continue;
    }

    const digits = parseDigits(token);
    if (digits !== null) {
      total = (total ?? 0) + digits;
      continue;
    }

    const unit = words.units[token];
    if (unit !== undefined) {
      total = (total ?? 0) + unit;
      continue;
    }

    const literal = words.literals[token];
    if (literal !== undefined) {
      total = (total ?? 0) + literal;
      continue;
    }

    return null;
  }

  return total;
}
