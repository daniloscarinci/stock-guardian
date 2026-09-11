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
import type { AssumptionReason, Destination, PendingWrite, VoiceDeps } from '../voice/execute';
import { resolveItem } from '../voice/resolve';
import { buildReplenishmentList } from '../../domain/replenishment';
import { evaluatePreparedness } from '../../domain/preparedness';
import { foldText } from '../../domain/normalize';
import type { CategoriesRepository } from '../../repositories/categories.repository';
import type { ContactsRepository } from '../../repositories/contacts.repository';
import type { CatalogRepository } from '../../repositories/catalog.repository';
import type { ExpiryBucket } from '../../domain/expiry';
import type { StockStatus } from '../../domain/stock';
import type { InventoryItemView, LocationNode, StockTransactionType } from '../../types/domain';

/**
 * Everything a tool needs, which is everything voice control needs plus three
 * repositories the parser never had to reach for.
 *
 * The categories, because a typed question names one where a spoken command
 * never did. The contacts, because "who do I call" is a question about this
 * household that has nothing to do with stock. The catalog, because it is the
 * only place that knows what a prepared household OUGHT to hold - the
 * inventory knows what this one does hold, and answering "what am I missing"
 * takes both.
 */
export interface AiDeps extends VoiceDeps {
  readonly categories: CategoriesRepository;
  readonly contacts: ContactsRepository;
  readonly catalog: CatalogRepository;
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
 * says what it is for AND when to reach for it. The ten writing descriptions
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
  {
    name: 'stock_summary',
    description:
      'The state of the whole stock in one set of figures: how many items there are, how ' +
      'many are critical or low, how many have expired or are about to, and how many are ' +
      'archived. The same counts the dashboard shows. Reach for this FIRST for a broad ' +
      'question - "how am I doing", "is anything wrong", "how much do I have" - so you can ' +
      'say how things stand without listing every item to work it out.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'item_history',
    description:
      'The recorded movements of one item - every purchase, addition, use and correction - ' +
      'most recent first, with what the quantity changed by and the day it happened. Use it ' +
      'for "when did I last buy rice", for how fast something is being used, and to explain ' +
      'a count that looks wrong. Name the item as the user said it; it is matched the same ' +
      'way find_item matches it.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        limit: {
          type: 'integer',
          description: `How many movements to return, newest first. At most ${String(LIST_LIMIT)}.`,
        },
      },
      required: ['item'],
    },
  },
  {
    name: 'search_catalog',
    description:
      'Search the built-in reference catalog of preparedness supplies - what a well-stocked ' +
      'household COULD hold. THESE ARE RECOMMENDATIONS, NOT WHAT THE USER OWNS. Nothing it ' +
      'returns is in their stock unless find_item or list_items says so, and telling someone ' +
      'they have water because the catalog lists water is the mistake this tool most invites. ' +
      'Use it for "what should I have", and for "what am I missing" alongside a look at the ' +
      'inventory: the catalog is the recommendation, the inventory is the truth.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text. Matched in every language the catalog is named in.' },
        category: { type: 'string', description: 'A category name from list_categories.' },
      },
      required: [],
    },
  },
  {
    name: 'list_contacts',
    description:
      "The household's emergency contacts, in the order the application itself keeps them: " +
      'most urgent first, then by name - NOT alphabetically, so do not re-sort them. Returns ' +
      'name, relationship, phone and email. Use it for who to call, who the doctor or the ' +
      'neighbour is, and for a number the user cannot remember. The optional search matches ' +
      'every field with accents and case ignored, so "medico" finds "Médico".',
    input_schema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Free text matched against name, relationship, phone, email, place and notes.',
        },
      },
      required: [],
    },
  },

  // ---- The ten that only propose ------------------------------------------
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
  {
    name: 'move_item',
    description:
      'PROPOSE moving an item to a place. THIS DOES NOT CHANGE ANYTHING - it only proposes. ' +
      'The place must come from list_locations. If none matches, say so and ask - do not ' +
      'choose the nearest one.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        location: { type: 'string', description: 'A place from list_locations.' },
      },
      required: ['item', 'location'],
    },
  },
  {
    name: 'set_minimum',
    description:
      'PROPOSE the level below which the replenishment list speaks up about an item. THIS DOES ' +
      'NOT CHANGE ANYTHING - it only proposes. The number must be one the user stated.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        minimum: { type: 'number', description: 'The level the user stated. Never one they did not.' },
        unit: { type: 'string', description: 'The unit the user counted in, if they named one.' },
      },
      required: ['item', 'minimum'],
    },
  },
  {
    name: 'set_target',
    description:
      'PROPOSE the level the user is stocking towards. THIS DOES NOT CHANGE ANYTHING - it only ' +
      'proposes. The number must be one the user stated.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        target: { type: 'number', description: 'The level the user stated. Never one they did not.' },
        unit: { type: 'string', description: 'The unit the user counted in, if they named one.' },
      },
      required: ['item', 'target'],
    },
  },
  {
    name: 'create_location',
    description:
      'PROPOSE a new place to keep things. THIS DOES NOT CHANGE ANYTHING - it only proposes. ' +
      'Call list_locations first: if a place with this name already exists, say so instead of ' +
      'proposing a second one.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'create_category',
    description:
      'PROPOSE a new category. THIS DOES NOT CHANGE ANYTHING - it only proposes. Call ' +
      'list_categories first. The name is stored in the language the interface is set to.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'create_contact',
    description:
      'PROPOSE a new emergency contact. THIS DOES NOT CHANGE ANYTHING - it only proposes. Only ' +
      'the name is required. Never invent a phone number, and never reformat one the user gave.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        relationship: { type: 'string', description: 'Doctor, neighbour, and so on.' },
        phone: { type: 'string', description: 'Exactly as the user gave it.' },
        email: { type: 'string' },
        location: { type: 'string', description: 'Free text: where this person is.' },
      },
      required: ['name'],
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

const historyInput = z.object({
  item: z.string().min(1),
  // Clamped rather than rejected: a model asking for two hundred movements has
  // asked a reasonable question badly, and refusing it teaches it nothing.
  limit: z.number().int().min(1).optional(),
});

const catalogInput = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
});

const contactsInput = z.object({ search: z.string().optional() });

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

const moveInput = z.object({
  item: z.string().min(1),
  location: z.string().min(1),
});

/*
 * Both thresholds take zero and refuse anything below it.
 *
 * Zero is a level a person can mean, and it is not the same as having none
 * set. `evaluateStock` is where the difference shows: a null minimum is
 * replaced by the global threshold, where a zero one stays zero. A negative is
 * not a level at all, and is refused rather than clamped to zero, because
 * clamping would store one of those two meanings for a number that meant
 * neither.
 */
const setMinimumInput = z.object({
  item: z.string().min(1),
  minimum: z.number().min(0),
  unit: z.string().optional(),
});

const setTargetInput = z.object({
  item: z.string().min(1),
  target: z.number().min(0),
  unit: z.string().optional(),
});

const createLocationInput = z.object({ name: z.string().min(1) });

const createCategoryInput = z.object({ name: z.string().min(1) });

/*
 * A contact, and the one schema here that validates a phone number no further
 * than "it is a string".
 *
 * Nothing in this application parses a number: the column is free text, the
 * Contacts screen shows it as typed, and `contacts.search` folds it like any
 * other field. What a person types carries meaning no digit test keeps - a
 * country code, the brackets they read it back in, "r. 22" for an extension,
 * or a second number after a slash - so a pattern strict enough to catch a
 * typo would refuse more real numbers than it caught, and each refusal would
 * reach the user as Claude saying their own phone number was wrong.
 *
 * The name is trimmed because `contacts.create` trims it before storing, and a
 * card headed with a name the row will not have is a card about a different
 * write. Nothing else is: see `textOrNull` below.
 */
const createContactInput = z.object({
  name: z.string().trim().min(1),
  relationship: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  location: z.string().optional(),
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

/**
 * A category phrase to a category, matched against every language it is
 * named in rather than only the interface language.
 *
 * `list_items` and `search_catalog` only ever needed the id this used to
 * return bare. `create_category` needs the name as well - it is what "a
 * category called X already exists" names back - and `{id, name}` is the pair
 * `findLocation` already returns for the same reason, so the two finders read
 * the same way at every call site.
 */
async function findCategory(
  deps: AiDeps,
  phrase: string,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  const folded = foldText(phrase);
  if (folded === '') return undefined;

  const all = await deps.categories.list();
  const match = all.find((category) =>
    Object.values(category.names).some((name) => foldText(name) === folded),
  );
  return match === undefined
    ? undefined
    : { id: match.id, name: categoryName(match.names, deps.language, match.id) };
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
    const category = await findCategory(deps, filters.category);
    if (category === undefined) {
      return ok({ matched: 0, showing: 0, note: `No category is called "${filters.category}". Call list_categories.`, items: [] });
    }
    categoryIds = [category.id];
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

/*
 * The cheap answer to a broad question.
 *
 * The same call `DashboardScreen` makes, so "how am I doing" and the screen
 * agree. Its existence is as much about what it prevents: without it, a
 * question as vague as "how is my stock" is answered by listing fifty items
 * and counting them in prose, which is slower, costs more and gets the
 * arithmetic wrong in a way nobody can see.
 */
async function stockSummary(deps: AiDeps): Promise<ToolRun> {
  const stats = await deps.items.dashboardStats(deps.context);

  return ok({
    today: deps.context.today,
    total_items: stats.totalItems,
    total_quantity: stats.totalQuantity,
    categories_used: stats.categoriesUsed,
    places_used: stats.locationsUsed,
    critical: stats.critical,
    low: stats.low,
    expired: stats.expired,
    expiring_today: stats.expiringToday,
    expiring_soon: stats.expiringSoon,
    no_expiry_date: stats.noExpiration,
    archived: stats.archived,
    changed_in_the_last_week: stats.recentlyModified,
    note: 'Counts of active items. Archived stock is counted only in "archived".',
  });
}

/*
 * One item's movements.
 *
 * `change` is derived from before and after rather than read from the
 * `quantity` column, which stores the magnitude and not the direction: a
 * consumption and a purchase of the same size are the same number there. A
 * signed change is what "when did I last buy rice, and how much" is made of.
 */
async function itemHistory(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = historyInput.safeParse(input);
  if (!parsed.success) return failed('item_history needs an item, and an optional whole-number limit.');

  const found = await locate(deps, parsed.data.item);
  if (!found.ok) return found.run;

  const limit = Math.min(parsed.data.limit ?? LIST_LIMIT, LIST_LIMIT);
  const rows = await deps.items.history(found.item.id, limit);

  const movements = rows.map((row) => {
    const before = Number(row.quantity_before);
    const after = Number(row.quantity_after);
    return {
      type: String(row.type),
      change: Math.round((after - before) * 1e6) / 1e6,
      quantity_after: after,
      // The calendar day, which is what a person asks about. The instant is
      // ordering information, and the order of this array already carries it.
      date: String(row.occurred_at).slice(0, 10),
      ...(row.notes === null || row.notes === undefined ? {} : { notes: String(row.notes) }),
    };
  });

  return ok({
    item: found.item.name,
    unit: found.item.unit,
    quantity_now: found.item.quantity,
    showing: movements.length,
    // An empty history is a fact about the item, not a failure to find it, and
    // saying so stops the model reporting that the item does not exist.
    ...(movements.length === 0
      ? { note: 'No movement has ever been recorded for this item. It has not been adjusted since it was created.' }
      : {}),
    movements,
  });
}

/*
 * The reference catalog, kept visibly separate from the stock.
 *
 * Everything here is shaped to resist one specific failure: a model reading a
 * catalog row and telling the user they own it. The key is `recommendations`
 * rather than `items`, every row is a `recommended` name rather than a `name`,
 * and the note says the thing outright.
 *
 * `owned_from_this_entry` is the honest version of a tempting shortcut. It
 * counts inventory items created FROM the catalog entry, so it proves
 * ownership when it is above zero and proves nothing when it is zero - an item
 * the user typed by hand carries no link back. The note says that too, because
 * "you have no rice" to somebody with rice is worse than not answering.
 */
async function searchCatalog(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = catalogInput.safeParse(input);
  if (!parsed.success) return failed('search_catalog takes a query and a category.');
  const filters = parsed.data;

  const preamble = {
    source: 'reference catalog',
    is_inventory: false,
    note:
      'RECOMMENDATIONS ONLY. This is the built-in list of supplies a prepared household could ' +
      'hold. It is NOT the user\'s stock and says nothing about what they own. ' +
      '"owned_from_this_entry" counts inventory items created from the entry, so above zero ' +
      'proves they have it and zero proves nothing - anything they typed in by hand is not ' +
      'linked. Check with find_item or list_items before saying they have something, or do not.',
  };

  let categoryIds: readonly string[] | undefined;
  if (filters.category !== undefined) {
    const category = await findCategory(deps, filters.category);
    if (category === undefined) {
      return ok({
        ...preamble,
        showing: 0,
        note: `${preamble.note} No category is called "${filters.category}". Call list_categories.`,
        recommendations: [],
      });
    }
    categoryIds = [category.id];
  }

  // One past the cap, so the tool can say the list was cut without a second
  // counting query the catalog repository does not offer.
  const rows = await deps.catalog.search({
    // Spread rather than assigned: `CatalogQuery` has no optional property that
    // accepts `undefined`, and an absent filter is not the same as an empty one.
    ...(filters.query === undefined ? {} : { search: filters.query }),
    ...(categoryIds === undefined ? {} : { categoryIds }),
    lang: deps.language,
    limit: LIST_LIMIT + 1,
  });
  const shown = rows.slice(0, LIST_LIMIT);

  const categories = await deps.categories.list(true);
  const nameOf = new Map(
    categories.map((category) => [category.id, categoryName(category.names, deps.language, category.id)]),
  );

  return ok({
    ...preamble,
    catalog_size: await deps.catalog.total(),
    showing: shown.length,
    ...(rows.length > shown.length
      ? { more: `Only the first ${String(shown.length)} are listed. Narrow the query to see the rest.` }
      : {}),
    recommendations: shown.map((entry) => ({
      recommended: entry.displayName,
      category: nameOf.get(entry.categoryId) ?? entry.categoryId,
      usual_unit: entry.defaultUnit,
      owned_from_this_entry: entry.inInventory,
    })),
  });
}

/*
 * The emergency contacts, in the order the contacts screen shows them.
 *
 * `contacts.list` orders by priority and then by folded name, and that order is
 * passed through untouched: in an emergency the person to call first belongs at
 * the top, not wherever the alphabet puts them. The description tells Claude
 * not to re-sort, and `order` repeats it in the result, because a model asked
 * for "my contacts" will otherwise tidy them into alphabetical order and
 * silently bury the one that mattered.
 *
 * Ids are left out, as everywhere else. The search runs through the
 * repository's own accent-folding filter, so "jose" finds "José".
 */
async function listContacts(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = contactsInput.safeParse(input);
  if (!parsed.success) return failed('list_contacts takes an optional search.');
  const term = parsed.data.search;

  const rows =
    term === undefined || term.trim() === ''
      ? await deps.contacts.list()
      : await deps.contacts.search(term);

  const shown = rows.slice(0, LIST_LIMIT);
  return ok({
    count: rows.length,
    showing: shown.length,
    order: 'Most urgent first, then by name. Keep this order; it is not alphabetical.',
    urgency_scale: '1 is the first to call, 4 the last.',
    contacts: shown.map((contact) => ({
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
      email: contact.email,
      urgency: contact.priority,
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

  let destination: Destination | null = null;

  if (fields.location !== undefined && fields.location !== '') {
    const location = await findLocation(deps, fields.location);
    /*
     * Still refused here, where the parser now offers to make the place.
     *
     * The two paths are not the same conversation. A parsed sentence is all
     * the user is going to say, so the card asking "shall I make it?" is the
     * only chance to settle it. This tool is inside a loop that can ask: the
     * model has `list_locations`, and a person who said "the cellar" about a
     * house with a Porão is better served by being read their own shelves
     * than by acquiring a second one under a name they did not choose.
     */
    if (location === undefined) {
      return ok({
        status: 'not proposed',
        reason: `No place is called "${fields.location}". Call list_locations and ask the user which one.`,
      });
    }
    destination = { kind: 'existing', id: location.id, name: location.name };
  }

  const reasons: AssumptionReason[] = ['newItem'];
  if (fields.quantity === undefined) reasons.push('quantity');

  const write: PendingWrite = {
    kind: 'CREATE',
    name: fields.name,
    quantity: fields.quantity ?? 1,
    unit: fields.unit ?? 'un',
    location: destination,
    expirationDate: fields.expires_on ?? null,
    ...assumed(reasons),
  };

  return proposed(
    write,
    proposalNote(
      `create ${fields.name}, ${String(write.quantity)} ${write.unit}${destination === null ? '' : ` in ${destination.name}`}`,
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

async function moveItem(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return failed('move_item needs an item and a place.');
  const { item: phrase, location: place } = parsed.data;

  const found = await locate(deps, phrase);
  if (!found.ok) return found.run;

  const destination = await findLocation(deps, place);

  /*
   * Refused here, where the parser offers to make the place - the same split
   * `create_item` makes above, and for the same reason.
   *
   * A parsed sentence gets one shot at what it heard: it is all the user is
   * going to say, so the card asking "shall I make it?" is the only way "move
   * the rice to the cellar" gets anywhere at all. This tool is inside a loop
   * that can ask. It has `list_locations`, so it can find out what the shelves
   * are called and then say what it means. A model that invented the place
   * would be choosing twice over - which place, and how to word it - and the
   * user would be shown one card covering both.
   */
  if (destination === undefined) {
    return ok({
      status: 'not proposed',
      reason: `No place is called "${place}". Call list_locations and ask the user which one.`,
    });
  }

  // Already there. `items.transfer` writes the shelf and a `transfer` row in
  // one transaction whatever the shelves are, so confirming this would record
  // a movement from a place to itself. There is nothing to confirm.
  if (found.item.locationId === destination.id) {
    return ok({ status: 'no change', item: itemJson(found.item) });
  }

  /*
   * `location` on top of `assistant`, where the place was matched by
   * containing its name rather than by being it.
   *
   * `findLocation` matches on CONTAINS, so "porao" finds "Porão dos fundos"
   * and would find the wrong one of two cellars just as readily. A move is the
   * one write whose whole content is a place, so a place matched loosely is
   * exactly the part worth showing the reader. The same check `execute.ts`
   * makes on a spoken move, for the same reason.
   */
  const reasons: AssumptionReason[] = [];
  if (foldText(destination.name) !== foldText(place)) reasons.push('location');

  // The shelf it is leaving, by id and by name, because the two are read by
  // different things: `commit` falls back to the id when it cannot re-read the
  // row, and the card shows the name beside the new one. null is not missing
  // information in either - it is "it was on none", which the undo has to put
  // back as null and the card renders as "none".
  const write: PendingWrite = {
    kind: 'MOVE',
    item: found.item,
    fromLocationId: found.item.locationId,
    fromLocationName: found.item.locationName,
    to: { kind: 'existing', id: destination.id, name: destination.name },
    ...assumed(reasons),
  };

  return proposed(
    write,
    proposalNote(
      `${found.item.name} would move to ${destination.name}` +
        (found.item.locationName === null ? '' : ` from ${found.item.locationName}`),
    ),
  );
}

/*
 * The two thresholds, and the one thing `before` has to get right.
 *
 * It is read from `minimumQuantity` and `idealQuantity` - the stored columns,
 * which are nullable - and never from `effectiveMinimum`, which is never null
 * because the fallback to the global threshold has already been applied to it.
 * The difference is the whole point of the field. `commit.ts` re-reads the row
 * when the card is confirmed and falls back to this value, and whichever it
 * ends with is what the undo restores; `null` there means no threshold was
 * ever set and the global one stands in, where `0` means one was set to
 * nothing. A `before` of 0 standing in for null would hand the undo the second
 * meaning for an item that had the first, so the stored value travels exactly
 * as it was found.
 *
 * Both now take an optional unit, flagged with `unitDiffers` exactly as
 * `adjust_quantity` and `set_quantity` flag one - a change of mind from this
 * comment's first version, which left the unit out on the theory that
 * `find_item`, `list_items` and `item_history` had already shown Claude the
 * real one, so the number it sent was one it had had every chance to read in
 * context first. That was a hope about what the model would do standing where
 * every other safeguard in this file is a check: nothing forces a `find_item`
 * call before either tool, and `create_item` and `move_item` at least ask for
 * theirs in words ("check with find_item first", "must come from
 * list_locations") where these two asked for nothing. `execute.ts` argues at
 * length that this is the write worth checking most - a wrong adjustment
 * shows up the next time anyone looks at the quantity, where a wrong minimum
 * shows up as a replenishment list quietly wrong about what is running out,
 * which is the one list this application exists to get right - and a hope is
 * not what that argument earns.
 *
 * The flag still cannot be a guarantee, and says so rather than overclaiming:
 * a unit is optional, so an absent one reads exactly like a matching one, and
 * only a named WRONG unit is ever caught - the same limit `adjust_quantity`
 * has always lived with. What is a guarantee, and was true before this
 * change, is structural rather than hoped for: the card prints the item's own
 * stored unit beside every number on a MINIMUM or TARGET write regardless of
 * what Claude sent, so the person confirming it checks the true unit against
 * their own memory of the shelf; and `proposalNote` below hands that same
 * stored unit back to Claude in the tool result, before it says anything to
 * the user at all.
 */
async function setMinimum(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = setMinimumInput.safeParse(input);
  if (!parsed.success) return failed('set_minimum needs an item and a level of zero or more.');
  const { item: phrase, minimum, unit } = parsed.data;

  const found = await locate(deps, phrase);
  if (!found.ok) return found.run;

  // Already that. A card for a change of nothing asks the reader to approve a
  // sentence with no content, and the true answer is the level itself.
  if (found.item.minimumQuantity === minimum) {
    return ok({ status: 'no change', minimum, item: itemJson(found.item) });
  }

  // `assistant` is added by `assumed`; only what is true on top of it goes here.
  const reasons: AssumptionReason[] = [];
  if (unitDiffers(unit, found.item.unit)) reasons.push('unit');

  const write: PendingWrite = {
    kind: 'MINIMUM',
    item: found.item,
    before: found.item.minimumQuantity,
    after: minimum,
    ...assumed(reasons),
  };

  return proposed(
    write,
    proposalNote(
      `${found.item.name}: the minimum would become ${String(minimum)} ${found.item.unit}`,
    ),
  );
}

async function setTarget(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = setTargetInput.safeParse(input);
  if (!parsed.success) return failed('set_target needs an item and a level of zero or more.');
  const { item: phrase, target, unit } = parsed.data;

  const found = await locate(deps, phrase);
  if (!found.ok) return found.run;

  // The stored target is reported alongside, because `itemJson` does not carry
  // one at all - without it "no change" would name no number.
  if (found.item.idealQuantity === target) {
    return ok({ status: 'no change', target, item: itemJson(found.item) });
  }

  // `assistant` is added by `assumed`; only what is true on top of it goes here.
  const reasons: AssumptionReason[] = [];
  if (unitDiffers(unit, found.item.unit)) reasons.push('unit');

  const write: PendingWrite = {
    kind: 'TARGET',
    item: found.item,
    before: found.item.idealQuantity,
    after: target,
    ...assumed(reasons),
  };

  return proposed(
    write,
    proposalNote(
      `${found.item.name}: the target would become ${String(target)} ${found.item.unit}`,
    ),
  );
}

/*
 * A place named on its own - the one write in this file that is not about an
 * item, matched and refused exactly as `execute.ts`'s CREATE_LOCATION is.
 *
 * A NAME THAT IS TAKEN IS ANSWERED, NOT MADE TWICE. `findLocation` matches on
 * CONTAINS, so "porao" would find "Porão dos Fundos" here exactly as it does
 * for `move_item`, and a second cellar a user cannot tell from the first is a
 * worse outcome than being told the one they have: stock would start landing
 * on both, and neither would then answer "what is in the cellar" truthfully.
 * Someone who asks Claude to make a place they already have has almost
 * certainly forgotten it, not decided to keep a second one.
 *
 * The refusal is the shape `create_item` and `move_item` already answer an
 * unknown place with - `{ status: 'not proposed', reason }` - rather than the
 * fuller `WHERE_LOCATION` answer `execute.ts` builds, which lists everything
 * the place holds. That extra look is one `list_items` call away and Claude
 * has the location's name in hand to make it; duplicating the query here
 * would answer a question nobody asked when all that changed is which engine
 * is running.
 *
 * `newLocation` is the only reason there could be, for the reason every other
 * assumption on this write is absent: nothing was matched loosely because
 * nothing was matched at all, and there is no quantity, unit or date in a bare
 * name to have filled in.
 */
async function createLocation(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = createLocationInput.safeParse(input);
  if (!parsed.success) return failed('create_location needs a name.');
  const { name } = parsed.data;

  const existing = await findLocation(deps, name);
  if (existing !== undefined) {
    return ok({
      status: 'not proposed',
      reason: `A place called "${existing.name}" already exists. Call list_locations, or list_items with that location, to see what it holds.`,
    });
  }

  const write: PendingWrite = {
    kind: 'NEW_LOCATION',
    name,
    ...assumed(['newLocation']),
  };

  return proposed(write, proposalNote(`create the place "${name}"`));
}

/*
 * The same sentence about a heading instead of a shelf, answered the same way
 * for the same reason `createLocation` gives above - through a strictly
 * weaker net, and that is worth saying rather than leaving implied.
 *
 * A NAME THAT IS TAKEN IS ANSWERED, NOT MADE TWICE. `findCategory` matches
 * against every language the category is named in, so "tools" finds
 * Ferramentas on a Portuguese phone exactly as `list_items` and
 * `search_catalog` already rely on it to. Two categories a user cannot tell
 * apart is worse than being shown the one they have: items would start being
 * filed under both, and neither would then answer "what is in tools"
 * truthfully - and a category is a heading the preparedness score is averaged
 * OVER, so a duplicate does not just confuse a screen, it can move the score.
 *
 * That argument is stronger than `createLocation`'s, and the net catching the
 * duplicate is weaker. `findCategory` here matches only the WHOLE folded
 * name - unlike `findLocation` above, which tries the whole name and then
 * CONTAINS, and unlike `execute.ts`'s own `findCategory`, which tries the
 * whole name, then a prefix, then CONTAINS, against the name in the user's
 * language with an English fallback. So "Agua" against a household's own
 * "Água e Bebidas" finds nothing here, where either of those would have found
 * it, and this tool would propose the very duplicate `create_location` and
 * the grammar both refuse. Reusing the finder `list_items` and
 * `search_catalog` already depend on is still the right call - loosening it
 * here would loosen their filters too, and neither has been asked to accept a
 * category matched by containing its name rather than being it - but the gap
 * that leaves is real, not merely theoretical, and is the price of that
 * choice rather than a case this tool covers as thoroughly as its sibling.
 *
 * `newCategory` is the only reason there could be, for the same reason
 * `createLocation`'s `newLocation` is: nothing was matched loosely because
 * nothing was matched at all, and a bare name carries nothing else to assume.
 */
async function createCategory(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = createCategoryInput.safeParse(input);
  if (!parsed.success) return failed('create_category needs a name.');
  const { name } = parsed.data;

  const existing = await findCategory(deps, name);
  if (existing !== undefined) {
    return ok({
      status: 'not proposed',
      reason: `A category called "${existing.name}" already exists. Call list_categories, or list_items with that category, to see what it holds.`,
    });
  }

  const write: PendingWrite = {
    kind: 'NEW_CATEGORY',
    name,
    ...assumed(['newCategory']),
  };

  return proposed(write, proposalNote(`create the category "${name}"`));
}

/**
 * Free text as it was given, or null where nothing was.
 *
 * The trim decides only WHETHER there is a value; it never becomes one. A
 * field of spaces is a field the model filled with nothing, and null is what
 * `commit` writes for an absent one and what the card knows not to print - an
 * empty string would put a blank line under somebody's name and a blank column
 * in their row. What is kept is the original string, spaces and all, because
 * this is the funnel every field of a contact passes through and one of them
 * is a phone number.
 */
function textOrNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value;
}

/*
 * A person, which is the third write here that is not about an item and the
 * first that is more than a name.
 *
 * TWO FIELDS ARE ASKED FOR HERE THAT THE GRAMMAR NEVER FILLS, and the reason
 * is not this tool's to make: `NEW_CONTACT` declares all five and says in its
 * own comment that the spoken path leaves the email and the place null because
 * an address heard aloud is a guess at somebody's spelling and a place is free
 * text no pattern can tell apart from a name. A typed sentence has neither
 * problem. The variant was written so that the tool filling them would be a
 * new caller rather than a new field, and this is that caller.
 *
 * THE NUMBER IS PASSED THROUGH UNTOUCHED - not normalised, and validated no
 * further than `createContactInput` does. The parser's path has to convert:
 * spoken words are not digits until `spokenDigits` makes them, and it declines
 * the whole rule when they cannot be read as any, because somebody who said a
 * number expects the number. Claude is handed the characters, so there is
 * nothing to convert and the only thing left to do to them is change them. The
 * description promises the user's own formatting back, the column is free
 * text, and nothing downstream reads a number as anything but a string.
 *
 * SO IT DOES NOT CARRY `heardDigits` EITHER, and that is the same fact rather
 * than a second decision. The reason means heard rather than shown - the card
 * renders it as "I heard this number rather than being shown it, check every
 * digit" - and a number Claude was handed in text was shown. Nothing is lost
 * by leaving it off: `ConfirmCard`'s `details` prints the number under the
 * name for every NEW_CONTACT whatever the reasons say, so the reader still
 * sees the digits. `assistant` is left as the only reason, which is the true
 * one - the model chose to make this row, and chose what went in it.
 *
 * A NAME THAT IS TAKEN IS ANSWERED, NOT MADE TWICE, through `contacts.search`
 * - the lookup `execute.ts`'s CREATE_CONTACT uses and the one QUERY_CONTACT
 * answers with, so both engines mean the same thing by "you already have
 * this person". It searches wider than `findLocation` and `findCategory` do:
 * every field, notes included, so "Ana" is stopped by a João whose note
 * mentions her. `execute.ts` weighed that cost and took it, and the reasoning
 * carries here unchanged - two rows called Ana split the number of somebody
 * who may need reaching in an emergency, and narrowing the check to the name
 * would give the ask box a second idea of what a duplicate is from the one it
 * already answers questions with. What makes the cost bearable is the same
 * thing there and here: the answer NAMES whoever it found. The user hears who
 * it was, sees it is not the person they meant, and says something else - and
 * a model reading these rows back can say the note matched rather than that
 * the contact exists.
 */
async function createContact(deps: AiDeps, input: unknown): Promise<ToolRun> {
  const parsed = createContactInput.safeParse(input);
  if (!parsed.success) return failed('create_contact needs at least a name.');
  const fields = parsed.data;

  const existing = await deps.contacts.search(fields.name);
  if (existing.length > 0) {
    return ok({
      status: 'not proposed',
      reason:
        `"${fields.name}" already matches a contact this household has. Say who was found, and ` +
        'their number, rather than proposing a second row. The search covers every field, notes ' +
        'included, so a match can be somebody else who merely mentions this person - if that is ' +
        'what happened, say so and ask the user what to do.',
      contacts: existing.slice(0, LIST_LIMIT).map((contact) => ({
        name: contact.name,
        relationship: contact.relationship,
        phone: contact.phone,
        email: contact.email,
      })),
    });
  }

  const write: PendingWrite = {
    kind: 'NEW_CONTACT',
    name: fields.name,
    relationship: textOrNull(fields.relationship),
    phone: textOrNull(fields.phone),
    email: textOrNull(fields.email),
    location: textOrNull(fields.location),
    ...assumed([]),
  };

  return proposed(
    write,
    proposalNote(
      `create the contact "${write.name}"` +
        (write.relationship === null ? '' : `, ${write.relationship}`) +
        (write.phone === null ? '' : `, on ${write.phone}`),
    ),
  );
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
      case 'stock_summary':
        return await stockSummary(deps);
      case 'item_history':
        return await itemHistory(deps, input);
      case 'search_catalog':
        return await searchCatalog(deps, input);
      case 'list_contacts':
        return await listContacts(deps, input);
      case 'adjust_quantity':
        return await adjustQuantity(deps, input);
      case 'set_quantity':
        return await setQuantity(deps, input);
      case 'create_item':
        return await createItem(deps, input);
      case 'set_expiry':
        return await setExpiry(deps, input);
      case 'move_item':
        return await moveItem(deps, input);
      case 'set_minimum':
        return await setMinimum(deps, input);
      case 'set_target':
        return await setTarget(deps, input);
      case 'create_location':
        return await createLocation(deps, input);
      case 'create_category':
        return await createCategory(deps, input);
      case 'create_contact':
        return await createContact(deps, input);
      default:
        return failed(`There is no tool called "${name}".`);
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'The tool failed.');
  }
}
