/**
 * Main-thread `SqlDriver` backed by the SQLite worker.
 *
 * Holds no SQL knowledge of its own - it is a transport. Transaction semantics
 * live in `createDriver`, shared with the in-process test driver, so the two
 * cannot diverge on the behavior that would be most damaging to get wrong.
 */
import { createDriver } from '../driver/create-driver';
import { SqlError, type ExecResult, type SqlDriver, type SqlRow, type SqlValue } from '../driver/types';
import type {
  DatabaseDiagnostics,
  WorkerRequest,
  WorkerRequestInit,
  WorkerResponse,
} from './protocol';

export const DATABASE_FILENAME = '/stock-guardian.sqlite3';

/** Thrown when the environment cannot durably store anything. */
export class InsecureContextError extends Error {
  constructor() {
    super(
      'Stock Guardian needs a secure context (https:// or localhost) to store data on this ' +
        'device. Opened directly from a file, browsers grant no persistent storage, so ' +
        'everything you entered would be lost without warning.',
    );
    this.name = 'InsecureContextError';
  }
}

/** Thrown when another tab already holds the single database connection. */
export class DatabaseLockedError extends Error {
  constructor(cause: string) {
    super(
      'Stock Guardian is already open in another tab or window. It keeps a single ' +
        'connection to your data so two copies can never overwrite each other. Close the ' +
        'other tab and reload this one.',
    );
    this.name = 'DatabaseLockedError';
    this.cause = cause;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface OpenDatabase {
  readonly driver: SqlDriver;
  readonly diagnostics: DatabaseDiagnostics;
  readonly quarantine: (label: string) => Promise<string>;
  readonly refreshDiagnostics: () => Promise<DatabaseDiagnostics>;
}

export async function openDatabase(filename = DATABASE_FILENAME): Promise<OpenDatabase> {
  if (!self.isSecureContext) throw new InsecureContextError();

  const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), {
    type: 'module',
    name: 'stock-guardian-sqlite',
  });

  const pending = new Map<number, Pending>();
  let nextId = 1;
  let dead: SqlError | undefined;

  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (entry === undefined) return;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.value);
    else entry.reject(new SqlError(response.error));
  });

  /**
   * Without this, a worker crash (an uncaught throw, an out-of-memory kill)
   * leaves every in-flight promise unresolved and the interface spins forever
   * with no error anyone can act on.
   */
  const killAll = (message: string) => {
    dead = new SqlError({ name: 'WorkerCrash', message });
    for (const entry of pending.values()) entry.reject(dead);
    pending.clear();
  };
  worker.addEventListener('error', (event: ErrorEvent) => {
    killAll(event.message || 'The database worker stopped unexpectedly.');
  });
  worker.addEventListener('messageerror', () => {
    killAll('The database worker sent a message that could not be read.');
  });

  const send = <T>(request: WorkerRequestInit): Promise<T> => {
    if (dead !== undefined) return Promise.reject(dead);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as Pending['resolve'], reject });
      worker.postMessage({ ...request, id } as WorkerRequest);
    });
  };

  let diagnostics: DatabaseDiagnostics;
  try {
    diagnostics = await send<DatabaseDiagnostics>({ kind: 'open', filename });
  } catch (error) {
    worker.terminate();
    const message = error instanceof Error ? error.message : String(error);
    // The SAH pool allows exactly one connection; a second tab fails to acquire
    // the sync access handles rather than silently sharing them.
    if (/sync access handle|NoModificationAllowed|already.*lock/i.test(message)) {
      throw new DatabaseLockedError(message);
    }
    throw error;
  }

  const driver = createDriver({
    select: (sql, params) => send<SqlRow[]>({ kind: 'select', sql, ...(params ? { params } : {}) }),
    selectOne: (sql, params) =>
      send<SqlRow | undefined>({ kind: 'selectOne', sql, ...(params ? { params } : {}) }),
    selectValue: (sql, params) =>
      send<SqlValue | undefined>({ kind: 'selectValue', sql, ...(params ? { params } : {}) }),
    exec: (sql, params) => send<ExecResult>({ kind: 'exec', sql, ...(params ? { params } : {}) }),
    execScript: (sql) => send<void>({ kind: 'execScript', sql }),
    batch: (ops, mode) => send<ExecResult[]>({ kind: 'batch', ops, mode }),
    begin: (mode) => send<void>({ kind: 'txBegin', mode }),
    commit: () => send<void>({ kind: 'txCommit' }),
    rollback: () => send<void>({ kind: 'txRollback' }),
    exportBytes: () => send<Uint8Array>({ kind: 'export' }),
    importBytes: (bytes) => send<void>({ kind: 'import', bytes }),
    close: async () => {
      await send<void>({ kind: 'close' });
      worker.terminate();
    },
  });

  return {
    driver,
    diagnostics,
    quarantine: (label) => send<string>({ kind: 'quarantine', label }),
    refreshDiagnostics: () => send<DatabaseDiagnostics>({ kind: 'diagnostics' }),
  };
}
