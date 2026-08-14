/**
 * Synchronous operations over a sqlite-wasm `oo1.DB` handle.
 *
 * This is the only file in the project that touches the engine API. The worker
 * uses it (where SQLite genuinely is synchronous) and the in-process test driver
 * uses it, so both execute identical code against identical SQL.
 *
 * Everything here throws raw engine errors; normalizing them into `SqlError` is
 * the caller's job, because only the caller knows which SQL was in flight.
 */
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { BatchOp, BindParams, ExecResult, SqlRow, SqlValue, TxMode } from './types';

/**
 * The engine can hand back `bigint` for large INTEGER values. Our `SqlValue`
 * excludes it deliberately (see types.ts), so narrow here - at the single point
 * where engine values enter the application - rather than forcing every consumer
 * to handle two numeric types.
 */
function narrowValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
      throw new Error(
        `Integer ${value} exceeds the safe range. Stock Guardian stores identifiers as ` +
          `TEXT precisely so this cannot happen; an INTEGER column has grown out of range.`,
      );
    }
    return Number(value);
  }
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  throw new Error(`Unsupported value type from SQLite: ${Object.prototype.toString.call(value)}`);
}

function narrowRow(row: Record<string, unknown>): SqlRow {
  const out: SqlRow = {};
  for (const key of Object.keys(row)) out[key] = narrowValue(row[key]);
  return out;
}

/**
 * `oo1` accepts arrays and objects for binding, but an *empty* array is treated
 * as "no bindings", and passing `undefined` for a statement that has none is
 * safest. Normalize to keep behavior identical across call sites.
 */
function normalizeParams(params?: BindParams): BindParams | undefined {
  if (params === undefined) return undefined;
  if (Array.isArray(params)) return params.length === 0 ? undefined : params;
  return Object.keys(params as Record<string, SqlValue>).length === 0
    ? undefined
    : (params as BindParams);
}

export interface Oo1Core {
  select(sql: string, params?: BindParams): SqlRow[];
  selectOne(sql: string, params?: BindParams): SqlRow | undefined;
  selectValue(sql: string, params?: BindParams): SqlValue | undefined;
  exec(sql: string, params?: BindParams): ExecResult;
  execScript(sql: string): void;
  batch(ops: readonly BatchOp[], mode: TxMode): ExecResult[];
  begin(mode: TxMode): void;
  commit(): void;
  rollback(): void;
  inTransaction(): boolean;
  exportBytes(): Uint8Array;
  close(): void;
}

export function createOo1Core(sqlite3: Sqlite3Static, db: Database): Oo1Core {
  const lastInsertRowId = (): number => {
    const pointer = db.pointer;
    if (pointer === undefined) return 0;
    return Number(sqlite3.capi.sqlite3_last_insert_rowid(pointer));
  };

  const execResult = (): ExecResult => ({
    rowsAffected: Number(db.changes(false, false)),
    lastInsertRowId: lastInsertRowId(),
  });

  const runOne = (sql: string, params?: BindParams): ExecResult => {
    const bind = normalizeParams(params);
    db.exec(bind === undefined ? { sql } : { sql, bind: bind as never });
    return execResult();
  };

  return {
    select(sql, params) {
      const bind = normalizeParams(params);
      return db.selectObjects(sql, bind as never).map(narrowRow);
    },

    selectOne(sql, params) {
      const bind = normalizeParams(params);
      const row = db.selectObject(sql, bind as never);
      return row === undefined ? undefined : narrowRow(row);
    },

    selectValue(sql, params) {
      const bind = normalizeParams(params);
      const value = db.selectValue(sql, bind as never);
      return value === undefined ? undefined : narrowValue(value);
    },

    exec: runOne,

    execScript(sql) {
      // oo1 `exec` runs every statement in the string when no bindings are given.
      db.exec(sql);
    },

    batch(ops, mode) {
      // The engine's own transaction wrapper. Verified by spike to roll back and
      // rethrow when the callback throws, and to commit and return on success.
      return db.transaction(mode, () => ops.map((op) => runOne(op.sql, op.params)));
    },

    begin(mode) {
      db.exec(`BEGIN ${mode}`);
    },

    commit() {
      db.exec('COMMIT');
    },

    rollback() {
      db.exec('ROLLBACK');
    },

    inTransaction() {
      const pointer = db.pointer;
      if (pointer === undefined) return false;
      return sqlite3.capi.sqlite3_get_autocommit(pointer) === 0;
    },

    exportBytes() {
      const pointer = db.pointer;
      if (pointer === undefined) throw new Error('Database is closed');
      return sqlite3.capi.sqlite3_js_db_export(pointer);
    },

    close() {
      db.close();
    },
  };
}
