/**
 * SQL expressions for stock status and expiry bucket.
 *
 * Filtering ten thousand items by "critical stock, expiring within 30 days" has
 * to happen in the database - fetching every row to classify it in JavaScript
 * would defeat pagination and the performance requirement outright.
 *
 * That creates the one duplication this codebase cannot avoid: the same rule
 * expressed twice, once in `domain/stock.ts` and once in SQL. Two things keep
 * the copies honest:
 *
 *   1. Both are built from the SAME exported constants. The thresholds exist
 *      once and are interpolated here.
 *   2. `status-expressions.test.ts` runs both implementations over a matrix of
 *      inputs and asserts they agree on every one. If someone changes the JS
 *      rule without changing the SQL, that test fails immediately.
 *
 * Interpolating values into SQL is normally forbidden. It is safe here and only
 * here because every interpolated value is a numeric constant defined in this
 * codebase - never user input, which is bound.
 */
import { CRITICAL_FRACTION } from '../../domain/stock';

/** Column names this expression expects to find in scope. */
export interface StatusColumns {
  readonly quantity: string;
  readonly minimumQuantity: string;
  readonly idealQuantity: string;
  readonly expirationDate: string;
}

const DEFAULT_COLUMNS: StatusColumns = {
  quantity: 'i.quantity',
  minimumQuantity: 'i.minimum_quantity',
  idealQuantity: 'i.ideal_quantity',
  expirationDate: 'i.expiration_date',
};

/**
 * Effective minimum: the item's own, or the global fallback threshold.
 *
 * The fallback is bound as `:defaultThreshold`.
 */
export function effectiveMinimumSql(columns: StatusColumns = DEFAULT_COLUMNS): string {
  return `MAX(COALESCE(${columns.minimumQuantity}, :defaultThreshold), 0)`;
}

/**
 * Stock status, mirroring `evaluateStock`.
 *
 * The `minimum_quantity IS NULL` branch is what preserves the original
 * application's inclusive `quantity <= threshold` rule for items that set no
 * minimum of their own, while an explicitly stated minimum counts as met when
 * it is met.
 */
export function stockStatusSql(columns: StatusColumns = DEFAULT_COLUMNS): string {
  const qty = `MAX(COALESCE(${columns.quantity}, 0), 0)`;
  const min = effectiveMinimumSql(columns);
  const ideal = columns.idealQuantity;

  const surplusOrAdequate = `CASE
      WHEN ${ideal} IS NOT NULL AND ${ideal} > 0 AND ${qty} > ${ideal} THEN 'surplus'
      ELSE 'adequate'
    END`;

  return `CASE
    WHEN ${min} <= 0 THEN ${surplusOrAdequate}
    WHEN ${qty} <= 0 THEN 'critical'
    WHEN ${qty} < ${min} * ${CRITICAL_FRACTION} THEN 'critical'
    WHEN ${columns.minimumQuantity} IS NULL AND ${qty} <= ${min} THEN 'low'
    WHEN ${columns.minimumQuantity} IS NOT NULL AND ${qty} < ${min} THEN 'low'
    ELSE ${surplusOrAdequate}
  END`;
}

/** How much is still needed to reach the target. Mirrors `evaluateStock().needed`. */
export function neededSql(columns: StatusColumns = DEFAULT_COLUMNS): string {
  const qty = `MAX(COALESCE(${columns.quantity}, 0), 0)`;
  const min = effectiveMinimumSql(columns);
  const target = `CASE
      WHEN ${columns.idealQuantity} IS NOT NULL AND ${columns.idealQuantity} > 0
        THEN ${columns.idealQuantity}
      ELSE ${min}
    END`;
  // Rounded to six decimals for the same reason the JS version is: so a
  // shopping list never asks for 0.19999999999999998 litres.
  return `ROUND(MAX(${target} - ${qty}, 0), 6)`;
}

/**
 * Expiry bucket, mirroring `evaluateExpiry`.
 *
 * Comparison is lexicographic on `YYYY-MM-DD`, which is exact for ISO dates and
 * avoids `julianday()` entirely. `:today` and `:expiryHorizon` are bound by the
 * caller, which is what keeps "today" the user's LOCAL calendar date rather than
 * whatever SQLite's `date('now')` thinks in UTC.
 */
export function expiryBucketSql(columns: StatusColumns = DEFAULT_COLUMNS): string {
  const date = columns.expirationDate;
  return `CASE
    WHEN ${date} IS NULL OR ${date} = '' THEN 'none'
    WHEN ${date} < :today THEN 'expired'
    WHEN ${date} = :today THEN 'today'
    WHEN ${date} <= :expiryHorizon THEN 'soon'
    ELSE 'valid'
  END`;
}

/** Whole days until expiry; NULL when the item does not expire. */
export function daysUntilExpirySql(columns: StatusColumns = DEFAULT_COLUMNS): string {
  const date = columns.expirationDate;
  return `CASE
    WHEN ${date} IS NULL OR ${date} = '' THEN NULL
    ELSE CAST(julianday(${date}) - julianday(:today) AS INTEGER)
  END`;
}
