/**
 * Text normalization for search and matching.
 *
 * The original application searched with `toLowerCase().includes()`, which in a
 * Portuguese- and Spanish-first app means "agua" never finds "Água" and
 * "acucar" never finds "Açúcar" - the two most likely things a user would type.
 * Every searchable string is stored twice: as the user wrote it, and folded
 * through `foldText` into a `*_norm` column.
 *
 * The identical transformation MUST be applied to stored text and to the query,
 * which is why it lives in one exported function used by both. The catalog
 * extraction script contains a copy of this logic; it is a build-time script
 * that cannot import from `src`, and `catalog-provenance.test.ts` asserts the
 * two agree.
 */

/**
 * Unicode NFD, combining marks removed, lowercased, whitespace collapsed.
 *
 *   'Água Mineral'  -> 'agua mineral'
 *   'Açúcar'        -> 'acucar'
 *   'Comunicação'   -> 'comunicacao'
 *
 * `\p{M}` covers all combining marks, so this handles accents the app has never
 * seen as well as the ones it has.
 */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escapes a folded string for use inside a `LIKE` pattern.
 *
 * Without this, a user searching for "50%" or "a_b" gets wildcard behavior they
 * never asked for. Paired with `ESCAPE '\'` in the SQL.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** A folded, escaped, substring `LIKE` pattern: `%needle%`. */
export function containsPattern(query: string): string {
  return `%${escapeLikePattern(foldText(query))}%`;
}

/**
 * Splits a query into folded terms.
 *
 * Multi-term search is an AND across terms, so "arroz pantry" finds rice in the
 * pantry. Returns an empty array for a blank query, which callers treat as
 * "no filter" rather than "match nothing".
 */
export function searchTerms(query: string): string[] {
  const folded = foldText(query);
  return folded === '' ? [] : folded.split(' ');
}
