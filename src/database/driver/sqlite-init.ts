/**
 * The one place the project passes Emscripten module-loading options.
 *
 * The published types declare `init(): Promise<Sqlite3Static>` with no
 * parameters, and that omission is deliberate on the maintainers' part - they
 * state they cannot guarantee stability for Emscripten-specific loading
 * arguments (sqlite/sqlite-wasm#129).
 *
 * We need exactly two of them:
 *
 *   - `locateFile`, to point at the Vite-emitted `sqlite3.wasm` asset. Without
 *     it the glue resolves the binary relative to `import.meta.url`, which
 *     points into node_modules at build time and 404s in production. There is
 *     no supported alternative.
 *   - `print`/`printErr`, to keep expected SQL errors off the console.
 *
 * Containing the cast here means the unsupported surface is one small, commented
 * file rather than something scattered across drivers. If a future release
 * breaks `locateFile`, the browser smoke test fails and this is the only file
 * that needs to change - the fallback being to copy the binary into `public/`
 * and serve it from a fixed path.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

export interface SqliteInitOptions {
  /** Resolves the runtime path of `sqlite3.wasm`. */
  readonly locateFile?: (path: string, scriptDirectory: string) => string;
  readonly print?: (message: string) => void;
  readonly printErr?: (message: string) => void;
}

type InitWithOptions = (options?: SqliteInitOptions) => Promise<Sqlite3Static>;

export function initSqlite(options?: SqliteInitOptions): Promise<Sqlite3Static> {
  return (sqlite3InitModule as unknown as InitWithOptions)(options);
}
