/**
 * Narrows a parameter set to the placeholders a statement actually uses.
 *
 * SQLite rejects a binding with no matching placeholder, which is the right
 * default - it catches `:nmae` typos immediately rather than silently ignoring
 * them. But queries here are composed from optional fragments: the item list
 * needs `:today` only when an expiry filter is present, while the count query
 * beside it shares the same parameter object and may reference none of them.
 *
 * So strictness stays on at the driver, and the few places that compose SQL
 * dynamically narrow their bindings explicitly through this function.
 */
import type { SqlValue } from '../../database/driver/types';

/**
 * Matches `:name` placeholders.
 *
 * Safe for this codebase's SQL, which contains no string literal with a colon
 * in it. `::` is skipped so a cast would not be mistaken for a placeholder.
 */
const PLACEHOLDER = /(?<!:):([A-Za-z_][A-Za-z0-9_.]*)/g;

export function placeholdersIn(sql: string): Set<string> {
  const found = new Set<string>();
  for (const match of sql.matchAll(PLACEHOLDER)) {
    if (match[1] !== undefined) found.add(match[1]);
  }
  return found;
}

export function pickUsedParams(
  sql: string,
  params: Readonly<Record<string, SqlValue>>,
): Record<string, SqlValue> {
  const used = placeholdersIn(sql);
  const picked: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(params)) {
    const name = key.startsWith(':') ? key.slice(1) : key;
    if (used.has(name)) picked[key] = value;
  }
  return picked;
}
