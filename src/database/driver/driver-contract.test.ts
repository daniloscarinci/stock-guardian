/**
 * The SqlDriver contract.
 *
 * Every driver must pass this suite unchanged. It is written against the
 * interface, never against an engine, so when the Tauri native driver is added
 * it inherits a complete behavioral specification rather than a hopeful one.
 *
 * The transaction cases matter most. A driver that silently commits partial work
 * when a callback throws would corrupt inventory in a way no user could detect,
 * so those assertions are the reason this file exists.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from './memory.driver';
import { SqlError, type SqlDriver } from './types';

export function describeDriverContract(name: string, makeDriver: () => Promise<SqlDriver>): void {
  describe(`SqlDriver contract: ${name}`, () => {
    let db: SqlDriver;

    beforeEach(async () => {
      db = await makeDriver();
      await db.execScript(`
        CREATE TABLE item (
          id   TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          qty  REAL NOT NULL DEFAULT 0,
          blob BLOB
        );
      `);
    });

    afterEach(async () => {
      await db.close().catch(() => undefined);
    });

    const insert = (id: string, qty = 1) =>
      db.exec('INSERT INTO item (id, name, qty) VALUES (?, ?, ?)', [id, `name-${id}`, qty]);

    const countItems = async () => (await db.selectValue<number>('SELECT count(*) FROM item')) ?? 0;

    describe('reads', () => {
      it('returns rows as plain objects', async () => {
        await insert('a');
        const rows = await db.select<{ id: string; name: string; qty: number }>(
          'SELECT id, name, qty FROM item',
        );
        expect(rows).toEqual([{ id: 'a', name: 'name-a', qty: 1 }]);
      });

      it('returns an empty array rather than throwing when nothing matches', async () => {
        expect(await db.select('SELECT id FROM item WHERE id = ?', ['missing'])).toEqual([]);
      });

      it('selectOne yields undefined when nothing matches', async () => {
        expect(await db.selectOne('SELECT id FROM item WHERE id = ?', ['missing'])).toBeUndefined();
      });

      it('selectValue yields the first column of the first row', async () => {
        await insert('a', 7);
        expect(await db.selectValue<number>('SELECT qty FROM item WHERE id = ?', ['a'])).toBe(7);
      });

      it('binds named parameters written with the colon', async () => {
        await insert('a');
        const row = await db.selectOne<{ id: string }>('SELECT id FROM item WHERE id = :id', {
          ':id': 'a',
        });
        expect(row?.id).toBe('a');
      });

      it('binds named parameters written without the colon', async () => {
        // Writing `{ id }` is the natural thing to do and the engine rejects it
        // outright; the driver adds the sigil so no call site has to remember.
        await insert('a');
        const row = await db.selectOne<{ id: string }>('SELECT id FROM item WHERE id = :id', {
          id: 'a',
        });
        expect(row?.id).toBe('a');
      });

      it('ignores an empty parameter object', async () => {
        await insert('a');
        expect(await db.select('SELECT id FROM item', {})).toHaveLength(1);
      });

      it('round-trips a BLOB as Uint8Array', async () => {
        const bytes = new Uint8Array([0, 1, 2, 250, 255]);
        await db.exec('INSERT INTO item (id, name, blob) VALUES (?, ?, ?)', ['b', 'n', bytes]);
        const row = await db.selectOne<{ blob: Uint8Array }>('SELECT blob FROM item WHERE id = ?', [
          'b',
        ]);
        expect(row?.blob).toBeInstanceOf(Uint8Array);
        expect(Array.from(row?.blob ?? [])).toEqual([0, 1, 2, 250, 255]);
      });

      it('preserves NULL as null', async () => {
        await insert('a');
        const row = await db.selectOne<{ blob: null }>('SELECT blob FROM item WHERE id = ?', ['a']);
        expect(row?.blob).toBeNull();
      });
    });

    describe('writes', () => {
      it('reports rows affected', async () => {
        await insert('a');
        await insert('b');
        const result = await db.exec('UPDATE item SET qty = qty + 1');
        expect(result.rowsAffected).toBe(2);
      });

      it('runs every statement in a script', async () => {
        await db.execScript(`
          INSERT INTO item (id, name) VALUES ('x', 'x');
          INSERT INTO item (id, name) VALUES ('y', 'y');
        `);
        expect(await countItems()).toBe(2);
      });
    });

    describe('errors', () => {
      it('throws SqlError carrying the primary result code', async () => {
        await insert('a');
        const error = await insert('a').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SqlError);
        expect((error as SqlError).isConstraintViolation).toBe(true);
      });

      it('reduces an extended result code to its primary code', async () => {
        await insert('a');
        const error = (await insert('a').catch((e: unknown) => e)) as SqlError;
        // 1555 is SQLITE_CONSTRAINT_PRIMARYKEY; its primary code is 19.
        expect(error.detail.code).toBeGreaterThan(255);
        expect(error.primaryCode).toBe(19);
      });

      it('does not report an ordinary failure as corruption', async () => {
        await insert('a');
        const error = (await insert('a').catch((e: unknown) => e)) as SqlError;
        expect(error.isCorruption).toBe(false);
      });

      it('keeps the database usable after a failed statement', async () => {
        await insert('a');
        await expect(insert('a')).rejects.toThrow();
        await insert('b');
        expect(await countItems()).toBe(2);
      });
    });

    describe('batch', () => {
      it('applies every operation', async () => {
        const results = await db.batch([
          { sql: 'INSERT INTO item (id, name) VALUES (?, ?)', params: ['a', 'A'] },
          { sql: 'INSERT INTO item (id, name) VALUES (?, ?)', params: ['b', 'B'] },
        ]);
        expect(results).toHaveLength(2);
        expect(await countItems()).toBe(2);
      });

      it('rolls back every operation when one fails', async () => {
        await insert('dup');
        await expect(
          db.batch([
            { sql: 'INSERT INTO item (id, name) VALUES (?, ?)', params: ['new', 'N'] },
            { sql: 'INSERT INTO item (id, name) VALUES (?, ?)', params: ['dup', 'D'] },
          ]),
        ).rejects.toThrow();

        // The first insert must NOT have survived.
        expect(await countItems()).toBe(1);
        expect(await db.selectOne('SELECT id FROM item WHERE id = ?', ['new'])).toBeUndefined();
      });

      it('accepts an empty operation list', async () => {
        expect(await db.batch([])).toEqual([]);
      });
    });

    describe('transaction', () => {
      it('commits and returns the callback value', async () => {
        const returned = await db.transaction(async (tx) => {
          await tx.exec('INSERT INTO item (id, name) VALUES (?, ?)', ['a', 'A']);
          return 'done';
        });
        expect(returned).toBe('done');
        expect(await countItems()).toBe(1);
      });

      it('rolls back AND rethrows when the callback throws', async () => {
        await expect(
          db.transaction(async (tx) => {
            await tx.exec('INSERT INTO item (id, name) VALUES (?, ?)', ['a', 'A']);
            throw new Error('BOOM');
          }),
        ).rejects.toThrow('BOOM');

        expect(await countItems()).toBe(0);
      });

      it('rolls back when a statement inside fails', async () => {
        await insert('dup');
        await expect(
          db.transaction(async (tx) => {
            await tx.exec('INSERT INTO item (id, name) VALUES (?, ?)', ['new', 'N']);
            await tx.exec('INSERT INTO item (id, name) VALUES (?, ?)', ['dup', 'D']);
          }),
        ).rejects.toThrow();
        expect(await countItems()).toBe(1);
      });

      it('sees its own uncommitted writes', async () => {
        await db.transaction(async (tx) => {
          await tx.exec('INSERT INTO item (id, name) VALUES (?, ?)', ['a', 'A']);
          expect(await tx.selectValue<number>('SELECT count(*) FROM item')).toBe(1);
        });
      });

      it('rejects use of the handle after the transaction settles', async () => {
        let escaped!: Parameters<Parameters<SqlDriver['transaction']>[0]>[0];
        await db.transaction(async (tx) => {
          escaped = tx;
        });
        await expect(escaped.exec('INSERT INTO item (id, name) VALUES (?, ?)', ['x', 'X'])).rejects.toThrow(
          /already finished/,
        );
        expect(await countItems()).toBe(0);
      });

      it('DDL inside a transaction rolls back', async () => {
        await expect(
          db.transaction(async (tx) => {
            await tx.execScript('CREATE TABLE probe (x TEXT)');
            throw new Error('BOOM');
          }),
        ).rejects.toThrow('BOOM');

        const tables = await db.selectValue<number>(
          "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='probe'",
        );
        expect(tables).toBe(0);
      });

      it('serializes against concurrent operations', async () => {
        // The write inside the transaction must not be observable by the
        // concurrent read until the transaction commits.
        const order: string[] = [];

        const txPromise = db.transaction(async (tx) => {
          order.push('tx:start');
          await tx.exec('INSERT INTO item (id, name) VALUES (?, ?)', ['a', 'A']);
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push('tx:end');
        });

        const readPromise = countItems().then((n) => {
          order.push('read');
          return n;
        });

        const [, count] = await Promise.all([txPromise, readPromise]);
        expect(order).toEqual(['tx:start', 'tx:end', 'read']);
        expect(count).toBe(1);
      });

      it('recovers to a usable state after a rollback', async () => {
        await expect(
          db.transaction(async () => {
            throw new Error('BOOM');
          }),
        ).rejects.toThrow('BOOM');

        await insert('after');
        expect(await countItems()).toBe(1);
      });
    });

    describe('export and import', () => {
      it('round-trips the database through raw bytes', async () => {
        await insert('a');
        await insert('b');
        const bytes = await db.exportBytes();
        expect(bytes.byteLength).toBeGreaterThan(0);

        const restored = await makeDriver();
        try {
          await restored.importBytes(bytes);
          expect(await restored.selectValue<number>('SELECT count(*) FROM item')).toBe(2);
        } finally {
          await restored.close().catch(() => undefined);
        }
      });

      it('produces bytes beginning with the SQLite file header', async () => {
        const bytes = await db.exportBytes();
        const header = new TextDecoder().decode(bytes.subarray(0, 15));
        expect(header).toBe('SQLite format 3');
      });
    });
  });
}

describeDriverContract('memory', () => createMemoryDriver());
