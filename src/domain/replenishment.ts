/**
 * Replenishment planning.
 *
 * Answers one question: what should be acquired, and how much. Pure and
 * I/O-free, so the shopping list, the replenishment centre and the
 * replenishment report all derive from the same computation.
 *
 * The one judgement worth stating: expired stock counts as no stock. An item
 * showing 30 kg with a date six months past is not 30 kg of food, so it appears
 * on the list asking for the full target rather than being filtered out because
 * its quantity looks healthy. The original application had no concept of this -
 * expiry and stock level were unrelated indicators sitting side by side.
 */
import { evaluateExpiry } from './expiry';
import { evaluateStock, type StockStatus } from './stock';
import type { CalendarDate } from './dates';

export type ReplenishmentReason = 'expired' | 'below-target';

export interface ReplenishmentItemInput {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly categoryId: string | null;
  readonly quantity: number;
  readonly minimumQuantity: number | null;
  readonly idealQuantity: number | null;
  readonly expirationDate: string | null;
  readonly priority: number;
}

export interface ReplenishmentInput {
  readonly items: readonly ReplenishmentItemInput[];
  readonly today: CalendarDate;
  readonly defaultThreshold: number;
  readonly expiryWindows: readonly number[];
  /** Items the user has explicitly dismissed from the list. */
  readonly dismissedItemIds?: readonly string[];
  /** Quantities already bought against an outstanding need, by item id. */
  readonly purchased?: Readonly<Record<string, number>>;
}

export interface ReplenishmentLine {
  readonly itemId: string;
  readonly name: string;
  readonly unit: string;
  readonly categoryId: string | null;
  readonly reason: ReplenishmentReason;
  readonly status: StockStatus;
  readonly priority: number;
  readonly current: number;
  readonly minimum: number;
  readonly target: number;
  /** Still outstanding after accounting for anything already purchased. */
  readonly needed: number;
  /** Before purchases were deducted, so progress can be shown. */
  readonly originalNeeded: number;
  readonly purchased: number;
  readonly expirationDate: string | null;
}

function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

const STATUS_RANK: Record<StockStatus, number> = {
  critical: 0,
  low: 1,
  adequate: 2,
  surplus: 3,
};

export function buildReplenishmentList(input: ReplenishmentInput): ReplenishmentLine[] {
  const dismissed = new Set(input.dismissedItemIds ?? []);
  const purchasedByItem = input.purchased ?? {};
  const lines: ReplenishmentLine[] = [];

  for (const item of input.items) {
    if (dismissed.has(item.id)) continue;

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

    const target =
      item.idealQuantity !== null && Number.isFinite(item.idealQuantity) && item.idealQuantity > 0
        ? item.idealQuantity
        : stock.effectiveMinimum;

    // Expired stock is unusable, so the whole target has to be replaced.
    const originalNeeded = tidy(isExpired ? target : stock.needed);
    if (originalNeeded <= 0) continue;

    const purchased = Math.max(0, purchasedByItem[item.id] ?? 0);
    const needed = tidy(Math.max(0, originalNeeded - purchased));
    if (needed <= 0) continue;

    lines.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      categoryId: item.categoryId,
      reason: isExpired ? 'expired' : 'below-target',
      status: isExpired ? 'critical' : stock.status,
      priority: item.priority,
      current: item.quantity,
      minimum: stock.effectiveMinimum,
      target,
      needed,
      originalNeeded,
      purchased,
      expirationDate: item.expirationDate,
    });
  }

  // The order someone restocking would work through: replace what has spoiled,
  // then what is nearly gone, then by how urgent the item itself is.
  lines.sort(
    (a, b) =>
      (a.reason === 'expired' ? 0 : 1) - (b.reason === 'expired' ? 0 : 1) ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.priority - b.priority ||
      b.needed - a.needed ||
      a.name.localeCompare(b.name),
  );

  return lines;
}
