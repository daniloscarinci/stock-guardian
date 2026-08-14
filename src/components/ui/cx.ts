/**
 * Joins class names, skipping anything absent.
 *
 * `noUncheckedIndexedAccess` is on, so a CSS Module lookup types as
 * `string | undefined` even though every class exists at build time. Written
 * inline, `${styles.button} ${styles.primary}` would put the literal text
 * "undefined" in a class attribute the moment a name was misspelled - visible
 * only as a component that silently loses its styling.
 *
 * This makes that impossible and reads better than the alternative.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
