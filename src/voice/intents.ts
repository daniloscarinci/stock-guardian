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
  | QueryExpiryOf | QueryScore | AdjustQuantity | SetQuantity
  | CreateItem | SetExpiry | Help | Unknown;

export type IntentKind = Intent['kind'];

/** Intents that would change data. Used to route to the confirmation card. */
export const WRITING_INTENTS: readonly IntentKind[] = [
  'ADJUST_QUANTITY', 'SET_QUANTITY', 'CREATE_ITEM', 'SET_EXPIRY',
];
