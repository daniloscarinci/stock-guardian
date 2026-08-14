/**
 * Keyset (seek) pagination.
 *
 * `LIMIT ? OFFSET ?` degrades badly: page 40 of a ten-thousand-item inventory
 * makes SQLite walk and discard the first four thousand rows every time. Keyset
 * pagination instead asks "give me the rows after this one", which stays flat
 * however deep the user scrolls, and cannot skip or duplicate a row when the
 * data changes between pages.
 *
 * Every sort ends with `id` as a tiebreaker so the ordering is total - without
 * it, two items with the same name would page unpredictably.
 */
import type { SqlValue } from '../../database/driver/types';

export interface KeyPart {
  /** SQL expression to sort by, e.g. `i.name_norm`. */
  readonly expr: string;
  readonly direction: 'asc' | 'desc';
  /**
   * When true, a `IS NULL` flag is sorted ahead of the value so empty values
   * land last in BOTH directions. Sorting by expiry asks "what runs out first";
   * something that never runs out belongs at the end either way.
   */
  readonly nullsLast?: boolean;
}

export interface KeysetPlan {
  readonly orderBy: string;
  /** Column expressions to select so the cursor can be built from a row. */
  readonly cursorColumns: readonly { readonly alias: string; readonly expr: string }[];
}

/** No dot: SQLite parameter names are identifiers, so `:k_0` binds and `:k.0` does not. */
const CURSOR_PREFIX = 'k_';

/** Expands each key part into the concrete expressions that implement it. */
function expand(parts: readonly KeyPart[]): {
  expr: string;
  direction: 'asc' | 'desc';
  alias: string;
}[] {
  const expanded: { expr: string; direction: 'asc' | 'desc'; alias: string }[] = [];
  parts.forEach((part, index) => {
    if (part.nullsLast === true) {
      expanded.push({
        expr: `(CASE WHEN ${part.expr} IS NULL THEN 1 ELSE 0 END)`,
        direction: 'asc',
        alias: `_k${index}_null`,
      });
    }
    expanded.push({ expr: part.expr, direction: part.direction, alias: `_k${index}` });
  });
  return expanded;
}

export function buildKeysetPlan(parts: readonly KeyPart[]): KeysetPlan {
  const expanded = expand(parts);
  return {
    orderBy: expanded.map((p) => `${p.expr} ${p.direction.toUpperCase()}`).join(', '),
    cursorColumns: expanded.map((p) => ({ alias: p.alias, expr: p.expr })),
  };
}

/**
 * The `WHERE` fragment that resumes after a cursor, plus its bindings.
 *
 * Written as an OR-chain rather than a row-value comparison because the key
 * parts can point in different directions - a nulls-last flag always ascends
 * even when the value beside it descends, and `(a, b) > (?, ?)` cannot express
 * that.
 */
export function buildKeysetCondition(
  parts: readonly KeyPart[],
  cursor: readonly SqlValue[],
): { sql: string; params: Record<string, SqlValue> } {
  const expanded = expand(parts);
  if (cursor.length !== expanded.length) {
    throw new Error(
      `Cursor has ${cursor.length} parts but the sort has ${expanded.length}. ` +
        `The cursor was produced by a different sort order.`,
    );
  }

  const params: Record<string, SqlValue> = {};
  expanded.forEach((_, index) => {
    params[`${CURSOR_PREFIX}${index}`] = cursor[index] ?? null;
  });

  const clauses: string[] = [];
  for (let i = 0; i < expanded.length; i++) {
    const equalities = expanded
      .slice(0, i)
      .map((part, j) => `${part.expr} IS :${CURSOR_PREFIX}${j}`);
    const current = expanded[i] as (typeof expanded)[number];
    const operator = current.direction === 'asc' ? '>' : '<';
    clauses.push([...equalities, `${current.expr} ${operator} :${CURSOR_PREFIX}${i}`].join(' AND '));
  }

  return { sql: `(${clauses.map((c) => `(${c})`).join(' OR ')})`, params };
}

/** Encodes a cursor for transport through the interface. */
export function encodeCursor(values: readonly SqlValue[]): string {
  return btoa(
    encodeURIComponent(
      JSON.stringify(values.map((v) => (v instanceof Uint8Array ? null : v))),
    ),
  );
}

export function decodeCursor(cursor: string): SqlValue[] {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(atob(cursor)));
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as SqlValue[];
  } catch {
    throw new Error('That page cursor is not usable. Reload the list to start again.');
  }
}

/** Reads the cursor values out of the last row of a page. */
export function cursorFromRow(
  plan: KeysetPlan,
  row: Record<string, SqlValue>,
): string {
  return encodeCursor(plan.cursorColumns.map((c) => row[c.alias] ?? null));
}
