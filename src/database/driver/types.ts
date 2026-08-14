/**
 * The single seam between application logic and the storage engine.
 *
 * Two implementations satisfy this contract and must stay interchangeable:
 *
 *   - `wasm/` runs SQLite compiled to WebAssembly in a Web Worker, persisting to
 *     OPFS. This is what ships in the browser and the PWA.
 *   - `memory.driver.ts` runs the same WASM build in-process against `:memory:`.
 *     Tests use it, so the SQL under test is byte-for-byte the production SQL.
 *
 * A future Tauri desktop build adds a third against native SQLite. Because every
 * repository and migration is written against this interface alone, adding it
 * costs a driver file and nothing else.
 *
 * WHAT MUST NEVER APPEAR IN THIS FILE:
 *   - Engine types: `sqlite3.oo1.DB`, `PreparedStatement`, Emscripten pointers,
 *     `rusqlite`/`sqlx` types, Tauri `invoke`.
 *   - Transport types: `Worker`, `MessagePort`, `Transferable`, `postMessage`.
 *   - Statement lifecycle: no `prepare()`/`finalize()`. Statement caching is a
 *     driver-internal concern; exposing handles would leak lifetimes across the
 *     worker boundary.
 *
 * Every method returns a Promise even though native SQLite is synchronous. This
 * is deliberate and load-bearing: a synchronous interface cannot be implemented
 * over a worker, and OPFS makes a worker mandatory. Retrofitting async later
 * would mean touching every call site in the application.
 */

/**
 * The value types that cross the driver boundary.
 *
 * `bigint` is deliberately absent. Both engines can produce it for large
 * INTEGER values, and allowing it would mean every consumer handles two numeric
 * types. The application rule that makes this safe: no value stored in an
 * INTEGER column may exceed 2^53. Identifiers are TEXT slugs or UUIDs, which
 * also makes de-duplication on import straightforward.
 */
export type SqlValue = null | number | string | Uint8Array;

/**
 * Positional (`?`) or named (`:name`) parameters only.
 *
 * `$1`-style placeholders are forbidden. They are what `@tauri-apps/plugin-sql`
 * uses, and permitting them would fracture the one-set-of-SQL rule the moment a
 * desktop driver is added.
 */
export type BindParams = readonly SqlValue[] | Readonly<Record<string, SqlValue>>;

/** A row as it leaves the engine, before a repository maps it to a domain type. */
export type SqlRow = Record<string, SqlValue>;

export interface ExecResult {
  readonly rowsAffected: number;
  readonly lastInsertRowId: number;
}

export interface BatchOp {
  readonly sql: string;
  readonly params?: BindParams;
}

/**
 * `DEFERRED` takes the write lock lazily; `IMMEDIATE` takes it up front.
 * Prefer `IMMEDIATE` for anything that will write, so a conflict surfaces at
 * BEGIN rather than at COMMIT after the work is already done.
 */
export type TxMode = 'DEFERRED' | 'IMMEDIATE';

/**
 * The read/write surface available both standalone and inside a transaction.
 *
 * The `T` on the select methods is a compile-time convenience, not a runtime
 * guarantee - nothing validates it. Repositories are required to own an explicit
 * mapper from the row shape to the domain type, which is where snake_case
 * becomes camelCase and SQL NULLs become domain values.
 */
export interface SqlRunner {
  select<T extends object = SqlRow>(sql: string, params?: BindParams): Promise<T[]>;
  selectOne<T extends object = SqlRow>(sql: string, params?: BindParams): Promise<T | undefined>;
  selectValue<T extends SqlValue = SqlValue>(sql: string, params?: BindParams): Promise<T | undefined>;
  exec(sql: string, params?: BindParams): Promise<ExecResult>;
  /** Multi-statement script with no parameters. Migrations and pragmas only. */
  execScript(sql: string): Promise<void>;
}

/**
 * The handle passed into a transaction callback.
 *
 * Deliberately narrower than `SqlDriver`: SQLite has no nested transactions, so
 * making `transaction()` and `close()` unreachable inside a callback turns a
 * runtime failure into a compile error.
 */
export type SqlTx = SqlRunner;

export interface SqlDriver extends SqlRunner {
  /**
   * Read-then-decide work that cannot be expressed as a flat list of statements.
   * Serialized against all other driver access: only one may be open at a time.
   *
   * Prefer `batch()` where the statements are known up front - it cannot leave a
   * transaction dangling across an `await`.
   */
  transaction<T>(fn: (tx: SqlTx) => Promise<T>, mode?: TxMode): Promise<T>;

  /**
   * The default write path: one round trip, one synchronous engine-side
   * transaction, atomic by construction.
   */
  batch(ops: readonly BatchOp[], mode?: TxMode): Promise<ExecResult[]>;

  /** Raw database bytes, for backup. Bytes, never a driver-specific handle. */
  exportBytes(): Promise<Uint8Array>;
  /** Replace the database contents. Destructive; callers must confirm first. */
  importBytes(bytes: Uint8Array): Promise<void>;

  close(): Promise<void>;
}

/** SQLite primary result codes this application reasons about by name. */
export const SQLITE_CORRUPT = 11;
export const SQLITE_NOTADB = 26;
export const SQLITE_FULL = 13;
export const SQLITE_CONSTRAINT = 19;
export const SQLITE_BUSY = 5;

/**
 * A driver error, normalized across engines.
 *
 * Structured clone drops custom properties on Error subclasses, so the worker
 * serializes to `SerializedSqlError` and the main thread rehydrates here. That
 * rebuild is what makes the stack trace point at the calling repository rather
 * than at the message handler.
 */
export interface SerializedSqlError {
  readonly name: string;
  readonly message: string;
  /** Raw SQLite result code, possibly an extended code such as 1555. */
  readonly code?: number;
  readonly sql?: string;
  readonly workerStack?: string;
}

export class SqlError extends Error {
  readonly detail: SerializedSqlError;

  constructor(detail: SerializedSqlError) {
    super(detail.message);
    this.name = 'SqlError';
    this.detail = detail;
    if (detail.workerStack) {
      this.stack = `${this.stack ?? ''}\nCaused by (worker):\n${detail.workerStack}`;
    }
  }

  /**
   * The primary result code.
   *
   * SQLite returns *extended* codes such as 1555 (SQLITE_CONSTRAINT_PRIMARYKEY);
   * the low byte carries the primary code (19, SQLITE_CONSTRAINT). Comparing an
   * extended code directly against a primary constant silently never matches,
   * which is exactly how a corruption check ends up never firing.
   */
  get primaryCode(): number | undefined {
    return this.detail.code === undefined ? undefined : this.detail.code & 0xff;
  }

  /** True when the database file itself is damaged - triggers the recovery ladder. */
  get isCorruption(): boolean {
    const code = this.primaryCode;
    return code === SQLITE_CORRUPT || code === SQLITE_NOTADB;
  }

  get isConstraintViolation(): boolean {
    return this.primaryCode === SQLITE_CONSTRAINT;
  }

  get isStorageFull(): boolean {
    return this.primaryCode === SQLITE_FULL;
  }
}

/** Normalizes anything thrown by an engine into a serializable shape. */
export function serializeSqlError(error: unknown, sql?: string): SerializedSqlError {
  const e = error as { name?: string; message?: string; resultCode?: number; stack?: string };
  return {
    name: typeof e?.name === 'string' ? e.name : 'Error',
    message: typeof e?.message === 'string' ? e.message : String(error),
    ...(typeof e?.resultCode === 'number' ? { code: e.resultCode } : {}),
    ...(sql === undefined ? {} : { sql }),
    ...(typeof e?.stack === 'string' ? { workerStack: e.stack } : {}),
  };
}

/** Wraps an unknown throw as a `SqlError` without losing an existing one. */
export function toSqlError(error: unknown, sql?: string): SqlError {
  return error instanceof SqlError ? error : new SqlError(serializeSqlError(error, sql));
}
