/**
 * An Intent, executed.
 *
 * THIS MODULE NEVER WRITES. A changing intent returns a `PendingWrite`
 * describing what would happen; only `commit.ts`, called by the confirmation
 * card, touches a repository's write path. `execute.writes.test.ts` asserts
 * that no execution of any intent reaches the driver with an UPDATE or INSERT.
 */
import type { Intent } from '../../voice/intents';
import type { InventoryItemView, StockTransactionType } from '../../types/domain';
import type { ItemContext, ItemsRepository } from '../../repositories/items.repository';
import type { LocationsRepository } from '../../repositories/locations.repository';
import type { Language } from '../../domain/settings';
import type { ReplenishmentLine } from '../../domain/replenishment';
import { buildReplenishmentList } from '../../domain/replenishment';
import { foldText } from '../../domain/normalize';
import { resolveItem } from './resolve';

export interface VoiceDeps {
  readonly items: ItemsRepository;
  readonly locations: LocationsRepository;
  readonly context: ItemContext;
  readonly language: Language;
}

export type Answer =
  | { readonly kind: 'QUANTITY'; readonly item: InventoryItemView }
  | { readonly kind: 'EXPIRING'; readonly items: readonly InventoryItemView[]; readonly withinDays: number; readonly expiredOnly: boolean }
  | { readonly kind: 'MISSING'; readonly lines: readonly ReplenishmentLine[] }
  | { readonly kind: 'WHERE_ITEM'; readonly item: InventoryItemView }
  | { readonly kind: 'WHERE_LOCATION'; readonly locationName: string; readonly items: readonly InventoryItemView[] }
  | { readonly kind: 'EXPIRY_OF'; readonly item: InventoryItemView }
  | { readonly kind: 'SCORE'; readonly score: number }
  | { readonly kind: 'HELP'; readonly examples: readonly string[] };

export type PendingWrite =
  | {
      readonly kind: 'ADJUST';
      readonly item: InventoryItemView;
      /** Signed. Negative for a removal, so `commit` needs no direction flag. */
      readonly delta: number;
      /** What the quantity becomes, clamped at zero as `adjustQuantity` clamps. */
      readonly after: number;
      readonly transaction: StockTransactionType;
    }
  | {
      readonly kind: 'CREATE';
      readonly name: string;
      readonly quantity: number;
      readonly unit: string;
      readonly locationId: string | null;
      readonly locationName: string | null;
      readonly expirationDate: string | null;
    }
  | {
      readonly kind: 'EXPIRY';
      readonly item: InventoryItemView;
      readonly before: string | null;
      readonly after: string;
    };

export type Outcome =
  | { readonly kind: 'answer'; readonly answer: Answer }
  | { readonly kind: 'pending'; readonly write: PendingWrite }
  | { readonly kind: 'choice'; readonly items: readonly InventoryItemView[]; readonly total: number; readonly intent: Intent }
  | { readonly kind: 'notFound'; readonly phrase: string; readonly intent: Intent }
  | { readonly kind: 'unknown'; readonly transcript: string; readonly examples: readonly string[] };

/** Rows read for a list answer. Well past what anyone wants read aloud. */
const LIST_LIMIT = 50;

/** The window used when the phrase carried no number and the user set none. */
const FALLBACK_WINDOW_DAYS = 30;

/**
 * A resolution, flattened into "here is the item" or "here is the outcome".
 *
 * The caller can then `if (!found.ok) return found.outcome;` and carry on with
 * a plain `InventoryItemView`, which keeps the eleven branches below readable.
 */
type Found =
  | { readonly ok: true; readonly item: InventoryItemView }
  | { readonly ok: false; readonly outcome: Outcome };

async function one(deps: VoiceDeps, phrase: string, intent: Intent): Promise<Found> {
  const resolution = await resolveItem(deps.items, deps.context, deps.language, phrase);
  switch (resolution.kind) {
    case 'one':
      return { ok: true, item: resolution.item };
    case 'many':
      return {
        ok: false,
        outcome: {
          kind: 'choice',
          items: resolution.items,
          total: resolution.total,
          intent,
        },
      };
    case 'none':
      return { ok: false, outcome: { kind: 'notFound', phrase: resolution.phrase, intent } };
  }
}

/**
 * A location phrase to a location.
 *
 * Matches on CONTAINS rather than on equality, because a speaker says
 * "despensa" for a place recorded as "Despensa Principal". That is also why
 * `locations.findByName` is not used: it compares the whole folded name and
 * would report the shelf missing.
 */
async function findLocation(
  deps: VoiceDeps,
  phrase: string,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  const folded = foldText(phrase);
  if (folded === '') return undefined;

  const all = await deps.locations.list();
  const match =
    all.find((location) => foldText(location.name) === folded) ??
    all.find((location) => foldText(location.name).includes(folded));
  return match === undefined ? undefined : { id: match.id, name: match.name };
}

/** Everything held in one location and everything below it. */
async function itemsIn(deps: VoiceDeps, locationId: string): Promise<readonly InventoryItemView[]> {
  const page = await deps.items.list(deps.context, {
    filters: { locationIds: [locationId], includeSublocations: true, archived: 'active' },
    limit: LIST_LIMIT,
    lang: deps.language,
  });
  return page.rows;
}

export async function execute(deps: VoiceDeps, intent: Intent): Promise<Outcome> {
  switch (intent.kind) {
    case 'QUERY_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return { kind: 'answer', answer: { kind: 'QUANTITY', item: found.item } };
    }

    case 'QUERY_EXPIRY_OF': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return { kind: 'answer', answer: { kind: 'EXPIRY_OF', item: found.item } };
    }

    case 'QUERY_EXPIRING': {
      const withinDays =
        intent.withinDays ?? deps.context.expiryWindows[0] ?? FALLBACK_WINDOW_DAYS;
      const page = await deps.items.list(deps.context, {
        filters: {
          expiryBuckets: intent.expiredOnly ? ['expired'] : ['expired', 'today', 'soon'],
          archived: 'active',
        },
        sort: { field: 'expiration', direction: 'asc' },
        limit: LIST_LIMIT,
        lang: deps.language,
      });
      // The buckets are cut by the user's widest warning window, which is
      // usually wider than the window that was asked for. `daysUntilExpiry` is
      // negative for anything already past, so expired stock always survives.
      const items = page.rows.filter(
        (item) => item.daysUntilExpiry !== null && item.daysUntilExpiry <= withinDays,
      );
      return {
        kind: 'answer',
        answer: { kind: 'EXPIRING', items, withinDays, expiredOnly: intent.expiredOnly },
      };
    }

    case 'QUERY_MISSING': {
      const items = await deps.items.listForAnalysis();
      const lines = buildReplenishmentList({
        items,
        today: deps.context.today,
        defaultThreshold: deps.context.defaultThreshold,
        expiryWindows: deps.context.expiryWindows,
      });
      return { kind: 'answer', answer: { kind: 'MISSING', lines } };
    }

    case 'QUERY_WHERE': {
      if (intent.item !== null) {
        const found = await one(deps, intent.item, intent);
        if (!found.ok) return found.outcome;
        return { kind: 'answer', answer: { kind: 'WHERE_ITEM', item: found.item } };
      }

      // The intent carries exactly one of the two; an empty phrase can only
      // come from a caller building an intent by hand, and is treated as a
      // place that could not be found rather than crashing.
      const phrase = intent.location ?? '';
      const location = await findLocation(deps, phrase);
      if (location === undefined) return { kind: 'notFound', phrase, intent };

      return {
        kind: 'answer',
        answer: {
          kind: 'WHERE_LOCATION',
          locationName: location.name,
          items: await itemsIn(deps, location.id),
        },
      };
    }

    case 'QUERY_SCORE': {
      const stats = await deps.items.dashboardStats(deps.context);
      const total = stats.totalItems;
      // An item can be both critical and expired, so the subtraction can go
      // past zero. A negative preparedness score is not a number anyone can
      // act on; zero is.
      const healthy = total - stats.critical - stats.low - stats.expired;
      const score = total === 0 ? 0 : Math.max(0, Math.round((healthy / total) * 100));
      return { kind: 'answer', answer: { kind: 'SCORE', score } };
    }

    case 'ADJUST_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      const delta = intent.direction === 'up' ? intent.amount : -intent.amount;
      return pendingAdjust(found.item, delta, intent.transaction);
    }

    case 'SET_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return pendingAdjust(found.item, intent.amount - found.item.quantity, 'correction');
    }

    case 'SET_EXPIRY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return {
        kind: 'pending',
        write: {
          kind: 'EXPIRY',
          item: found.item,
          before: found.item.expirationDate,
          after: intent.expiresOn,
        },
      };
    }

    case 'CREATE_ITEM': {
      let locationId: string | null = null;
      let locationName: string | null = null;

      if (intent.location !== null) {
        const location = await findLocation(deps, intent.location);
        // Refused rather than created unplaced. A speaker who named a shelf and
        // got an item with no location would have to notice the absence of
        // something; being told the shelf is unknown is visible and correctable.
        if (location === undefined) {
          return { kind: 'notFound', phrase: intent.location, intent };
        }
        locationId = location.id;
        locationName = location.name;
      }

      return {
        kind: 'pending',
        write: {
          kind: 'CREATE',
          name: intent.name,
          quantity: intent.amount ?? 1,
          unit: intent.unit ?? 'un',
          locationId,
          locationName,
          expirationDate: intent.expiresOn,
        },
      };
    }

    // The examples belong to the grammar, which lives in `src/voice/` and is
    // per-language. `execute` has no grammar and must not grow one.
    case 'HELP':
      return { kind: 'answer', answer: { kind: 'HELP', examples: [] } };

    case 'UNKNOWN':
      return { kind: 'unknown', transcript: intent.transcript, examples: [] };
  }
}

/**
 * An adjustment, or the statement of fact it turns out to be.
 *
 * A delta of zero is not a change: `adjustQuantity` returns early on one,
 * writing neither the quantity nor a history row. Sending it to a confirmation
 * card would ask the user to confirm nothing and then record nothing, so
 * "corrija arroz para 10" when there are already 10 answers with the quantity
 * instead - which is the true and useful thing to say.
 */
function pendingAdjust(
  item: InventoryItemView,
  delta: number,
  transaction: StockTransactionType,
): Outcome {
  if (delta === 0) return { kind: 'answer', answer: { kind: 'QUANTITY', item } };
  return {
    kind: 'pending',
    write: {
      kind: 'ADJUST',
      item,
      delta,
      after: Math.max(0, item.quantity + delta),
      transaction,
    },
  };
}
