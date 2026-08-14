/**
 * Preparedness scoring.
 *
 * The specification is emphatic that this number must not mislead (§7), so the
 * design rule here is: every input is visible, every step is stated, and the
 * report always carries the itemized shortfalls that produced the figure. A
 * score with no accompanying list of what is missing is a number a user cannot
 * act on, and one they have no reason to trust.
 *
 * The method, in full:
 *
 *   item score      = min(quantity / effective minimum, 1), or 0 if expired
 *   category score  = priority-weighted mean of its item scores
 *   overall         = unweighted mean of category scores
 *
 * Two choices worth defending:
 *
 *   - Item scores are capped at 1. Stockpiling 500 tins cannot compensate for
 *     having no water; coverage beyond the minimum is not preparedness, it is
 *     surplus, and it is reported separately.
 *   - Categories are weighted equally regardless of item count. A household with
 *     forty food items and one empty water category is 50% prepared, not 97%.
 *     Weighting by item count would let a well-stocked pantry hide a fatal gap.
 */
import { evaluateStock } from './stock';
import { evaluateExpiry } from './expiry';
import type { CalendarDate } from './dates';

/** Priority 1 (critical) through 4 (low). Higher priority carries more weight. */
export const PREPAREDNESS_PRIORITY_WEIGHTS: Readonly<Record<number, number>> = {
  1: 4,
  2: 3,
  3: 2,
  4: 1,
};

const DEFAULT_WEIGHT = 2;

export interface PreparednessItemInput {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly quantity: number;
  readonly minimumQuantity: number | null;
  readonly idealQuantity: number | null;
  readonly expirationDate: string | null;
  readonly priority: number;
}

export interface PreparednessInput {
  readonly items: readonly PreparednessItemInput[];
  readonly today: CalendarDate;
  readonly defaultThreshold: number;
  /** Empty means "every category that holds at least one item". */
  readonly trackedCategoryIds: readonly string[];
  readonly expiryWindows: readonly number[];
}

export type DeficitReason = 'below-minimum' | 'expired' | 'category-empty';

export interface PreparednessDeficit {
  readonly reason: DeficitReason;
  readonly categoryId: string | null;
  readonly itemId: string | null;
  readonly name: string | null;
  readonly quantity: number | null;
  readonly minimum: number | null;
  readonly needed: number | null;
  readonly priority: number | null;
}

export interface CategoryPreparedness {
  readonly categoryId: string;
  /** 0..1. */
  readonly score: number;
  readonly itemCount: number;
  readonly belowMinimum: number;
  readonly expired: number;
}

export interface PreparednessMethod {
  readonly formula: string;
  readonly itemScore: string;
  readonly categoryScore: string;
  readonly overall: string;
  readonly priorityWeights: Readonly<Record<number, number>>;
}

export interface PreparednessReport {
  /** Whole percent, 0-100. */
  readonly score: number;
  readonly method: PreparednessMethod;
  /** Weakest first, so the interface leads with what needs attention. */
  readonly categories: readonly CategoryPreparedness[];
  readonly deficits: readonly PreparednessDeficit[];
  readonly totals: {
    readonly itemsCounted: number;
    readonly belowMinimum: number;
    readonly expired: number;
    readonly categoriesCounted: number;
    readonly categoriesEmpty: number;
  };
}

const METHOD: PreparednessMethod = {
  formula: 'mean-of-category-scores',
  itemScore: 'min(quantity / minimum, 1), or 0 if expired',
  categoryScore: 'priority-weighted mean of item scores',
  overall: 'unweighted mean of category scores',
  priorityWeights: PREPAREDNESS_PRIORITY_WEIGHTS,
};

const UNCATEGORIZED = 'uncategorized';

export function evaluatePreparedness(input: PreparednessInput): PreparednessReport {
  const tracked = new Set(input.trackedCategoryIds);
  const useAllCategories = tracked.size === 0;

  const buckets = new Map<
    string,
    { weighted: number; weight: number; itemCount: number; belowMinimum: number; expired: number }
  >();
  const deficits: PreparednessDeficit[] = [];

  // Explicitly tracked categories start present so an empty one scores zero
  // rather than vanishing from the calculation.
  for (const categoryId of tracked) {
    buckets.set(categoryId, {
      weighted: 0,
      weight: 0,
      itemCount: 0,
      belowMinimum: 0,
      expired: 0,
    });
  }

  let itemsCounted = 0;
  let belowMinimum = 0;
  let expiredCount = 0;

  for (const item of input.items) {
    const categoryId = item.categoryId ?? UNCATEGORIZED;
    if (!useAllCategories && !tracked.has(categoryId)) continue;

    const stock = evaluateStock(
      {
        quantity: item.quantity,
        minimumQuantity: item.minimumQuantity,
        idealQuantity: item.idealQuantity,
      },
      input.defaultThreshold,
    );
    const expiry = evaluateExpiry(item.expirationDate, input.today, input.expiryWindows);
    const isExpired = expiry.bucket === 'expired';

    const score = isExpired ? 0 : stock.coverage;
    const weight = PREPAREDNESS_PRIORITY_WEIGHTS[item.priority] ?? DEFAULT_WEIGHT;

    const bucket = buckets.get(categoryId) ?? {
      weighted: 0,
      weight: 0,
      itemCount: 0,
      belowMinimum: 0,
      expired: 0,
    };
    bucket.weighted += score * weight;
    bucket.weight += weight;
    bucket.itemCount += 1;
    buckets.set(categoryId, bucket);

    itemsCounted += 1;

    if (isExpired) {
      expiredCount += 1;
      bucket.expired += 1;
      deficits.push({
        reason: 'expired',
        categoryId: item.categoryId,
        itemId: item.id,
        name: item.name,
        quantity: item.quantity,
        minimum: stock.effectiveMinimum,
        needed: stock.needed,
        priority: item.priority,
      });
    } else if (stock.coverage < 1) {
      belowMinimum += 1;
      bucket.belowMinimum += 1;
      deficits.push({
        reason: 'below-minimum',
        categoryId: item.categoryId,
        itemId: item.id,
        name: item.name,
        quantity: item.quantity,
        minimum: stock.effectiveMinimum,
        needed: stock.needed,
        priority: item.priority,
      });
    }
  }

  const categories: CategoryPreparedness[] = [];
  let categoriesEmpty = 0;

  for (const [categoryId, bucket] of buckets) {
    if (bucket.itemCount === 0) {
      categoriesEmpty += 1;
      deficits.push({
        reason: 'category-empty',
        categoryId,
        itemId: null,
        name: null,
        quantity: null,
        minimum: null,
        needed: null,
        priority: null,
      });
    }
    categories.push({
      categoryId,
      score: bucket.weight === 0 ? 0 : bucket.weighted / bucket.weight,
      itemCount: bucket.itemCount,
      belowMinimum: bucket.belowMinimum,
      expired: bucket.expired,
    });
  }

  categories.sort((a, b) => a.score - b.score || a.categoryId.localeCompare(b.categoryId));

  // Worst first: expired before merely low, then most urgent priority, then
  // largest shortfall - the order someone restocking would work through.
  const reasonRank: Record<DeficitReason, number> = {
    expired: 0,
    'category-empty': 1,
    'below-minimum': 2,
  };
  deficits.sort(
    (a, b) =>
      reasonRank[a.reason] - reasonRank[b.reason] ||
      (a.priority ?? 5) - (b.priority ?? 5) ||
      (b.needed ?? 0) - (a.needed ?? 0) ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );

  const score =
    categories.length === 0
      ? 0
      : Math.round(
          (categories.reduce((sum, category) => sum + category.score, 0) / categories.length) * 100,
        );

  return {
    score,
    method: METHOD,
    categories,
    deficits,
    totals: {
      itemsCounted,
      belowMinimum,
      expired: expiredCount,
      categoriesCounted: categories.length,
      categoriesEmpty,
    },
  };
}
