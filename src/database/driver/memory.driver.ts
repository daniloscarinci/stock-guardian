/**
 * In-process `SqlDriver` backed by `:memory:`.
 *
 * TEST-ONLY. It is never imported by application code, so it never reaches the
 * production bundle.
 *
 * This uses the *same* sqlite-wasm build as the browser driver, which is the
 * whole point: collation, type affinity, FTS tokenization and `ON CONFLICT`
 * behavior are bit-for-bit identical to what ships. Tests exercise production
 * SQL, not an approximation of it.
 */
import { join } from 'node:path';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { createOo1Core, type Oo1Core } from './oo1-core';
import { createDriver } from './create-driver';
import { initSqlite } from './sqlite-init';
import type { SqlDriver } from './types';

let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/** The WASM module is expensive to instantiate; share one per process. */
function getSqlite3(): Promise<Sqlite3Static> {
  sqlite3Promise ??= initSqlite({
    /*
     * Stated rather than left to the glue's own guess.
     *
     * Emscripten resolves the binary against the script's own URL. In a test
     * file that asks for a DOM - the interface tests do - that URL is the
     * runner's `http://localhost:3000/...`, and the loader then tries to read
     * an http URL off the filesystem and aborts. The package's location under
     * the project root is a fact this driver can simply state, and in a plain
     * Node test it resolves to exactly the file the guess would have found.
     */
    locateFile: (file) =>
      join(process.cwd(), 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist', file),
    print: () => undefined,
    printErr: () => undefined,
  });
  return sqlite3Promise;
}

export interface MemoryDriverOptions {
  /** Skipped by tests that deliberately exercise foreign-key violations. */
  readonly foreignKeys?: boolean;
}

export async function createMemoryDriver(options: MemoryDriverOptions = {}): Promise<SqlDriver> {
  const sqlite3 = await getSqlite3();
  const db = new sqlite3.oo1.DB(':memory:', 'c');

  db.exec(`
    PRAGMA foreign_keys = ${options.foreignKeys === false ? 'OFF' : 'ON'};
    PRAGMA temp_store = MEMORY;
  `);

  let core: Oo1Core = createOo1Core(sqlite3, db);

  return createDriver({
    select: async (sql, params) => core.select(sql, params),
    selectOne: async (sql, params) => core.selectOne(sql, params),
    selectValue: async (sql, params) => core.selectValue(sql, params),
    exec: async (sql, params) => core.exec(sql, params),
    execScript: async (sql) => core.execScript(sql),
    batch: async (ops, mode) => core.batch(ops, mode),
    begin: async (mode) => core.begin(mode),
    commit: async () => core.commit(),
    rollback: async () => core.rollback(),
    exportBytes: async () => core.exportBytes(),

    importBytes: async (bytes) => {
      const pointer = db.pointer;
      if (pointer === undefined) throw new Error('Database is closed');
      // `sqlite3_deserialize` takes ownership of WASM-side memory; FREEONCLOSE
      // hands the lifetime to SQLite, RESIZEABLE lets the image grow afterwards.
      const buffer = sqlite3.wasm.allocFromTypedArray(bytes);
      const rc = sqlite3.capi.sqlite3_deserialize(
        pointer,
        'main',
        buffer,
        bytes.byteLength,
        bytes.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      );
      if (rc !== 0) {
        throw Object.assign(new Error(`sqlite3_deserialize failed (rc=${String(rc)})`), {
          resultCode: rc,
        });
      }
      core = createOo1Core(sqlite3, db);
    },

    close: async () => core.close(),
  });
}
