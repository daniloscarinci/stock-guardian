/**
 * Vitest setup. Kept deliberately thin - anything that silently changes global
 * behavior here makes tests lie about production.
 */

// The sqlite-wasm Node build is chatty on stderr for expected SQL errors (a
// constraint violation prints `sqlite3_step() rc=...` before throwing). Tests
// assert on the thrown error, so the noise only obscures real failures.
const originalError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.startsWith('sqlite3_step() rc=')) return;
  originalError(...args);
};
