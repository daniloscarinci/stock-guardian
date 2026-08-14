/**
 * `SqlDriver` over the native desktop database.
 *
 * The desktop build talks to rusqlite through five Tauri commands rather than to
 * `tauri-plugin-sql`. The plugin has no transaction API and pools its
 * connections, so `BEGIN` issued through it gives no guarantee that the
 * following statements land on the same connection - and an import that is not
 * genuinely atomic is exactly the failure this application is built to prevent.
 * It also speaks `$1` placeholders, which would have split the one set of SQL
 * the browser and desktop builds share.
 *
 * Because transaction semantics live in `createDriver`, shared with the browser
 * and test drivers, this file is only a transport - about eighty lines. That is
 * the whole return on having put a seam at `SqlDriver` in the first place.
 *
 * NOT COMPILED IN THIS REPOSITORY. There is no Rust toolchain here, so the
 * desktop binary has never been built. See docs/BUILD.md for what to install and
 * what to check once it has been.
 */
import { createDriver } from '../driver/create-driver';
import { SqlError, type ExecResult, type SqlDriver, type SqlRow, type SqlValue } from '../driver/types';
import type { BatchOp, BindParams, TxMode } from '../driver/types';

/** The subset of the Tauri API this file needs, declared rather than imported. */
interface TauriCore {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

interface SerializedRustError {
  name?: string;
  message?: string;
  code?: number;
  sql?: string;
}

/**
 * True when running inside the desktop shell.
 *
 * The browser build must not import `@tauri-apps/api` at all - it would be dead
 * weight in a bundle that is meant to stay small - so the global is probed
 * instead.
 */
export function isTauri(): boolean {
  return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
}

async function loadCore(): Promise<TauriCore> {
  // Dynamic, so the browser bundle never pulls this in.
  const core = (await import(/* @vite-ignore */ '@tauri-apps/api/core')) as unknown as TauriCore;
  return core;
}

function toSqlError(error: unknown, sql?: string): SqlError {
  const detail = error as SerializedRustError;
  return new SqlError({
    name: detail?.name ?? 'SqlError',
    message: detail?.message ?? String(error),
    ...(typeof detail?.code === 'number' ? { code: detail.code } : {}),
    ...(sql === undefined ? {} : { sql }),
  });
}

/** Blobs cross the IPC boundary as arrays of byte values. */
function reviveRow(row: Record<string, unknown>): SqlRow {
  const out: SqlRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = Array.isArray(value) ? new Uint8Array(value as number[]) : (value as SqlValue);
  }
  return out;
}

function encodeParams(params?: BindParams): unknown {
  if (params === undefined) return null;
  const encode = (value: SqlValue) => (value instanceof Uint8Array ? Array.from(value) : value);
  if (Array.isArray(params)) return params.map(encode);
  return Object.fromEntries(
    Object.entries(params as Record<string, SqlValue>).map(([key, value]) => [key, encode(value)]),
  );
}

export async function openNativeDatabase(): Promise<SqlDriver> {
  const core = await loadCore();

  const call = async <T>(command: string, args: Record<string, unknown>, sql?: string) => {
    try {
      return await core.invoke<T>(command, args);
    } catch (error) {
      throw toSqlError(error, sql);
    }
  };

  const select = async (sql: string, params?: BindParams) =>
    (await call<Record<string, unknown>[]>('db_select', { sql, params: encodeParams(params) }, sql)).map(
      reviveRow,
    );

  return createDriver({
    select,
    selectOne: async (sql, params) => (await select(sql, params))[0],
    selectValue: async (sql, params) => {
      const row = (await select(sql, params))[0];
      return row === undefined ? undefined : (Object.values(row)[0] ?? null);
    },
    exec: (sql, params) => call<ExecResult>('db_exec', { sql, params: encodeParams(params) }, sql),
    execScript: (sql) => call<void>('db_exec_script', { sql }, sql),
    batch: (ops: readonly BatchOp[], mode: TxMode) =>
      call<ExecResult[]>('db_batch', {
        ops: ops.map((op) => ({ sql: op.sql, params: encodeParams(op.params) })),
        mode,
      }),

    // The native side has a real connection, so BEGIN/COMMIT are ordinary
    // statements on it - no message protocol needed, unlike the worker driver.
    begin: (mode) => call<void>('db_exec_script', { sql: `BEGIN ${mode}` }),
    commit: () => call<void>('db_exec_script', { sql: 'COMMIT' }),
    rollback: () => call<void>('db_exec_script', { sql: 'ROLLBACK' }),

    exportBytes: async () => new Uint8Array(await call<number[]>('db_export', {})),
    importBytes: () => {
      // Deliberately unimplemented rather than silently doing nothing: restoring
      // by replacing the file underneath an open connection needs the app to
      // close and reopen it, which is a desktop-shell concern. Until that exists,
      // restore on desktop goes through the JSON backup path like everything else.
      return Promise.reject(
        new SqlError({
          name: 'NotSupported',
          message:
            'Restoring raw database bytes is not available in the desktop build. Use the JSON ' +
            'backup, which restores the same data through the normal import path.',
        }),
      );
    },
    close: () => Promise.resolve(),
  });
}
