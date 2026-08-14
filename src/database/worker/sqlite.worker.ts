/// <reference lib="webworker" />
/**
 * The SQLite worker. Owns the only database connection in the browser.
 *
 * It runs off the main thread out of necessity, not preference: the OPFS
 * SAH-pool VFS is built on `FileSystemSyncAccessHandle`, which cannot be created
 * on the main thread. The welcome side effect is that a scan over tens of
 * thousands of catalog rows never blocks rendering.
 *
 * Storage choice, stated here because it is the single most consequential
 * decision in the data layer: this uses `opfs-sahpool`, NOT the `opfs` VFS.
 * The `opfs` VFS bridges synchronous SQLite calls to asynchronous OPFS through
 * `Atomics.wait` on a `SharedArrayBuffer`, which requires COOP/COEP response
 * headers - headers a static host cannot set. Choosing it would produce an app
 * that works perfectly in development and fails for every real user.
 * `installOpfsSAHPoolVfs` pre-opens sync handles instead, needs no headers, and
 * is durable. The assertion below exists to keep it that way.
 */
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import { initSqlite } from '../driver/sqlite-init';
import { createOo1Core, type Oo1Core } from '../driver/oo1-core';
import { serializeSqlError } from '../driver/types';
import type { DatabaseDiagnostics, WorkerRequest, WorkerResponse } from './protocol';

/** Registered VFS name. Anything else means the storage assumption broke. */
const EXPECTED_VFS = 'opfs-sahpool';

/** OPFS directory owned entirely by the VFS. Nothing else may be written here. */
const POOL_DIRECTORY = '.stock-guardian';

/**
 * The pool opens and holds one file per slot. One database needs a slot for
 * itself plus one for its rollback journal; exports and temporary files need
 * more. The library default of 6 runs out at an confusing moment (a SQLITE_FULL
 * mid-import), so start comfortably above it.
 */
const INITIAL_CAPACITY = 12;

interface OpenState {
  readonly sqlite3: Sqlite3Static;
  readonly db: Database;
  readonly core: Oo1Core;
  readonly poolUtil: PoolUtil;
  readonly filename: string;
}

/** Only the pool members this file uses, so the engine type stays contained. */
interface PoolUtil {
  readonly vfsName: string;
  OpfsSAHPoolDb: new (filename: string) => Database;
  getCapacity: () => number;
  getFileCount: () => number;
  exportFile: (filename: string) => Promise<Uint8Array>;
  importDb: (name: string, data: Uint8Array) => Promise<number>;
  reserveMinimumCapacity: (minCapacity: number) => Promise<number>;
}

let state: OpenState | undefined;

function requireOpen(): OpenState {
  if (state === undefined) {
    throw new Error('The database is not open. Send an "open" request first.');
  }
  return state;
}

async function open(filename: string): Promise<DatabaseDiagnostics> {
  if (state !== undefined) return diagnostics();

  const sqlite3 = await initSqlite({
    // Points the Emscripten glue at the Vite-emitted asset. Without this it
    // resolves relative to import.meta.url, which is node_modules at build time.
    locateFile: () => wasmUrl,
    print: () => undefined,
    printErr: () => undefined,
  });

  const poolUtil = (await sqlite3.installOpfsSAHPoolVfs({
    directory: POOL_DIRECTORY,
    initialCapacity: INITIAL_CAPACITY,
    // NEVER true outside a test. It wipes every database in the pool.
    clearOnInit: false,
  })) as unknown as PoolUtil;

  if (poolUtil.vfsName !== EXPECTED_VFS) {
    throw new Error(
      `Expected the "${EXPECTED_VFS}" VFS but got "${poolUtil.vfsName}". Stock Guardian ` +
        `depends on this VFS because it is durable without cross-origin isolation headers.`,
    );
  }

  const db = new poolUtil.OpfsSAHPoolDb(filename);

  db.exec(`
    PRAGMA journal_mode = TRUNCATE;
    PRAGMA synchronous  = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store   = MEMORY;
  `);

  // WAL is impossible on this VFS - it implements no xShm* methods - and
  // `PRAGMA journal_mode = WAL` fails *silently* rather than erroring. Read the
  // mode back so a future edit cannot quietly cost us crash safety.
  const journalMode = String(db.selectValue('PRAGMA journal_mode') ?? '').toLowerCase();
  if (journalMode !== 'truncate') {
    db.close();
    throw new Error(
      `Expected journal_mode "truncate" but the database reports "${journalMode}". ` +
        `The OPFS SAH-pool VFS cannot support WAL.`,
    );
  }

  state = { sqlite3, db, core: createOo1Core(sqlite3, db), poolUtil, filename };
  return diagnostics();
}

function diagnostics(): DatabaseDiagnostics {
  const { sqlite3, db, poolUtil } = requireOpen();
  return {
    sqliteVersion: sqlite3.version.libVersion,
    vfsName: poolUtil.vfsName,
    journalMode: String(db.selectValue('PRAGMA journal_mode') ?? ''),
    foreignKeys: db.selectValue('PRAGMA foreign_keys') === 1,
    // quick_check skips the expensive cross-index verification; it is fast
    // enough to run on every boot, which is what makes corruption detectable
    // before the user has a chance to write on top of it.
    integrity: String(db.selectValue('PRAGMA quick_check(1)') ?? 'unknown'),
    poolCapacity: Number(poolUtil.getCapacity()),
    poolFileCount: Number(poolUtil.getFileCount()),
    pageCount: Number(db.selectValue('PRAGMA page_count') ?? 0),
    pageSize: Number(db.selectValue('PRAGMA page_size') ?? 0),
  };
}

/**
 * Copies the current database bytes to a plain OPFS file outside the pool.
 *
 * Used by the corruption recovery ladder. A damaged database is usually mostly
 * readable, so it is quarantined and kept - never deleted - before anything else
 * is attempted.
 */
async function quarantine(label: string): Promise<string> {
  const { poolUtil, filename } = requireOpen();
  const bytes = await poolUtil.exportFile(filename);

  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('stock-guardian-backups', { create: true });
  const name = `${label}.sqlite3`;
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  // Copy into a plain ArrayBuffer: the exported view may be backed by the WASM
  // heap, which the filesystem write API does not accept directly.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  await writable.write(buffer);
  await writable.close();
  return `stock-guardian-backups/${name}`;
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.kind) {
    case 'open':
      return open(request.filename);
    case 'select':
      return requireOpen().core.select(request.sql, request.params);
    case 'selectOne':
      return requireOpen().core.selectOne(request.sql, request.params);
    case 'selectValue':
      return requireOpen().core.selectValue(request.sql, request.params);
    case 'exec':
      return requireOpen().core.exec(request.sql, request.params);
    case 'execScript':
      return requireOpen().core.execScript(request.sql);
    case 'batch':
      return requireOpen().core.batch(request.ops, request.mode);
    case 'txBegin':
      return requireOpen().core.begin(request.mode);
    case 'txCommit':
      return requireOpen().core.commit();
    case 'txRollback':
      return requireOpen().core.rollback();
    case 'export': {
      const { poolUtil, filename } = requireOpen();
      // Pool files carry a 4 KB VFS header and are NOT valid standalone SQLite
      // files, so backups must go through exportFile - never a raw OPFS copy.
      return poolUtil.exportFile(filename);
    }
    case 'import': {
      const current = requireOpen();
      // Reserve slots first: importing needs room for the incoming image
      // alongside the existing one, and running out mid-import is unrecoverable.
      await current.poolUtil.reserveMinimumCapacity(INITIAL_CAPACITY);
      current.db.close();
      state = undefined;
      await current.poolUtil.importDb(current.filename, request.bytes);
      const db = new current.poolUtil.OpfsSAHPoolDb(current.filename);
      db.exec(`
        PRAGMA journal_mode = TRUNCATE;
        PRAGMA synchronous  = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
      `);
      state = {
        sqlite3: current.sqlite3,
        db,
        core: createOo1Core(current.sqlite3, db),
        poolUtil: current.poolUtil,
        filename: current.filename,
      };
      return undefined;
    }
    case 'diagnostics':
      return diagnostics();
    case 'quarantine':
      return quarantine(request.label);
    case 'close': {
      const current = state;
      state = undefined;
      current?.db.close();
      return undefined;
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const reply = (response: WorkerResponse) => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
  };

  void handle(request).then(
    (value) => {
      reply({ id: request.id, ok: true, value });
    },
    (error: unknown) => {
      const sql = 'sql' in request && typeof request.sql === 'string' ? request.sql : undefined;
      reply({ id: request.id, ok: false, error: serializeSqlError(error, sql) });
    },
  );
});
