/**
 * What the application understood.
 *
 * Every intent is data, and none of them can act. Executing one is a separate
 * step in `services/voice/`, which is what makes the whole parser testable with
 * a string and an expectation.
 *
 * `item`, `location` and `name` hold FOLDED phrases as spoken, not identifiers.
 * Turning a phrase into a row is `resolve.ts`'s job and needs the database.
 */
import type { StockTransactionType } from '../types/domain';

export interface QueryQuantity {
  readonly kind: 'QUERY_QUANTITY';
  readonly item: string;
}

export interface QueryExpiring {
  readonly kind: 'QUERY_EXPIRING';
  /** null means "use the user's own first warning window". */
  readonly withinDays: number | null;
  /** "o que ja venceu" asks only for what is already past. */
  readonly expiredOnly: boolean;
}

export interface QueryMissing {
  readonly kind: 'QUERY_MISSING';
}

export interface QueryWhere {
  readonly kind: 'QUERY_WHERE';
  /** Exactly one of these is set: "onde esta X" or "o que tem na Y". */
  readonly item: string | null;
  readonly location: string | null;
}

export interface QueryExpiryOf {
  readonly kind: 'QUERY_EXPIRY_OF';
  readonly item: string;
}

export interface QueryScore {
  readonly kind: 'QUERY_SCORE';
}

export interface AdjustQuantity {
  readonly kind: 'ADJUST_QUANTITY';
  readonly item: string;
  /** Always positive. `direction` carries the sign. */
  readonly amount: number;
  readonly direction: 'up' | 'down';
  /** Why, taken from the verb: comprei is a purchase, usei is consumption. */
  readonly transaction: StockTransactionType;
  readonly unit: string | null;
  /**
   * True when no number was spoken and 1 was assumed.
   *
   * "comprei arroz" is a whole sentence and one bag is what it almost always
   * means, so the grammar reads it rather than refusing it. The flag is how
   * the layers above tell that number apart from one the user actually said:
   * an assumed amount is confirmed before it is stored, never written straight.
   */
  readonly amountAssumed: boolean;
}

export interface SetQuantity {
  readonly kind: 'SET_QUANTITY';
  readonly item: string;
  readonly amount: number;
  readonly unit: string | null;
}

export interface CreateItem {
  readonly kind: 'CREATE_ITEM';
  readonly name: string;
  readonly amount: number | null;
  readonly unit: string | null;
  readonly location: string | null;
  readonly expiresOn: string | null;
}

export interface SetExpiry {
  readonly kind: 'SET_EXPIRY';
  readonly item: string;
  readonly expiresOn: string;
  /**
   * True when the phrase named a period rather than a day.
   *
   * "dia 12", "12/09" and "12 de setembro" state the date. "em marco",
   * "semana que vem" and "daqui a 30 dias" leave the day to the parser, and a
   * day nobody said is worth showing before it is stored.
   */
  readonly dateAssumed: boolean;
}

export interface QueryCategory {
  readonly kind: 'QUERY_CATEGORY';
  /** The category as spoken and folded: "alimentos", not "food". */
  readonly category: string;
}

/**
 * A phone number, a relationship, a name - whatever the speaker had.
 *
 * One loose phrase rather than a set of slots, because `contacts.search` looks
 * in every field already: "o telefone do medico" and "o numero da Ana" are the
 * same question with a different handle on the same row.
 */
export interface QueryContact {
  readonly kind: 'QUERY_CONTACT';
  readonly query: string;
}

/** "quando comprei arroz" - the last few movements of one item. */
export interface QueryHistory {
  readonly kind: 'QUERY_HISTORY';
  readonly item: string;
}

/** "quantos itens eu tenho" - the whole inventory, counted. */
export interface QueryTotal {
  readonly kind: 'QUERY_TOTAL';
}

/**
 * "move o arroz para o porao".
 *
 * `location` is required and never null. A move with no destination is not a
 * move, and the rule that builds this declines rather than producing one - an
 * item sent nowhere would be an item quietly unplaced.
 */
export interface MoveItem {
  readonly kind: 'MOVE_ITEM';
  readonly item: string;
  readonly location: string;
}

/**
 * "o minimo de arroz e 5 quilos" - the level the replenishment list watches.
 *
 * The unit is carried but not stored. A threshold is a number in the row's own
 * unit, so there is nowhere else for it to go; it is here because the phrase
 * said it and the layers above may want to show it back.
 */
export interface SetMinimum {
  readonly kind: 'SET_MINIMUM';
  readonly item: string;
  readonly amount: number;
  readonly unit: string | null;
}

/** "quero ter 20 latas de feijao" - the level the user is stocking towards. */
export interface SetTarget {
  readonly kind: 'SET_TARGET';
  readonly item: string;
  readonly amount: number;
  readonly unit: string | null;
}

export interface Help {
  readonly kind: 'HELP';
}

/**
 * Not an error. It carries the transcript so the interface can show what was
 * heard, which turns a mishearing into something the user can see and correct.
 */
export interface Unknown {
  readonly kind: 'UNKNOWN';
  readonly transcript: string;
}

export type Intent =
  | QueryQuantity | QueryExpiring | QueryMissing | QueryWhere
  | QueryExpiryOf | QueryScore | QueryCategory | QueryContact
  | QueryHistory | QueryTotal | AdjustQuantity | SetQuantity
  | CreateItem | SetExpiry | MoveItem | SetMinimum | SetTarget
  | Help | Unknown;

export type IntentKind = Intent['kind'];

/** Intents that would change data. Used to route to the confirmation card. */
export const WRITING_INTENTS: readonly IntentKind[] = [
  'ADJUST_QUANTITY', 'SET_QUANTITY', 'CREATE_ITEM', 'SET_EXPIRY',
  'MOVE_ITEM', 'SET_MINIMUM', 'SET_TARGET',
];

/**
 * Writing intents whose missing item is worth offering to create.
 *
 * A subset of `WRITING_INTENTS` rather than the same list, because "I did not
 * find it" means different things to different writes. "comprei arroz" against
 * an empty pantry is the first bag of rice, and creating it is the obvious next
 * step. The three below are not:
 *
 *   MOVE_ITEM would be left half done. It can only fail on its ITEM now - an
 *   unknown destination is proposed rather than refused - and creating that
 *   item finishes none of the sentence: "leve o arroz para o porao" with no
 *   rice, answered by making rice, puts a row in the inventory on no shelf and
 *   moves nothing. The user said one thing and got a smaller, different one.
 *   An adjustment has no such second half; "comprei arroz" IS the creation.
 *   SET_MINIMUM and SET_TARGET set a level on stock that is supposed to exist.
 *   Creating a row to hold a threshold would put an item nobody mentioned into
 *   the inventory, with a quantity nobody said.
 *
 * CREATE_ITEM was listed here and is gone. It can no longer fail to find
 * anything: the item is new by definition, and an unknown shelf is now
 * proposed rather than refused, so the intent never reaches a notFound at all.
 * The entry was an offer that nothing could ever make.
 */
export const CREATABLE_INTENTS: readonly IntentKind[] = [
  'ADJUST_QUANTITY', 'SET_QUANTITY', 'SET_EXPIRY',
];
