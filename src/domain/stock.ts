/**
 * Stock level evaluation.
 *
 * Pure and I/O-free. Every "is this running low" decision in the application -
 * dashboard counters, the replenishment centre, the preparedness score, report
 * generation - resolves through this one function, so they can never disagree.
 *
 * The original application had a single global rule: `parseFloat(qty) <= N`,
 * with N defaulting to 5. That rule is preserved exactly, but only where it
 * still makes sense: as the fallback for items that carry no minimum of their
 * own. Once a user states a minimum for an item, meeting that minimum counts as
 * meeting it, and the inclusive comparison no longer applies.
 */

export type StockStatus = 'critical' | 'low' | 'adequate' | 'surplus';

/**
 * Below this fraction of the minimum, an item is critical rather than low.
 *
 * Exported because the SQL filter in `repositories/sql/status-expressions.ts`
 * is built from it - the rule is expressed twice, but the constant only once.
 */
export const CRITICAL_FRACTION = 0.5;

export interface StockInput {
  readonly quantity: number;
  readonly minimumQuantity: number | null;
  readonly idealQuantity: number | null;
}

export interface StockEvaluation {
  readonly status: StockStatus;
  /** How much to acquire to reach the target, or the minimum if none is set. */
  readonly needed: number;
  /** The minimum actually applied, whether the item's own or the global default. */
  readonly effectiveMinimum: number;
  /** True when the item set no minimum and the global threshold was used. */
  readonly usedDefaultThreshold: boolean;
  /** Fraction of the minimum held, clamped to 0..1. Feeds the preparedness score. */
  readonly coverage: number;
}

/**
 * Rounds away binary floating-point dust.
 *
 * `0.3 - 0.1` is `0.19999999999999998`. A replenishment list that says
 * "buy 0.19999999999999998 L of water" is not usable output, and rounding at
 * the point of display would leave the underlying comparisons just as noisy.
 */
function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function sanitizeQuantity(value: number): number {
  // Corrupt or hand-edited data can carry NaN. Treating it as "none in stock"
  // surfaces the problem to the user instead of poisoning every arithmetic
  // result downstream with NaN.
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function evaluateStock(input: StockInput, defaultThreshold: number): StockEvaluation {
  const quantity = sanitizeQuantity(input.quantity);

  const hasOwnMinimum =
    input.minimumQuantity !== null && Number.isFinite(input.minimumQuantity);
  const usedDefaultThreshold = !hasOwnMinimum;

  const rawMinimum = hasOwnMinimum ? (input.minimumQuantity as number) : defaultThreshold;
  const effectiveMinimum = Number.isFinite(rawMinimum) && rawMinimum > 0 ? rawMinimum : 0;

  const hasIdeal =
    input.idealQuantity !== null &&
    Number.isFinite(input.idealQuantity) &&
    (input.idealQuantity as number) > 0;
  const ideal = hasIdeal ? (input.idealQuantity as number) : null;

  const target = ideal ?? effectiveMinimum;
  const needed = tidy(Math.max(0, target - quantity));

  // Requiring nothing is satisfied by holding nothing; reporting 0% coverage for
  // an item the user said they need none of would misrepresent their setup.
  const coverage = effectiveMinimum === 0 ? 1 : Math.min(1, tidy(quantity / effectiveMinimum));

  return {
    status: classify({ quantity, effectiveMinimum, ideal, usedDefaultThreshold }),
    needed,
    effectiveMinimum,
    usedDefaultThreshold,
    coverage,
  };
}

function classify(args: {
  quantity: number;
  effectiveMinimum: number;
  ideal: number | null;
  usedDefaultThreshold: boolean;
}): StockStatus {
  const { quantity, effectiveMinimum, ideal, usedDefaultThreshold } = args;

  if (effectiveMinimum > 0) {
    if (quantity <= 0) return 'critical';
    if (quantity < effectiveMinimum * CRITICAL_FRACTION) return 'critical';

    if (usedDefaultThreshold) {
      // The original rule, preserved: at or below the global threshold is low.
      if (quantity <= effectiveMinimum) return 'low';
    } else if (quantity < effectiveMinimum) {
      // An explicit minimum that is met, is met.
      return 'low';
    }
  }

  if (ideal !== null && quantity > ideal) return 'surplus';
  return 'adequate';
}
