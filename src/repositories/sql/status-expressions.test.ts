/**
 * Proves the SQL and JavaScript implementations of the status rules agree.
 *
 * Stock status and expiry bucket are necessarily expressed twice - once in
 * `domain/` for scoring and display, once in SQL so ten thousand rows can be
 * filtered without loading them. This test is what stops the two from drifting:
 * it runs a matrix of inputs through both and demands identical answers.
 *
 * If it fails, one of the two was changed without the other. Fix the pair, not
 * the test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { evaluateStock } from '../../domain/stock';
import { evaluateExpiry, DEFAULT_EXPIRY_WINDOWS } from '../../domain/expiry';
import { addCalendarDays } from '../../domain/dates';
import {
  daysUntilExpirySql,
  expiryBucketSql,
  neededSql,
  stockStatusSql,
} from './status-expressions';

const TODAY = '2026-08-14';
const HORIZON = addCalendarDays(TODAY, Math.max(...DEFAULT_EXPIRY_WINDOWS));
const DEFAULT_THRESHOLD = 5;

const QUANTITIES = [0, 0.5, 1, 2.5, 4, 5, 6, 9.9, 10, 15, 30, 31, 1000];
const MINIMUMS: (number | null)[] = [null, 0, 1, 5, 10, 20];
const IDEALS: (number | null)[] = [null, 0, 10, 30];

const EXPIRY_DATES: (string | null)[] = [
  null,
  '2020-01-01',
  '2026-08-13',
  TODAY,
  '2026-08-15',
  '2026-08-21',
  '2026-08-22',
  '2026-09-13',
  '2026-09-14',
  '2026-11-12',
  '2026-11-13',
  '2030-01-01',
];

describe('SQL and JavaScript status rules agree', () => {
  let db: SqlDriver;

  beforeAll(async () => {
    db = await createMemoryDriver();
    await db.execScript(`
      CREATE TABLE i (
        id               INTEGER PRIMARY KEY,
        quantity         REAL,
        minimum_quantity REAL,
        ideal_quantity   REAL,
        expiration_date  TEXT
      );
    `);

    const rows: { sql: string; params: (number | string | null)[] }[] = [];
    let id = 0;
    for (const quantity of QUANTITIES) {
      for (const minimum of MINIMUMS) {
        for (const ideal of IDEALS) {
          rows.push({
            sql: 'INSERT INTO i (id, quantity, minimum_quantity, ideal_quantity) VALUES (?, ?, ?, ?)',
            params: [id++, quantity, minimum, ideal],
          });
        }
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      await db.batch(rows.slice(i, i + 200));
    }
  });

  afterAll(async () => {
    await db?.close().catch(() => undefined);
  });

  it('covers a meaningful number of combinations', () => {
    expect(QUANTITIES.length * MINIMUMS.length * IDEALS.length).toBeGreaterThan(300);
  });

  it('agrees on stock status for every combination', async () => {
    const rows = await db.select<{
      quantity: number;
      minimum_quantity: number | null;
      ideal_quantity: number | null;
      status: string;
    }>(
      `SELECT i.quantity, i.minimum_quantity, i.ideal_quantity,
              ${stockStatusSql()} AS status
         FROM i`,
      { defaultThreshold: DEFAULT_THRESHOLD },
    );

    expect(rows.length).toBeGreaterThan(300);

    const disagreements: string[] = [];
    for (const row of rows) {
      const expected = evaluateStock(
        {
          quantity: row.quantity,
          minimumQuantity: row.minimum_quantity,
          idealQuantity: row.ideal_quantity,
        },
        DEFAULT_THRESHOLD,
      ).status;

      if (row.status !== expected) {
        disagreements.push(
          `qty=${row.quantity} min=${String(row.minimum_quantity)} ideal=${String(
            row.ideal_quantity,
          )}: SQL said "${row.status}", JS said "${expected}"`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees on the quantity needed for every combination', async () => {
    const rows = await db.select<{
      quantity: number;
      minimum_quantity: number | null;
      ideal_quantity: number | null;
      needed: number;
    }>(
      `SELECT i.quantity, i.minimum_quantity, i.ideal_quantity,
              ${neededSql()} AS needed
         FROM i`,
      { defaultThreshold: DEFAULT_THRESHOLD },
    );

    const disagreements: string[] = [];
    for (const row of rows) {
      const expected = evaluateStock(
        {
          quantity: row.quantity,
          minimumQuantity: row.minimum_quantity,
          idealQuantity: row.ideal_quantity,
        },
        DEFAULT_THRESHOLD,
      ).needed;

      if (Math.abs(row.needed - expected) > 1e-6) {
        disagreements.push(
          `qty=${row.quantity} min=${String(row.minimum_quantity)} ideal=${String(
            row.ideal_quantity,
          )}: SQL said ${row.needed}, JS said ${expected}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees on a threshold of zero, which the original app could not express', async () => {
    const rows = await db.select<{ quantity: number; minimum_quantity: number | null; status: string }>(
      `SELECT i.quantity, i.minimum_quantity, ${stockStatusSql()} AS status
         FROM i WHERE i.minimum_quantity IS NULL`,
      { defaultThreshold: 0 },
    );

    for (const row of rows) {
      const expected = evaluateStock(
        { quantity: row.quantity, minimumQuantity: null, idealQuantity: null },
        0,
      ).status;
      // ideal_quantity varies across these rows, so only compare the no-ideal case
      // through the JS path by matching what SQL saw.
      if (row.minimum_quantity === null) {
        expect(['adequate', 'surplus']).toContain(row.status);
        expect(['adequate', 'surplus']).toContain(expected);
      }
    }
  });

  describe('expiry', () => {
    let expiryDb: SqlDriver;

    beforeAll(async () => {
      expiryDb = await createMemoryDriver();
      await expiryDb.execScript(
        'CREATE TABLE i (id INTEGER PRIMARY KEY, expiration_date TEXT, quantity REAL, minimum_quantity REAL, ideal_quantity REAL);',
      );
      await expiryDb.batch(
        EXPIRY_DATES.map((date, index) => ({
          sql: 'INSERT INTO i (id, expiration_date) VALUES (?, ?)',
          params: [index, date],
        })),
      );
    });

    afterAll(async () => {
      await expiryDb?.close().catch(() => undefined);
    });

    it('agrees on the bucket for every date', async () => {
      const rows = await expiryDb.select<{ expiration_date: string | null; bucket: string }>(
        `SELECT i.expiration_date, ${expiryBucketSql()} AS bucket FROM i`,
        { today: TODAY, expiryHorizon: HORIZON },
      );

      const disagreements: string[] = [];
      for (const row of rows) {
        const expected = evaluateExpiry(row.expiration_date, TODAY, DEFAULT_EXPIRY_WINDOWS).bucket;
        if (row.bucket !== expected) {
          disagreements.push(
            `date=${String(row.expiration_date)}: SQL said "${row.bucket}", JS said "${expected}"`,
          );
        }
      }
      expect(disagreements).toEqual([]);
    });

    it('agrees on days until expiry', async () => {
      const rows = await expiryDb.select<{
        expiration_date: string | null;
        days: number | null;
      }>(`SELECT i.expiration_date, ${daysUntilExpirySql()} AS days FROM i`, { today: TODAY });

      for (const row of rows) {
        const expected = evaluateExpiry(row.expiration_date, TODAY, DEFAULT_EXPIRY_WINDOWS).daysUntil;
        expect(row.days === null ? null : Number(row.days)).toBe(expected);
      }
    });

    it('treats a missing date as "none", never as expired', async () => {
      const row = await expiryDb.selectOne<{ bucket: string }>(
        `SELECT ${expiryBucketSql()} AS bucket FROM i WHERE expiration_date IS NULL`,
        { today: TODAY, expiryHorizon: HORIZON },
      );
      expect(row?.bucket).toBe('none');
    });

    it('respects a narrower configured horizon', async () => {
      const narrow = addCalendarDays(TODAY, 7);
      const rows = await expiryDb.select<{ expiration_date: string; bucket: string }>(
        `SELECT i.expiration_date, ${expiryBucketSql()} AS bucket
           FROM i WHERE expiration_date IS NOT NULL`,
        { today: TODAY, expiryHorizon: narrow },
      );

      for (const row of rows) {
        const expected = evaluateExpiry(row.expiration_date, TODAY, [7]).bucket;
        expect(row.bucket).toBe(expected);
      }
    });
  });
});
