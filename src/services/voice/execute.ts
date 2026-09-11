/**
 * An Intent, executed.
 *
 * THIS MODULE NEVER WRITES. A changing intent returns a `PendingWrite`
 * describing what would happen; only `commit.ts`, called by the confirmation
 * card, touches a repository's write path. `execute.writes.test.ts` asserts
 * that no execution of any intent reaches the driver with an UPDATE or INSERT.
 */
import type { Intent } from '../../voice/intents';
import type { Contact, InventoryItemView, StockTransactionType } from '../../types/domain';
import type {
  DashboardStats,
  ItemContext,
  ItemsRepository,
} from '../../repositories/items.repository';
import type { LocationsRepository } from '../../repositories/locations.repository';
import type { CategoriesRepository } from '../../repositories/categories.repository';
import type { ContactsRepository } from '../../repositories/contacts.repository';
import type { Language } from '../../domain/settings';
import type { ReplenishmentLine } from '../../domain/replenishment';
import { buildReplenishmentList } from '../../domain/replenishment';
import { evaluatePreparedness } from '../../domain/preparedness';
import { foldText } from '../../domain/normalize';
import { toCalendarDate } from '../../domain/dates';
import type { SqlRow } from '../../database/driver/types';
import { resolveItem } from './resolve';

export interface VoiceDeps {
  readonly items: ItemsRepository;
  readonly locations: LocationsRepository;
  /**
   * Needed to turn a spoken category into the id `items.list` filters on.
   *
   * Category names live in a side table, one row per language, so a phrase
   * cannot be matched against anything the items themselves carry.
   */
  readonly categories: CategoriesRepository;
  /**
   * The emergency contacts, read and never written.
   *
   * A phone number is the one thing in this application somebody might need
   * while holding the phone in the dark, so it is answerable by voice - but
   * QUERY_CONTACT has no write path at all, here or in `commit.ts`.
   */
  readonly contacts: ContactsRepository;
  readonly context: ItemContext;
  readonly language: Language;
  /** From settings.preparednessCategoryIds. Empty means every category that holds an item. */
  readonly trackedCategoryIds: readonly string[];
  /**
   * From settings.replenishmentDismissed. Items the user has taken off the
   * replenishment list.
   *
   * Required rather than optional, and that is the fix rather than an
   * incidental choice. This was absent, so every caller of `buildReplenishmentList`
   * outside the Replenishment screen quietly omitted it and told the user to
   * buy something they had explicitly dismissed. A required field makes a new
   * caller answer the question rather than inherit the wrong answer.
   */
  readonly dismissedItemIds: readonly string[];
}

/**
 * One movement of one item, as a sentence needs it.
 *
 * `items.history` returns raw rows - snake_case, and typed only as `SqlRow` -
 * so they are mapped here rather than carried up. `occurredAt` is an instant
 * in the table and a calendar date in every sentence anyone says about it.
 */
export interface HistoryEntry {
  readonly type: StockTransactionType;
  readonly quantity: number;
  /** A calendar date, already cut down from the stored instant. */
  readonly on: string;
}

export type Answer =
  | { readonly kind: 'QUANTITY'; readonly item: InventoryItemView }
  | { readonly kind: 'EXPIRING'; readonly items: readonly InventoryItemView[]; readonly withinDays: number; readonly expiredOnly: boolean }
  | { readonly kind: 'MISSING'; readonly lines: readonly ReplenishmentLine[] }
  | { readonly kind: 'WHERE_ITEM'; readonly item: InventoryItemView }
  | { readonly kind: 'WHERE_LOCATION'; readonly locationName: string; readonly items: readonly InventoryItemView[] }
  | { readonly kind: 'CATEGORY'; readonly categoryName: string; readonly items: readonly InventoryItemView[]; readonly total: number }
  | { readonly kind: 'CONTACT'; readonly query: string; readonly contacts: readonly Contact[] }
  | { readonly kind: 'HISTORY'; readonly item: InventoryItemView; readonly entries: readonly HistoryEntry[] }
  | { readonly kind: 'TOTAL'; readonly stats: DashboardStats }
  | { readonly kind: 'EXPIRY_OF'; readonly item: InventoryItemView }
  | { readonly kind: 'SCORE'; readonly score: number }
  | { readonly kind: 'HELP'; readonly examples: readonly string[] };

/**
 * Why a write is a guess. Translation-key suffixes, and nothing more.
 *
 * Each one names something the application supplied that the user did not say,
 * so the confirmation card can show what it filled in rather than presenting
 * the whole write as if every part of it had been spoken.
 */
export type AssumptionReason =
  | 'quantity'   // no number was spoken
  | 'item'       // matched by something looser than an exact name
  | 'unit'       // the spoken unit differed from the stored one
  | 'date'       // the date was derived rather than stated
  | 'newItem'    // the item does not exist yet
  /**
   * The destination matched a place by containing its name, not by being it.
   *
   * `findLocation` matches on CONTAINS, so "porao" finds "Porão dos fundos"
   * and would find the wrong one of two cellars just as readily. A move is the
   * one write whose whole content is a place, so a place matched loosely is
   * exactly the part of it worth showing before it happens.
   */
  | 'location'
  /**
   * A model chose this row, not the parser and not the user.
   *
   * `item` is the parser's reason and says "you did not say its whole name",
   * which is a true sentence about a phrase matched loosely and a false one
   * about a row Claude picked out of a tool result. The reader has to check a
   * different thing in each case, so they are different reasons.
   */
  | 'assistant'
  /**
   * No place is called this. Confirming makes it.
   *
   * The opposite of `location`, and worth keeping apart from it. `location`
   * says a place was found by something looser than its name, so the thing to
   * check is whether the right shelf was picked out of the ones that exist.
   * This one says none was found at all, so the thing to check is the spelling
   * of a name that is about to become a row - nobody is choosing between
   * shelves, they are agreeing to a new one.
   */
  | 'newLocation'
  /**
   * No category is called this. Confirming makes it.
   *
   * Kept apart from `newLocation` because the two do not cost the same thing.
   * A place is somewhere in the house and holds whatever is put there. A
   * category is one of the headings the preparedness score is an unweighted
   * mean OVER - and where the user has picked no tracked set, that is every
   * category holding an item, so a new one joins the mean as soon as anything
   * is filed under it. The card names which of the two is being agreed to.
   */
  | 'newCategory'
  /**
   * A phone number that was heard rather than typed.
   *
   * The only slot in this application where a recognizer's mistake is
   * invisible: a wrong item name reads as the wrong item, and a wrong digit
   * reads as a number. So it is always shown back before it is stored.
   */
  | 'heardDigits';

/**
 * Where a write is sending something.
 *
 * `new` is not an error state. `findLocation` matches on contains and returns
 * nothing for a place that was never made, and until now that ended the
 * sentence. It carries the phrase as spoken, and the card says the place will
 * be made before anything is written.
 */
export type Destination =
  | { readonly kind: 'existing'; readonly id: string; readonly name: string }
  | { readonly kind: 'new'; readonly name: string };

/**
 * How much of a write was heard, and how much was filled in.
 *
 * `explicit` is the narrow case: an exact item and an amount the user actually
 * said. It is what lets the caller store the change at once and offer Undo,
 * instead of asking someone to confirm a sentence they just spoke clearly.
 * Everything else is `assumed` and belongs on the confirmation card.
 */
interface Certainty {
  /** 'explicit' when nothing was inferred; the caller may write it without asking. */
  readonly certainty: 'explicit' | 'assumed';
  /** Why it is assumed. Translation-key suffixes, empty when explicit. */
  readonly assumptions: readonly AssumptionReason[];
}

export type PendingWrite =
  | (Certainty & {
      readonly kind: 'ADJUST';
      readonly item: InventoryItemView;
      /** Signed. Negative for a removal, so `commit` needs no direction flag. */
      readonly delta: number;
      /** What the quantity becomes, clamped at zero as `adjustQuantity` clamps. */
      readonly after: number;
      readonly transaction: StockTransactionType;
    })
  | (Certainty & {
      readonly kind: 'CREATE';
      readonly name: string;
      readonly quantity: number;
      readonly unit: string;
      /** null where no shelf was named at all, which is not the same as one that has to be made. */
      readonly location: Destination | null;
      readonly expirationDate: string | null;
    })
  | (Certainty & {
      readonly kind: 'EXPIRY';
      readonly item: InventoryItemView;
      readonly before: string | null;
      readonly after: string;
    })
  | (Certainty & {
      readonly kind: 'MOVE';
      readonly item: InventoryItemView;
      /** Both halves are recorded, because the undo restores the old shelf. */
      readonly fromLocationId: string | null;
      readonly fromLocationName: string | null;
      readonly to: Destination;
    })
  /*
   * The two thresholds are separate variants rather than one with a field
   * naming the column. They are different numbers with different meanings -
   * a minimum is the line below which the replenishment list speaks up, and a
   * target is what the user is stocking towards - and a single variant would
   * make every reader of `commit` and of the card check a discriminator to
   * find out which. Separate variants let the compiler do it.
   */
  | (Certainty & {
      readonly kind: 'MINIMUM';
      readonly item: InventoryItemView;
      /** null where the item never had one, which is not the same as zero. */
      readonly before: number | null;
      readonly after: number;
    })
  | (Certainty & {
      readonly kind: 'TARGET';
      readonly item: InventoryItemView;
      readonly before: number | null;
      readonly after: number;
    });

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
 * How many movements a history answer reads back.
 *
 * "When did I last buy rice" is a question about the recent past, and a
 * sentence naming twenty purchases answers a question nobody asked. The row
 * order is newest first, so these are the newest few.
 */
const HISTORY_LIMIT = 5;

/**
 * One raw transaction row, as the answer needs it.
 *
 * `items.history` is typed `SqlRow`, so every field is widened here rather than
 * trusted. `occurred_at` is a full instant in the table and a calendar date in
 * every sentence anyone says about it.
 */
function historyEntry(row: SqlRow): HistoryEntry {
  return {
    type: String(row.type) as StockTransactionType,
    quantity: Number(row.quantity),
    on: toCalendarDate(String(row.occurred_at)) ?? String(row.occurred_at).slice(0, 10),
  };
}

/**
 * A resolution, flattened into "here is the item" or "here is the outcome".
 *
 * The caller can then `if (!found.ok) return found.outcome;` and carry on with
 * a plain `InventoryItemView`, which keeps the eleven branches below readable.
 */
type Found =
  | {
      readonly ok: true;
      readonly item: InventoryItemView;
      /** Whether the phrase WAS the name, rather than merely finding it. */
      readonly exact: boolean;
    }
  | { readonly ok: false; readonly outcome: Outcome };

async function one(deps: VoiceDeps, phrase: string, intent: Intent): Promise<Found> {
  const resolution = await resolveItem(deps.items, deps.context, deps.language, phrase);
  switch (resolution.kind) {
    case 'one':
      return { ok: true, item: resolution.item, exact: resolution.exact };
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

/**
 * A category phrase to a category.
 *
 * Deliberately not the item search. A category is a short, fixed list the user
 * can see on a screen, named per language in a side table, so the match is made
 * against the name in the user's own language with the same English fallback
 * `items.list` uses for display - a Portuguese interface whose category was
 * only ever named in English still answers.
 *
 * Whole name first, then prefix, then contains, which is the order `resolve.ts`
 * scores item names in. "alimento" finds Alimentos; "comida" finds nothing, and
 * that is right - it is not the name of anything here, and guessing at the
 * nearest category would list somebody the wrong shelf of their own pantry.
 */
async function findCategory(
  deps: VoiceDeps,
  phrase: string,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  const folded = foldText(phrase);
  if (folded === '') return undefined;

  const named = (await deps.categories.list()).map((category) => ({
    id: category.id,
    name: category.names[deps.language] ?? category.names.en ?? category.id,
  }));

  return (
    named.find((category) => foldText(category.name) === folded) ??
    named.find((category) => foldText(category.name).startsWith(folded)) ??
    named.find((category) => foldText(category.name).includes(folded))
  );
}

/** Everything filed under one category. */
async function itemsInCategory(
  deps: VoiceDeps,
  categoryId: string,
): Promise<{ readonly items: readonly InventoryItemView[]; readonly total: number }> {
  const page = await deps.items.list(deps.context, {
    filters: { categoryIds: [categoryId], archived: 'active' },
    sort: { field: 'name', direction: 'asc' },
    limit: LIST_LIMIT,
    lang: deps.language,
  });
  // `total` is the count before the page limit, so a category holding eighty
  // items says eighty rather than the fifty that were read.
  return { items: page.rows, total: page.total };
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
        // Dismissal is a decision the user made on the Replenishment screen,
        // and it has to mean the same thing here. Without this the spoken
        // answer and the screen disagreed about the same list.
        dismissedItemIds: deps.dismissedItemIds,
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

      /*
       * "o que tem em X" is two questions in one sentence, and only the
       * database can tell them apart.
       *
       * X can be a place ("na despensa") or a category ("em alimentos"), and
       * nothing in the words says which - the grammar cannot know what shelves
       * this household has, and inventing a rule per preposition would only
       * move the guess earlier. So the PLACE is tried first, and the category
       * answers when no place fits.
       *
       * A place wins because it is the more concrete of the two and the more
       * exclusive. Locations are things the user made and named themselves,
       * one per shelf or room; categories are twenty fixed labels that come
       * with the application and that most people never say out loud. Someone
       * who named a shelf "Alimentos" means their shelf, and would be baffled
       * to be read the category instead.
       *
       * Where neither matches, the phrase comes back as notFound rather than
       * as an empty list. "There is nothing in the cellar" and "you have no
       * cellar" are different sentences, and only one of them is true.
       */
      if (location === undefined) {
        const category = await findCategory(deps, phrase);
        if (category === undefined) return { kind: 'notFound', phrase, intent };

        const held = await itemsInCategory(deps, category.id);
        return {
          kind: 'answer',
          answer: { kind: 'CATEGORY', categoryName: category.name, ...held },
        };
      }

      return {
        kind: 'answer',
        answer: {
          kind: 'WHERE_LOCATION',
          locationName: location.name,
          items: await itemsIn(deps, location.id),
        },
      };
    }

    /*
     * The unambiguous half of the same question: "o que tem NA CATEGORIA
     * alimentos" names what it is asking about, so no fallback is wanted here.
     * A category phrase that matches nothing is a category that does not
     * exist, and saying so is more useful than reading out a shelf that
     * happens to share a word with it.
     */
    case 'QUERY_CATEGORY': {
      const category = await findCategory(deps, intent.category);
      if (category === undefined) {
        return { kind: 'notFound', phrase: intent.category, intent };
      }

      const held = await itemsInCategory(deps, category.id);
      return {
        kind: 'answer',
        answer: { kind: 'CATEGORY', categoryName: category.name, ...held },
      };
    }

    /*
     * A read, and structurally nothing else. There is no `PendingWrite` that
     * touches a contact and no branch of `commit` that could store one, so the
     * worst a misheard contact question can do is read out the wrong phone
     * number.
     *
     * An empty result is an answer rather than a notFound, for the same reason
     * the interface offers to create a missing ITEM and must not offer to
     * create a missing person: the Create button under notFound belongs to the
     * inventory, and a question about the address book has no business
     * reaching it.
     */
    case 'QUERY_CONTACT': {
      const found = await deps.contacts.search(intent.query);
      return {
        kind: 'answer',
        answer: { kind: 'CONTACT', query: intent.query, contacts: found },
      };
    }

    case 'QUERY_HISTORY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      const rows = await deps.items.history(found.item.id, HISTORY_LIMIT);
      return {
        kind: 'answer',
        answer: { kind: 'HISTORY', item: found.item, entries: rows.map(historyEntry) },
      };
    }

    // The same figures the dashboard shows, read from the same call, so the
    // spoken count and the screen's count cannot drift apart.
    case 'QUERY_TOTAL':
      return {
        kind: 'answer',
        answer: { kind: 'TOTAL', stats: await deps.items.dashboardStats(deps.context) },
      };

    // The same call the dashboard makes, with the same inputs, so the spoken
    // number is the number on the screen. A flat percentage of healthy items
    // would be easier and would be a different figure: it lets forty tins of
    // food hide an empty water category, which is precisely what the equal
    // weighting of categories exists to refuse.
    case 'QUERY_SCORE': {
      const report = evaluatePreparedness({
        items: await deps.items.listForAnalysis(),
        today: deps.context.today,
        defaultThreshold: deps.context.defaultThreshold,
        trackedCategoryIds: deps.trackedCategoryIds,
        expiryWindows: deps.context.expiryWindows,
      });
      // Already a whole percent, 0-100, and already zero for an empty inventory.
      return { kind: 'answer', answer: { kind: 'SCORE', score: report.score } };
    }

    case 'ADJUST_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      const delta = intent.direction === 'up' ? intent.amount : -intent.amount;
      return pendingAdjust(
        found.item,
        delta,
        intent.transaction,
        guesses(found.exact, intent.amountAssumed, intent.unit, found.item.unit),
      );
    }

    // The amount is always spoken here - the rule that builds this intent
    // refuses a phrase without a number - so only the item and the unit can be
    // guesses.
    case 'SET_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return pendingAdjust(
        found.item,
        intent.amount - found.item.quantity,
        'correction',
        guesses(found.exact, false, intent.unit, found.item.unit),
      );
    }

    case 'SET_EXPIRY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      const assumptions: AssumptionReason[] = [];
      if (!found.exact) assumptions.push('item');
      if (intent.dateAssumed) assumptions.push('date');
      return {
        kind: 'pending',
        write: {
          kind: 'EXPIRY',
          item: found.item,
          before: found.item.expirationDate,
          after: intent.expiresOn,
          ...certaintyOf(assumptions),
        },
      };
    }

    /*
     * A destination that does not exist is proposed, not refused.
     *
     * This used to come back as notFound, on the argument that a MOVE which
     * ignored an unknown shelf would take an item off the shelf it really is
     * on and put it nowhere - destroying the one fact the user was trying to
     * change. That argument is still exactly right, and it is an argument
     * against DROPPING the place, not against making it. Nothing here is
     * dropped: the phrase is carried as spoken, `commit` makes the place
     * before it moves anything, and the item lands somewhere that has a name.
     *
     * What the old refusal cost was the sentence. "Move the rice to the
     * cellar" against a pantry with no cellar told the user their own words
     * named nothing, and left them to make the cellar on another screen and
     * say the whole thing again. The confirmation card can ask the one
     * question that was actually open - shall I make it? - and nothing is
     * written until it is answered, which is the guarantee the refusal was
     * really protecting.
     */
    case 'MOVE_ITEM': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;

      const destination = await findLocation(deps, intent.location);
      const assumptions: AssumptionReason[] = [];
      if (!found.exact) assumptions.push('item');

      /*
       * Nothing matched, so there is nothing that could have matched loosely
       * and `location` would be a false reason to give. `newLocation` is the
       * true one, and it asks the reader to check a different thing: not which
       * of their shelves was picked, but the spelling of a name that is about
       * to become a row of its own.
       */
      if (destination === undefined) {
        return {
          kind: 'pending',
          write: {
            kind: 'MOVE',
            item: found.item,
            fromLocationId: found.item.locationId,
            fromLocationName: found.item.locationName,
            to: { kind: 'new', name: intent.location },
            ...certaintyOf([...assumptions, 'newLocation']),
          },
        };
      }

      // Already there. Nothing to write, and `items.transfer` would still
      // record a transfer row saying the item moved from a shelf to itself.
      if (found.item.locationId === destination.id) {
        return { kind: 'answer', answer: { kind: 'WHERE_ITEM', item: found.item } };
      }

      /*
       * Explicit needs BOTH halves heard exactly. The item is checked by
       * `resolve`; the place is checked here, because `findLocation` matches on
       * contains and "porao" happily finds "Porão dos fundos".
       */
      if (foldText(destination.name) !== foldText(intent.location)) assumptions.push('location');

      return {
        kind: 'pending',
        write: {
          kind: 'MOVE',
          item: found.item,
          fromLocationId: found.item.locationId,
          fromLocationName: found.item.locationName,
          to: { kind: 'existing', id: destination.id, name: destination.name },
          ...certaintyOf(assumptions),
        },
      };
    }

    /*
     * The two thresholds, and the one thing that makes them different from
     * every other write here: the number is always spoken.
     *
     * The rules that build them refuse a phrase without one, because a minimum
     * nobody stated has no sensible default - not one, not the current
     * quantity, not zero. So the only thing left to guess at is which item was
     * meant, and an exact name makes the write explicit.
     *
     * The spoken UNIT is deliberately not treated as a guess, where an
     * adjustment treats it as one - and the same is true here, for a worse
     * reason.
     *
     * It is true that a threshold replaces a field rather than adding into one,
     * so the arithmetic cannot drift. But "o minimo de arroz e 5 latas" against
     * rice kept in kilos stores the number 5 and reads it as five KILOS, for
     * ever, against a count the user never sees it beside. A wrong adjustment
     * shows up the next time anybody looks at the quantity. A wrong minimum
     * shows up as a replenishment list that is quietly wrong about what is
     * running out - which is the one list this application exists to get right.
     *
     * So a unit the row does not use is an assumption here too, and the card
     * says which unit it stored.
     */
    case 'SET_MINIMUM': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      if (found.item.minimumQuantity === intent.amount) {
        return { kind: 'answer', answer: { kind: 'QUANTITY', item: found.item } };
      }
      return {
        kind: 'pending',
        write: {
          kind: 'MINIMUM',
          item: found.item,
          before: found.item.minimumQuantity,
          after: intent.amount,
          ...certaintyOf(thresholdAssumptions(found.exact, intent.unit, found.item.unit)),
        },
      };
    }

    case 'SET_TARGET': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      if (found.item.idealQuantity === intent.amount) {
        return { kind: 'answer', answer: { kind: 'QUANTITY', item: found.item } };
      }
      return {
        kind: 'pending',
        write: {
          kind: 'TARGET',
          item: found.item,
          before: found.item.idealQuantity,
          after: intent.amount,
          ...certaintyOf(thresholdAssumptions(found.exact, intent.unit, found.item.unit)),
        },
      };
    }

    case 'CREATE_ITEM': {
      const assumptions: AssumptionReason[] = ['newItem'];
      let location: Destination | null = null;

      /*
       * The shelf is proposed too, rather than ending the sentence.
       *
       * This refused as well, and its reasoning was sound as far as it went: a
       * creation that quietly ignored the shelf would leave a new item
       * unplaced, and the user would have to notice the ABSENCE of something
       * to find out. That is still avoided - the place is not dropped, it is
       * offered. What the refusal threw away with it was the rest of the
       * sentence. "Add two kilos of quinoa in the cellar" told the user about
       * the cellar and forgot the quinoa, so a phrase naming two new things
       * produced neither.
       *
       * null and a `new` destination are kept apart on the write, because they
       * are different sentences. null is "no shelf was mentioned at all", and a
       * card offering to make a place nobody named would be inventing one.
       */
      if (intent.location !== null) {
        const found = await findLocation(deps, intent.location);
        if (found === undefined) {
          location = { kind: 'new', name: intent.location };
          assumptions.push('newLocation');
        } else {
          location = { kind: 'existing', id: found.id, name: found.name };
        }
      }

      // A creation is never a nudge. It puts a row in the inventory that was
      // not there before, under a name taken from a transcript, and there is
      // nothing to compare that name against - so it is always confirmed.
      return {
        kind: 'pending',
        write: {
          kind: 'CREATE',
          name: intent.name,
          quantity: intent.amount ?? 1,
          unit: intent.unit ?? 'un',
          location,
          expirationDate: intent.expiresOn,
          ...certaintyOf(assumptions),
        },
      };
    }

    /*
     * Recognized by the English grammar already, executed by nobody yet.
     *
     * Every other branch of this switch answers a question, proposes a write,
     * or reports that nothing was found - and every one of those would be a
     * lie told about a capability that does not exist. There is no
     * `PendingWrite` for a bare place, and inventing one here would let a
     * confirmation card offer to store something `commit` has no case for.
     * Throwing is caught by `useVoice`'s `turn`, which is what keeps this
     * from crashing the sheet - it surfaces as the ordinary error text
     * instead of a silent wrong answer. Task 5 replaces this case with the
     * real one.
     */
    case 'CREATE_LOCATION':
      throw new Error('CREATE_LOCATION is not yet executed');

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
  assumptions: readonly AssumptionReason[],
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
      ...certaintyOf(assumptions),
    },
  };
}

/** A list of guesses, turned into the pair every `PendingWrite` carries. */
function certaintyOf(assumptions: readonly AssumptionReason[]): Certainty {
  return {
    certainty: assumptions.length === 0 ? 'explicit' : 'assumed',
    assumptions,
  };
}

/**
 * Everything a quantity change had to guess at.
 *
 * The order is fixed rather than incidental, so a card lists the same reasons
 * in the same order every time.
 */
function guesses(
  exact: boolean,
  amountAssumed: boolean,
  spokenUnit: string | null,
  storedUnit: string,
): readonly AssumptionReason[] {
  const assumptions: AssumptionReason[] = [];
  if (amountAssumed) assumptions.push('quantity');
  if (!exact) assumptions.push('item');
  if (unitDiffers(spokenUnit, storedUnit)) assumptions.push('unit');
  return assumptions;
}

/**
 * Whether the unit the speaker counted in is not the unit the row is kept in.
 *
 * "comprei duas latas de arroz" against rice stored in kilos adds two KILOS,
 * because the quantity is one number and the unit is a label on it. The number
 * is not wrong so much as unanswerable, which is exactly what the confirmation
 * card is for - so this counts as a guess even though the rule above says an
 * explicit write needs only an exact item and a spoken amount.
 *
 * The comparison is deliberately crude: folded, and with one trailing "s"
 * taken off each side so "latas" still matches a row kept in "lata". Anything
 * it cannot settle - "quilos" against "kg" - it reports as a difference, which
 * asks rather than assumes.
 */
/**
 * Why a threshold is not exactly what the user said.
 *
 * A unit the row does not keep matters here as much as it does on an
 * adjustment: the number is stored bare and read for ever afterwards in the
 * row's own unit, against a count nobody sees it next to.
 */
function thresholdAssumptions(
  exact: boolean,
  spokenUnit: string | null,
  storedUnit: string,
): AssumptionReason[] {
  const assumptions: AssumptionReason[] = [];
  if (!exact) assumptions.push('item');
  if (unitDiffers(spokenUnit, storedUnit)) assumptions.push('unit');
  return assumptions;
}

function unitDiffers(spoken: string | null, stored: string): boolean {
  if (spoken === null) return false;
  const singular = (unit: string): string => foldText(unit).replace(/s$/, '');
  return singular(spoken) !== singular(stored);
}
