/**
 * Builds a `SqlDriver` from a set of primitive operations.
 *
 * Transaction and serialization semantics live here and nowhere else, so the
 * browser (worker) driver and the in-process test driver cannot drift apart on
 * the one behavior that would be most damaging to get subtly wrong.
 */
import {
  type BatchOp,
  type BindParams,
  type ExecResult,
  type SqlDriver,
  type SqlRow,
  type SqlTx,
  type SqlValue,
  type TxMode,
  SqlError,
  toSqlError,
} from './types';

/** The engine-specific operations a driver must supply. */
export interface DriverPrimitives {
  select(sql: string, params?: BindParams): Promise<SqlRow[]>;
  selectOne(sql: string, params?: BindParams): Promise<SqlRow | undefined>;
  selectValue(sql: string, params?: BindParams): Promise<SqlValue | undefined>;
  exec(sql: string, params?: BindParams): Promise<ExecResult>;
  execScript(sql: string): Promise<void>;
  batch(ops: readonly BatchOp[], mode: TxMode): Promise<ExecResult[]>;
  begin(mode: TxMode): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  importBytes(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDriverOptions {
  /**
   * How long a `transaction()` callback may run before the transaction is rolled
   * back and the handle poisoned. Guards against a component unmounting - or an
   * awaited promise never settling - while a write lock is held, which on a
   * single-connection database would freeze every subsequent read.
   */
  readonly transactionTimeoutMs?: number;
}

const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Serializes access so a transaction cannot interleave with anything else.
 *
 * A promise chain rather than a counter: each waiter awaits the previous
 * release, so ordering is FIFO and a throw inside one holder cannot strand the
 * queue.
 */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = this.tail.then(() => next);
    await previous;
    return release;
  }
}

export function createDriver(
  primitives: DriverPrimitives,
  options: CreateDriverOptions = {},
): SqlDriver {
  const mutex = new Mutex();
  const timeoutMs = options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;

  /** Runs `fn` holding the lock, normalizing whatever it throws. */
  const locked = async <T>(sql: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const release = await mutex.acquire();
    try {
      return await fn();
    } catch (error) {
      throw toSqlError(error, sql);
    } finally {
      release();
    }
  };

  return {
    select: <T extends object = SqlRow>(sql: string, params?: BindParams) =>
      locked(sql, () => primitives.select(sql, params)) as Promise<T[]>,

    selectOne: <T extends object = SqlRow>(sql: string, params?: BindParams) =>
      locked(sql, () => primitives.selectOne(sql, params)) as Promise<T | undefined>,

    selectValue: <T extends SqlValue = SqlValue>(sql: string, params?: BindParams) =>
      locked(sql, () => primitives.selectValue(sql, params)) as Promise<T | undefined>,

    exec: (sql, params) => locked(sql, () => primitives.exec(sql, params)),

    execScript: (sql) => locked(sql, () => primitives.execScript(sql)),

    batch: (ops, mode = 'IMMEDIATE') =>
      locked(ops[0]?.sql, () => primitives.batch(ops, mode)),

    async transaction<T>(fn: (tx: SqlTx) => Promise<T>, mode: TxMode = 'IMMEDIATE'): Promise<T> {
      const release = await mutex.acquire();

      // Poisoned once the transaction settles, so a callback that outlives its
      // transaction fails loudly instead of writing outside it.
      let active = true;
      const guard = <A extends unknown[], R>(op: (...args: A) => Promise<R>) => {
        return (...args: A): Promise<R> => {
          if (!active) {
            return Promise.reject(
              new SqlError({
                name: 'TransactionClosed',
                message:
                  'This transaction has already finished. A callback kept a reference to the ' +
                  'transaction handle and used it after commit, rollback or timeout.',
              }),
            );
          }
          return op(...args);
        };
      };

      const tx: SqlTx = {
        select: guard(primitives.select) as SqlTx['select'],
        selectOne: guard(primitives.selectOne) as SqlTx['selectOne'],
        selectValue: guard(primitives.selectValue) as SqlTx['selectValue'],
        exec: guard(primitives.exec),
        execScript: guard(primitives.execScript),
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          active = false;
          reject(
            new SqlError({
              name: 'TransactionTimeout',
              message:
                `Transaction exceeded ${timeoutMs}ms and was rolled back. Long-running work ` +
                `must not hold a write lock on a single-connection database.`,
            }),
          );
        }, timeoutMs);
      });

      try {
        await primitives.begin(mode);
        let result: T;
        try {
          result = await Promise.race([fn(tx), timeout]);
        } catch (error) {
          active = false;
          // Rollback failure must not mask the error that caused it.
          await primitives.rollback().catch(() => undefined);
          throw toSqlError(error);
        }
        active = false;
        await primitives.commit();
        return result;
      } catch (error) {
        throw toSqlError(error);
      } finally {
        active = false;
        if (timer !== undefined) clearTimeout(timer);
        release();
      }
    },

    exportBytes: () => locked(undefined, () => primitives.exportBytes()),
    importBytes: (bytes) => locked(undefined, () => primitives.importBytes(bytes)),
    close: () => locked(undefined, () => primitives.close()),
  };
}
