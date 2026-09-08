/**
 * The functions Claude is allowed to call, and what they do here.
 *
 * THIS MODULE NEVER WRITES, and the split is the whole safety design.
 *
 * Reading tools run at once against the repositories on the device: the model
 * asks about rice, the rice row travels back, and nothing else does. Writing
 * tools do not write. Each builds a `PendingWrite` - the same type the voice
 * parser produces - hands it back to the loop, and tells Claude only that the
 * change was PROPOSED. The turn ends with a confirmation card per proposal, in
 * the interface `services/voice/commit.ts` already serves.
 *
 * The reason is stated plainly in the design: a grammar fails by not
 * understanding, a model fails by understanding something else. The card is
 * the entire mitigation, so nothing here may bypass it - not for a change that
 * looks obvious, not for one the model is confident about. `tools.writes.test`
 * spies on `exec` AND `transaction` to keep that structural rather than
 * promised.
 *
 * Deleting, archiving and emptying a category are not offered at all. Undo is
 * how a wrong creation is reversed; removing real stock is a decision for the
 * inventory screen, where the person can see what they are removing.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AssumptionReason, PendingWrite, VoiceDeps } from '../voice/execute';
import { resolveItem } from '../voice/resolve';
import { buildReplenishmentList } from '../../domain/replenishment';
import { evaluatePreparedness } from '../../domain/preparedness';
import { foldText } from '../../domain/normalize';
import type { CategoriesRepository } from '../../repositories/categories.repository';
import type { ExpiryBucket } from '../../domain/expiry';
import type { StockStatus } from '../../domain/stock';
import type { InventoryItemView, LocationNode, StockTransactionType } from '../../types/domain';

/**
 * Everything a tool needs, which is everything voice control needs plus the
 * categories - the parser never had to name one, and a typed question does.
 */
export interface AiDeps extends VoiceDeps {
  readonly categories: CategoriesRepository;
}

/**
 * One tool call, executed.
 *
 * `result` is the JSON that goes back to Claude and nothing more; `proposal`
 * is the write that was described and not performed, which the loop collects
 * for the confirmation cards. A tool that fails sets `isError` so the failure
 * is returned as a `tool_result` rather than dropped - a dropped result stalls
 * the conversation with no explanation.
 */
export interface ToolRun {
  readonly result: string;
  readonly proposal: PendingWrite | null;
  readonly isError: boolean;
}

/** Rows any one tool may return. Well past what anyone wants read back. */
const LIST_LIMIT = 50;

/** The window used when a question about expiry carried no number. */
const FALLBACK_WINDOW_DAYS = 30;

const STOCK_STATUSES = ['critical', 'low', 'adequate', 'surplus'] as const;
const EXPIRY_BUCKETS = ['expired', 'today', 'soon', 'valid', 'none'] as const;
const TRANSACTIONS = ['add', 'remove', 'consume', 'purchase', 'correction'] as const;

// ---------------------------------------------------------------------------
// The definitions Claude reads
// ---------------------------------------------------------------------------

/*
 * Claude chooses a tool from its description and nothing else, so each one
 * says what it is for AND when to reach for it. The four writing descriptions
 * lead with the fact that they do not write, because a model that believes it
 * has changed the stock will report back that it did, and the user will read a
 * confirmation card for a change they were told already happened.
 */
export const TOOLS: readonly Anthropic.Tool[] = [
  {
    name: 'find_item',
    description:
      'Find one item in the stock by name. The name may be partial, misspelled or ' +
      'unaccented - it is matched the way a person says it. Use this whenever the user ' +
      'asks about a single thing, and before any tool that needs an exact item. Returns ' +
      'the one match, or the items that tied and need telling apart, or nothing found.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The item as the user said it.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_items',
    description:
      'List items, narrowed by any combination of category, location, stock level and ' +
      'expiry. Use it for a question about a group - what is in the pantry, what is ' +
      'running low, what is in the water category - rather than to find one thing. ' +
      `Returns at most ${String(LIST_LIMIT)} rows and says how many matched in total.`,
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Free text matched against names and notes.' },
        category: { type: 'string', description: 'A category name from list_categories.' },
        location: { type: 'string', description: 'A place from list_locations. Includes what is inside it.' },
        stock_status: { type: 'string', enum: [...STOCK_STATUSES] },
        expiry: { type: 'string', enum: [...EXPIRY_BUCKETS] },
      },
      required: [],
    },
  },
  {
    name: 'whats_expiring',
    description:
      'Items running out of date, soonest first. Use it for anything about dates: what ' +
      'goes off this month, what has already spoiled, what to eat first.',
    input_schema: {
      type: 'object',
      properties: {
        within_days: {
          type: 'integer',
          description: `How far ahead to look. Defaults to the user's own warning window, or ${String(FALLBACK_WINDOW_DAYS)} days.`,
        },
        expired_only: {
          type: 'boolean',
          description: 'True to return only what is already past its date.',
        },
      },
      required: [],
    },
  },
  {
    name: 'whats_missing',
    description:
      'The replenishment list: every item below its minimum or already spoiled, with how ' +
      'much to acquire and why. Use it for "what should I buy". Expired stock counts as ' +
      'no stock, so it asks for the whole target rather than the shortfall.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'preparedness_score',
    description:
      'The household preparedness score out of 100 - the same number, from the same ' +
      'calculation, that the dashboard shows - plus the weakest categories and what is ' +
      'short in them. Use it for "how prepared am I" and to explain the figure.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_locations',
    description:
      'Every place stock can be kept, with how many items each holds. Use it to learn ' +
      'the names of places, and to check one exists before proposing to put something there.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_categories',
    description:
      "Every category, named in the user's language. Use it to turn a category the user " +
      'named into one list_items will accept.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ---- The four that only propose ----------------------------------------
  {
    name: 'adjust_quantity',
    description:
      'PROPOSE adding to or taking from an item, by an amount. THIS DOES NOT CHANGE ' +
      'ANYTHING. It puts a proposal in front of the user, who confirms or discards it ' +
      'after you have finished answering, so tell them you have proposed it - never that ' +
      'it is done. Give a positive amount and a direction. Use it when the user says how ' +
      'much was added or used, not what the total now is.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        amount: { type: 'number', description: 'A positive amount. Never a number the user did not give.' },
        direction: { type: 'string', enum: ['up', 'down'] },
        transaction: {
          type: 'string',
          enum: [...TRANSACTIONS],
          description: 'Why it moved. Defaults to purchase going up, consume going down.',
        },
        unit: { type: 'string', description: 'The unit the user counted in, if they named one.' },
      },
      required: ['item', 'amount', 'direction'],
    },
  },
  {
    name: 'set_quantity',
    description:
      'PROPOSE correcting an item to an exact quantity. THIS DOES NOT CHANGE ANYTHING - ' +
      'it only proposes, exactly as adjust_quantity does. Use it when the user states ' +
      'what the count IS ("there are four left"), not how much it moved by.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        quantity: { type: 'number', description: 'The count the user stated. Never one they did not.' },
        unit: { type: 'string', description: 'The unit the user counted in, if they named one.' },
      },
      required: ['item', 'quantity'],
    },
  },
  {
    name: 'create_item',
    description:
      'PROPOSE adding something the stock does not hold yet. THIS DOES NOT CREATE ' +
      'ANYTHING until the user confirms. Check with find_item first - proposing a ' +
      'duplicate of something already there is the common mistake. A named location must ' +
      'be one list_locations returned.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        quantity: { type: 'number', description: 'Defaults to 1 when the user gave none.' },
        unit: { type: 'string', description: "Defaults to 'un'." },
        location: { type: 'string', description: 'A place from list_locations.' },
        expires_on: { type: 'string', description: 'A calendar date, YYYY-MM-DD.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'set_expiry',
    description:
      "PROPOSE setting an item's expiry date. THIS DOES NOT CHANGE ANYTHING - it only " +
      'proposes. The date must be an exact calendar date; if the user was vague, ask them ' +
      'rather than choosing one for them.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        expires_on: { type: 'string', description: 'A calendar date, YYYY-MM-DD.' },
      },
      required: ['item', 'expires_on'],
    },
  },
];

// ---------------------------------------------------------------------------
// Certainty
// ---------------------------------------------------------------------------

/**
 * Why nothing a model proposes is ever `explicit`.
 *
 * `execute.ts` reserves `explicit` for the narrow case where the user's own
 * words named an exact item and an exact amount, and lets the caller store
 * such a write without asking. A sentence that has been through a model has no
 * such case: the model chose the row, chose the reading, and may have chosen
 * well - but the user did not say it, the model did. So every proposal is
 * `assumed`, and every proposal carries at least one reason, because a card
 * headed "what I filled in" with nothing under it tells the reader nothing.
 *
 * THE BASE REASON IS `assistant`, ON EVERY PROPOSAL AND WITHOUT EXCEPTION, and
 * it used to be `item`. That was wrong in the one place the card is read:
 * `item` renders as "you did not say its whole name", which describes a phrase
 * the parser matched loosely and describes nothing at all about a row a model
 * picked out of a tool result. The reader was being told to check the wrong
 * thing, in a sentence about something they had not done. `assistant` says who
 * chose, which is the fact, and the rest - `newItem`, `quantity`, `unit`,
 * `date` - is added on top wherever it is true as well.
 */
function assumed(reasons: readonly AssumptionReason[]): {
  certainty: 'assumed';
  assumptions: readonly AssumptionReason[];
} {
  return { certainty: 'assumed', assumptions: ['assistant', ...reasons] };
}

/**
 * Whether the unit the model named is not the unit the row is kept in.
 *
 * The same crude comparison `execute.ts` makes, for the same reason: a
 * quantity is one number with a label on it, and "two cans" against rice kept
 * in kilos adds two KILOS. Anything it cannot settle it reports as a
 * difference, which asks rather than assumes.
 */
function unitDiffers(named: string | undefined, stored: string): boolean {
  if (named === undefined || named === '') return false;
  const singular = (unit: string): string => foldText(unit).replace(/s$/, '');
  return singular(named) !== singular(stored);
}

// ---------------------------------------------------------------------------
// What travels back
// ---------------------------------------------------------------------------

/**
 * An item as Claude sees it.
 *
 * Ids are left out on purpose. Nothing the model can call takes one - every
 * tool addresses an item by name - so an id would be thirty-six characters of
 * inventory leaving the device to be read by nobody. The fields kept are the
 * ones an answer is made of.
 */
function itemJson(item: InventoryItemView): Record<string, unknown> {
  return {
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    minimum: item.effectiveMinimum,
    stock: item.stockStatus,
    category: item.categoryName,
    location: item.locationName,
    expires_on: item.expirationDate,
    days_until_expiry: item.daysUntilExpiry,
  };
}

/** A capped list, honest about the cap. */
function listJson(
  rows: readonly InventoryItemView[],
  total: number,
): Record<string, unknown> {
  return {
    matched: total,
    showing: rows.length,
    ...(total > rows.length
      ? { note: `Only the first ${String(rows.length)} of ${String(total)} are listed. Narrow the filters to see the rest.` }
      : {}),
    items: rows.map(itemJson),
  };
}

const ok = (body: unknown): ToolRun => ({
  result: JSON.stringify(body),
  proposal: null,
  isError: false,
});

const proposed = (write: PendingWrite, body: unknown): ToolRun => ({
  result: JSON.stringify(body),
  proposal: write,
  isError: false,
});

const failed = (message: string): ToolRun => ({
  result: JSON.stringify({ error: message }),
  proposal: null,
  isError: true,
});

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const itemNameInput = z.object({ name: z.string().min(1) });

const listItemsInput = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  stock_status: z.enum(STOCK_STATUSES).optional(),
  expiry: z.enum(EXPIRY_BUCKETS).optional(),
});

const expiringInput = z.object({
  within_days: z.number().int().min(0).max(3650).optional(),
  expired_only: z.boolean().optional(),
});

const adjustInput = z.object({
  item: z.string().min(1),
  amount: z.number().positive(),
  direction: z.enum(['up', 'down']),
  transaction: z.enum(TRANSACTIONS).optional(),
  unit: z.string().optional(),
});

const setQuantityInput = z.object({
  item: z.string().min(1),
  quantity: z.number().min(0),
  unit: z.string().optional(),
});

const createItemInput = z.object({
  name: z.string().min(1),
  quantity: z.number().min(0).optional(),
  unit: z.string().optional(),
  location: z.string().optional(),
  expires_on: z.string().optional(),
});

const setExpiryInput = z.object({
  item: z.string().min(1),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date, YYYY-MM-DD.'),
});

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

/**
 * An item phrase to an item, or the sentence Claude gets instead.
 *
 * The same resolver voice control uses, so "feijao" finds the same row from a
 * typed question as from a spoken one. A tie is handed back rather than
 * guessed at, which lets Claude ask - the one thing it is better at than the
 * parser was.
 */
type Located =
  | { readonly ok: true; readonly item: InventoryItemView; readonly exact: boolean }
  | { readonly ok: false; readonly run: ToolRun };

async function locate(deps: AiDeps, phrase: string): Promise<Located> {
  const resolution = await resolveItem(deps.items, deps.context, deps.language, phrase);
  switch (resolution.kind) {
    case 'one':
      return { ok: true, item: resolution.item, exact: resolution.exact };
    case 'many':
      return {
        ok: false,
        run: ok({
          found: 'many',
          matched: resolution.total,
          note: 'Several items fit that name. Ask the user which one before proposing anything.',
          items: resolution.items.map(itemJson),
        }),
      };
    case 'none':
      return { ok: false, run: ok({ found: 'none', searched_for: resolution.phrase }) };
  }
}

/**
 * A location phrase to a location.
 *
 * Matches on CONTAINS as well as equality, because a person writes "pantry"
 * for a place recorded as "Main Pantry". Same rule as `execute.ts`.
 */
async function findLocation(
  deps: AiDeps,
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

/** A category name in the user's language, falling back to English. */
function categoryName(names: Readonly<Record<string, string>>, language: string, id: string): string {
  return names[language] ?? names.en ?? id;
}

async function findCategory(deps: AiDeps, phrase: string): Promise<string | undefined> {
  const folded = foldText(phrase);
  if (folded === '') return undefined;

  const all = await deps.categories.list();
  const match = all.find((category) =>
    Object.values(category.names).some((name) => foldText(name) === folded),
  );
  return match?.id;
}

// ---------------------------------------------------------------------------
// The reading tools
// ---------------------------------------------------------------------------

async function findItem(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = itemNameInput.safeParse(input);
  if (!parsed.success) return failed('find_item needs a name.');

  const found = await locate(deps, parsed.data.name);
  if (!found.ok) return found.run;
  return ok({ found: 'one', exact_name: found.exact, item: itemJson(found.item) });
}

async function listItems(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = listItemsInput.safeParse(input);
  if (!parsed.success) return failed('list_items received a filter it does not have.');
  const filters = parsed.data;

  let categoryIds: readonly string[] | undefined;
  if (filters.category !== undefined) {
    const id = await findCategory(deps, filters.category);
    if (id === undefined) {
      return ok({ matched: 0, showing: 0, note: `No category is called "${filters.category}". Call list_categories.`, items: [] });
    }
    categoryIds = [id];
  }

  let locationIds: readonly string[] | undefined;
  if (filters.location !== undefined) {
    const location = await findLocation(deps, filters.location);
    if (location === undefined) {
      return ok({ matched: 0, showing: 0, note: `No place is called "${filters.location}". Call list_locations.`, items: [] });
    }
    locationIds = [location.id];
  }

  const page = await deps.items.list(deps.context, {
    filters: {
      archived: 'active',
      search: filters.search,
      categoryIds,
      locationIds,
      includeSublocations: locationIds === undefined ? undefined : true,
      stockStatuses: filters.stock_status === undefined ? undefined : [filters.stock_status as StockStatus],
      expiryBuckets: filters.expiry === undefined ? undefined : [filters.expiry as ExpiryBucket],
    },
    limit: LIST_LIMIT,
    lang: deps.language,
  });

  return ok(listJson(page.rows, page.total));
}

/*
 * The same two steps `execute.ts` takes, in the same order, so a typed
 * question and a spoken one report the same items. The buckets are cut by the
 * user's widest warning window, which is usually wider than the window asked
 * for; `daysUntilExpiry` is negative for anything already past, so expired
 * stock survives the filter however narrow the window.
 */
async function whatsExpiring(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = expiringInput.safeParse(input);
  if (!parsed.success) return failed('whats_expiring takes within_days and expired_only.');

  const expiredOnly = parsed.data.expired_only ?? false;
  const withinDays =
    parsed.data.within_days ?? deps.context.expiryWindows[0] ?? FALLBACK_WINDOW_DAYS;

  const page = await deps.items.list(deps.context, {
    filters: {
      expiryBuckets: expiredOnly ? ['expired'] : ['expired', 'today', 'soon'],
      archived: 'active',
    },
    sort: { field: 'expiration', direction: 'asc' },
    limit: LIST_LIMIT,
    lang: deps.language,
  });
  const items = page.rows.filter(
    (item) => item.daysUntilExpiry !== null && item.daysUntilExpiry <= withinDays,
  );

  return ok({
    today: deps.context.today,
    within_days: withinDays,
    expired_only: expiredOnly,
    showing: items.length,
    items: items.map(itemJson),
  });
}

async function whatsMissing(deps: AiDeps): Promise<ToolRun> {
  const lines = buildReplenishmentList({
    items: await deps.items.listForAnalysis(),
    today: deps.context.today,
    defaultThreshold: deps.context.defaultThreshold,
    expiryWindows: deps.context.expiryWindows,
    // The user's dismissals, honoured here as the Replenishment screen honours
    // them. Without this Claude would tell someone to buy the thing they had
    // just taken off the list, and be able to cite the application for it.
    dismissedItemIds: deps.dismissedItemIds,
  });

  const shown = lines.slice(0, LIST_LIMIT);
  return ok({
    matched: lines.length,
    showing: shown.length,
    items: shown.map((line) => ({
      name: line.name,
      unit: line.unit,
      reason: line.reason,
      stock: line.status,
      current: line.current,
      minimum: line.minimum,
      target: line.target,
      to_acquire: line.needed,
      expires_on: line.expirationDate,
    })),
  });
}

/*
 * The same call `DashboardScreen` makes, with the same inputs, so the number
 * in an answer is the number on the screen. A flat percentage of healthy items
 * would be easier to compute and would be a different figure - it lets forty
 * tins of food hide an empty water category, which is exactly what the equal
 * weighting of categories exists to refuse.
 */
async function preparednessScore(deps: AiDeps): Promise<ToolRun> {
  const report = evaluatePreparedness({
    items: await deps.items.listForAnalysis(),
    today: deps.context.today,
    defaultThreshold: deps.context.defaultThreshold,
    trackedCategoryIds: deps.trackedCategoryIds,
    expiryWindows: deps.context.expiryWindows,
  });

  const categories = await deps.categories.list(true);
  const nameOf = new Map(
    categories.map((category) => [category.id, categoryName(category.names, deps.language, category.id)]),
  );

  return ok({
    score: report.score,
    out_of: 100,
    method: report.method.formula,
    counted: report.totals,
    weakest_categories: report.categories.slice(0, 5).map((category) => ({
      category: nameOf.get(category.categoryId) ?? category.categoryId,
      score: Math.round(category.score * 100),
      items: category.itemCount,
      below_minimum: category.belowMinimum,
      expired: category.expired,
    })),
    shortfalls: report.deficits.slice(0, LIST_LIMIT).map((deficit) => ({
      reason: deficit.reason,
      name: deficit.name,
      category: deficit.categoryId === null ? null : (nameOf.get(deficit.categoryId) ?? null),
      quantity: deficit.quantity,
      minimum: deficit.minimum,
      needed: deficit.needed,
    })),
  });
}

async function listLocations(deps: AiDeps): Promise<ToolRun> {
  const tree = await deps.locations.tree();
  const flat: { place: string; items: number }[] = [];

  const walk = (nodes: readonly LocationNode[]): void => {
    for (const node of nodes) {
      flat.push({ place: node.path.join(' / '), items: node.itemCount });
      walk(node.children);
    }
  };
  walk(tree);

  return ok({ count: flat.length, locations: flat });
}

async function listCategories(deps: AiDeps): Promise<ToolRun> {
  const categories = await deps.categories.list();
  const counts = await deps.categories.itemCounts();

  return ok({
    count: categories.length,
    categories: categories.map((category) => ({
      name: categoryName(category.names, deps.language, category.id),
      items: counts.get(category.id) ?? 0,
      counts_toward_score:
        deps.trackedCategoryIds.length === 0 || deps.trackedCategoryIds.includes(category.id),
    })),
  });
}

// ---------------------------------------------------------------------------
// The writing tools, which do not write
// ---------------------------------------------------------------------------

/** What every proposal says back. It never says the change was made. */
function proposalNote(detail: string): Record<string, unknown> {
  return {
    status: 'proposed',
    awaiting: "the user's confirmation",
    proposed: detail,
    note: 'Nothing has changed. The user will see a confirmation card for this after your answer. Tell them what you proposed, not that it is done.',
  };
}

async function adjustQuantity(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = adjustInput.safeParse(input);
  if (!parsed.success) return failed('adjust_quantity needs an item, a positive amount and a direction.');
  const { item: phrase, amount, direction, transaction, unit } = parsed.data;

  const found = await locate(deps, phrase);
  if (!found.ok) return found.run;

  const delta = direction === 'up' ? amount : -amount;
  const after = Math.max(0, found.item.quantity + delta);

  // A delta of zero is not a change - `adjustQuantity` returns early on one,
  // writing neither the quantity nor a history row - so there is nothing to
  // confirm and the true answer is the quantity itself.
  if (delta === 0) {
    return ok({ status: 'no change', item: itemJson(found.item) });
  }

  // `assistant` is added by `assumed`; only what is true on top of it goes here.
  const reasons: AssumptionReason[] = [];
  if (unitDiffers(unit, found.item.unit)) reasons.push('unit');

  const write: PendingWrite = {
    kind: 'ADJUST',
    item: found.item,
    delta,
    after,
    transaction: (transaction ?? (delta > 0 ? 'purchase' : 'consume')) as StockTransactionType,
    ...assumed(reasons),
  };

  return proposed(
    write,
    proposalNote(
      `${found.item.name}: ${String(found.item.quantity)} ${found.item.unit} would become ${String(after)} ${found.item.unit}`,
    ),
  );
}

async function setQuantity(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = setQuantityInput.safeParse(input);
  if (!parsed.success) return failed('set_quantity needs an item and a quantity.');
  const { item: phrase, quantity, unit } = parsed.data;

  const found = await locate(deps, phrase);
  if (!found.ok) return found.run;

  const delta = quantity - found.item.quantity;
  if (delta === 0) {
    return ok({ status: 'no change', item: itemJson(found.item) });
  }

  // `assistant` is added by `assumed`; only what is true on top of it goes here.
  const reasons: AssumptionReason[] = [];
  if (unitDiffers(unit, found.item.unit)) reasons.push('unit');

  const write: PendingWrite = {
    kind: 'ADJUST',
    item: found.item,
    delta,
    after: Math.max(0, quantity),
    transaction: 'correction',
    ...assumed(reasons),
  };

  return proposed(
    write,
    proposalNote(
      `${found.item.name}: ${String(found.item.quantity)} ${found.item.unit} would become ${String(quantity)} ${found.item.unit}`,
    ),
  );
}

async function createItem(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = createItemInput.safeParse(input);
  if (!parsed.success) return failed('create_item needs at least a name.');
  const fields = parsed.data;

  let locationId: string | null = null;
  let locationName: string | null = null;

  if (fields.location !== undefined && fields.location !== '') {
    const location = await findLocation(deps, fields.location);
    // Refused rather than created unplaced, as the parser refuses: someone who
    // named a shelf and got an item with no location would have to notice an
    // absence, where being told the shelf is unknown is visible and fixable.
    if (location === undefined) {
      return ok({
        status: 'not proposed',
        reason: `No place is called "${fields.location}". Call list_locations and ask the user which one.`,
      });
    }
    locationId = location.id;
    locationName = location.name;
  }

  const reasons: AssumptionReason[] = ['newItem'];
  if (fields.quantity === undefined) reasons.push('quantity');

  const write: PendingWrite = {
    kind: 'CREATE',
    name: fields.name,
    quantity: fields.quantity ?? 1,
    unit: fields.unit ?? 'un',
    locationId,
    locationName,
    expirationDate: fields.expires_on ?? null,
    ...assumed(reasons),
  };

  return proposed(
    write,
    proposalNote(
      `create ${fields.name}, ${String(write.quantity)} ${write.unit}${locationName === null ? '' : ` in ${locationName}`}`,
    ),
  );
}

async function setExpiry(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = setExpiryInput.safeParse(input);
  if (!parsed.success) return failed('set_expiry needs an item and an exact date, YYYY-MM-DD.');
  const { item: phrase, expires_on: expiresOn } = parsed.data;

  const found = await locate(deps, phrase);
  if (!found.ok) return found.run;

  // `date` as well as `assistant`: a model reading a date out of a sentence has
  // derived it, and the card exists to show the reader exactly that part.
  const write: PendingWrite = {
    kind: 'EXPIRY',
    item: found.item,
    before: found.item.expirationDate,
    after: expiresOn,
    ...assumed(['date']),
  };

  return proposed(write, proposalNote(`${found.item.name} would expire on ${expiresOn}`));
}

// ---------------------------------------------------------------------------

/**
 * Runs one tool call.
 *
 * Never throws. A repository that fails, or a tool name that does not exist,
 * comes back as an errored `tool_result` so the conversation can carry on and
 * say what went wrong - a dropped result leaves Claude waiting for an answer
 * that is never coming.
 */
export async function runTool(deps: AiDeps, name: string, input: unknown): Promise<ToolRun> {
  try {
    switch (name) {
      case 'find_item':
        return await findItem(deps, input);
      case 'list_items':
        return await listItems(deps, input);
      case 'whats_expiring':
        return await whatsExpiring(deps, input);
      case 'whats_missing':
        return await whatsMissing(deps);
      case 'preparedness_score':
        return await preparednessScore(deps);
      case 'list_locations':
        return await listLocations(deps);
      case 'list_categories':
        return await listCategories(deps);
      case 'adjust_quantity':
        return await adjustQuantity(deps, input);
      case 'set_quantity':
        return await setQuantity(deps, input);
      case 'create_item':
        return await createItem(deps, input);
      case 'set_expiry':
        return await setExpiry(deps, input);
      default:
        return failed(`There is no tool called "${name}".`);
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'The tool failed.');
  }
}
