/**
 * The message contract between the main thread and the SQLite worker.
 *
 * Imported by both sides so the shapes cannot drift. Everything crossing the
 * boundary must be structured-cloneable: plain objects, primitives and
 * `Uint8Array` are, which is why `SqlValue` is defined the way it is and why
 * errors are flattened rather than thrown across.
 *
 * A worker is not a design preference here. `FileSystemSyncAccessHandle`, which
 * the OPFS SAH-pool VFS is built on, cannot be created on the main thread by
 * specification - so there is no main-thread implementation to fall back to.
 */
import type {
  BatchOp,
  BindParams,
  ExecResult,
  SerializedSqlError,
  SqlRow,
  SqlValue,
  TxMode,
} from '../driver/types';

/** Reported once at startup so the app can prove it got the storage it expects. */
export interface DatabaseDiagnostics {
  readonly sqliteVersion: string;
  readonly vfsName: string;
  readonly journalMode: string;
  readonly foreignKeys: boolean;
  readonly integrity: string;
  readonly poolCapacity: number;
  readonly poolFileCount: number;
  readonly pageCount: number;
  readonly pageSize: number;
}

export type WorkerRequest =
  | { readonly id: number; readonly kind: 'open'; readonly filename: string }
  | { readonly id: number; readonly kind: 'select'; readonly sql: string; readonly params?: BindParams }
  | { readonly id: number; readonly kind: 'selectOne'; readonly sql: string; readonly params?: BindParams }
  | { readonly id: number; readonly kind: 'selectValue'; readonly sql: string; readonly params?: BindParams }
  | { readonly id: number; readonly kind: 'exec'; readonly sql: string; readonly params?: BindParams }
  | { readonly id: number; readonly kind: 'execScript'; readonly sql: string }
  | { readonly id: number; readonly kind: 'batch'; readonly ops: readonly BatchOp[]; readonly mode: TxMode }
  | { readonly id: number; readonly kind: 'txBegin'; readonly mode: TxMode }
  | { readonly id: number; readonly kind: 'txCommit' }
  | { readonly id: number; readonly kind: 'txRollback' }
  | { readonly id: number; readonly kind: 'export' }
  | { readonly id: number; readonly kind: 'import'; readonly bytes: Uint8Array }
  | { readonly id: number; readonly kind: 'diagnostics' }
  | { readonly id: number; readonly kind: 'quarantine'; readonly label: string }
  | { readonly id: number; readonly kind: 'close' };

/**
 * A request before the client stamps an id on it.
 *
 * Written distributively on purpose: a plain `Omit<WorkerRequest, 'id'>` over a
 * union collapses to the keys every member shares, which here is nothing but
 * `kind` - so `sql`, `params` and the rest would all be rejected as unknown.
 */
export type WorkerRequestInit = WorkerRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: SerializedSqlError };

/** Maps each request kind to what it resolves to. Keeps the client honest. */
export interface WorkerResultMap {
  open: DatabaseDiagnostics;
  select: SqlRow[];
  selectOne: SqlRow | undefined;
  selectValue: SqlValue | undefined;
  exec: ExecResult;
  execScript: void;
  batch: ExecResult[];
  txBegin: void;
  txCommit: void;
  txRollback: void;
  export: Uint8Array;
  import: void;
  diagnostics: DatabaseDiagnostics;
  quarantine: string;
  close: void;
}
