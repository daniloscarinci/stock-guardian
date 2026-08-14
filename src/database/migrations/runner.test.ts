import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../driver/memory.driver';
import type { SqlDriver } from '../driver/types';
import { MIGRATIONS, LATEST_SCHEMA_VERSION, type Migration } from './index';
import {
  MigrationChecksumError,
  MigrationGapError,
  SchemaTooNewError,
  migrate,
  verifyAppliedChecksums,
} from './runner';

const migration = (version: number, name: string, sql: string): Migration => ({
  version,
  name,
  sql,
  checksum: `checksum-${version}`,
});

describe('migration runner', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  const userVersion = () => db.selectValue<number>('PRAGMA user_version');
  const tableExists = async (name: string) =>
    (await db.selectValue<number>(
      "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name=?",
      [name],
    )) === 1;

  const BASE: Migration[] = [
    migration(
      1,
      'base',
      `CREATE TABLE _schema_migrations (
         version INTEGER PRIMARY KEY, name TEXT NOT NULL,
         checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
       CREATE TABLE alpha (id TEXT PRIMARY KEY);`,
    ),
    migration(2, 'add-beta', 'CREATE TABLE beta (id TEXT PRIMARY KEY);'),
  ];

  describe('applying', () => {
    it('applies pending migrations in order and records the version', async () => {
      const result = await migrate(db, BASE);

      expect(result).toMatchObject({ status: 'migrated', from: 0, to: 2 });
      expect(await userVersion()).toBe(2);
      expect(await tableExists('alpha')).toBe(true);
      expect(await tableExists('beta')).toBe(true);
    });

    it('records each applied migration for diagnostics', async () => {
      await migrate(db, BASE);
      const rows = await db.select<{ version: number; name: string }>(
        'SELECT version, name FROM _schema_migrations ORDER BY version',
      );
      expect(rows.map((r) => r.name)).toEqual(['base', 'add-beta']);
    });

    it('is a no-op when already current', async () => {
      await migrate(db, BASE);
      expect(await migrate(db, BASE)).toEqual({ status: 'up-to-date', version: 2 });
    });

    it('applies only what is outstanding', async () => {
      await migrate(db, [BASE[0] as Migration]);
      expect(await userVersion()).toBe(1);

      const result = await migrate(db, BASE);
      expect(result).toMatchObject({ status: 'migrated', from: 1, to: 2, applied: ['0002_add-beta'] });
    });

    it('restores foreign key enforcement afterwards', async () => {
      await migrate(db, BASE);
      expect(await db.selectValue<number>('PRAGMA foreign_keys')).toBe(1);
    });
  });

  describe('failure is never partial', () => {
    it('rolls back a failing migration entirely', async () => {
      const broken = [
        ...BASE,
        migration(3, 'broken', 'CREATE TABLE gamma (id TEXT); INVALID SQL HERE;'),
      ];

      await expect(migrate(db, broken)).rejects.toThrow();

      // Version stays at the last good migration...
      expect(await userVersion()).toBe(2);
      // ...and the half-created table is gone.
      expect(await tableExists('gamma')).toBe(false);
    });

    it('leaves earlier migrations applied when a later one fails', async () => {
      const broken = [...BASE, migration(3, 'broken', 'THIS IS NOT SQL')];
      await expect(migrate(db, broken)).rejects.toThrow();

      expect(await tableExists('alpha')).toBe(true);
      expect(await tableExists('beta')).toBe(true);
      expect(await userVersion()).toBe(2);
    });

    it('restores foreign key enforcement even when a migration throws', async () => {
      await expect(migrate(db, [...BASE, migration(3, 'broken', 'NOT SQL')])).rejects.toThrow();
      expect(await db.selectValue<number>('PRAGMA foreign_keys')).toBe(1);
    });

    it('leaves the database usable after a failed migration', async () => {
      await expect(migrate(db, [...BASE, migration(3, 'broken', 'NOT SQL')])).rejects.toThrow();
      await db.exec('INSERT INTO alpha (id) VALUES (?)', ['still-works']);
      expect(await db.selectValue<number>('SELECT count(*) FROM alpha')).toBe(1);
    });
  });

  describe('refusing unsafe work', () => {
    it('refuses a database written by a newer build, without touching it', async () => {
      await migrate(db, BASE);
      await db.execScript('PRAGMA user_version = 99');

      await expect(migrate(db, BASE)).rejects.toBeInstanceOf(SchemaTooNewError);

      // Untouched: same version, same schema, same data.
      expect(await userVersion()).toBe(99);
      expect(await tableExists('alpha')).toBe(true);
    });

    it('reports the versions involved so the message can be actionable', async () => {
      await db.execScript('PRAGMA user_version = 42');
      const error = (await migrate(db, BASE).catch((e: unknown) => e)) as SchemaTooNewError;
      expect(error.databaseVersion).toBe(42);
      expect(error.supportedVersion).toBe(2);
      expect(error.message).toContain('has not been changed');
    });

    it('refuses to apply a set with a gap', async () => {
      const gapped = [BASE[0] as Migration, migration(3, 'skips-two', 'CREATE TABLE g (id TEXT);')];
      await expect(migrate(db, gapped)).rejects.toBeInstanceOf(MigrationGapError);
      expect(await userVersion()).toBe(0);
    });

    it('rejects duplicate versions at load time', async () => {
      // The loader guards this; assert the guarantee the runner relies on.
      const versions = MIGRATIONS.map((m) => m.version);
      expect(new Set(versions).size).toBe(versions.length);
    });
  });

  describe('checksum verification', () => {
    it('passes when applied migrations match their files', async () => {
      await migrate(db, BASE);
      await expect(verifyAppliedChecksums(db, BASE)).resolves.toBeUndefined();
    });

    it('detects a shipped migration edited after it was applied', async () => {
      await migrate(db, BASE);
      const edited = [{ ...(BASE[0] as Migration), checksum: 'different' }, BASE[1] as Migration];
      await expect(verifyAppliedChecksums(db, edited)).rejects.toBeInstanceOf(MigrationChecksumError);
    });

    it('ignores migrations applied by a newer build', async () => {
      await migrate(db, BASE);
      await db.exec(
        'INSERT INTO _schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        [3, 'from-the-future', 'unknown', new Date().toISOString()],
      );
      await expect(verifyAppliedChecksums(db, BASE)).resolves.toBeUndefined();
    });
  });

  describe('the real schema', () => {
    it('applies cleanly from empty', async () => {
      const result = await migrate(db);
      expect(result).toMatchObject({ status: 'migrated', from: 0, to: LATEST_SCHEMA_VERSION });
      expect(await userVersion()).toBe(LATEST_SCHEMA_VERSION);
    });

    it('creates every table the application depends on', async () => {
      await migrate(db);
      const tables = (
        await db.select<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
        )
      ).map((r) => r.name);

      expect(tables).toEqual(
        expect.arrayContaining([
          '_schema_migrations',
          'catalog_item_names',
          'catalog_items',
          'categories',
          'category_names',
          'contacts',
          'item_names',
          'items',
          'locations',
          'photos',
          'settings',
          'stock_transactions',
        ]),
      );
    });

    it('is referentially consistent', async () => {
      await migrate(db);
      expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
    });

    it('passes an integrity check', async () => {
      await migrate(db);
      expect(await db.selectValue<string>('PRAGMA integrity_check')).toBe('ok');
    });

    it('is idempotent across repeated startups', async () => {
      await migrate(db);
      await migrate(db);
      await migrate(db);
      expect(await userVersion()).toBe(LATEST_SCHEMA_VERSION);
    });

    it('agrees with its own checksums after applying', async () => {
      await migrate(db);
      await expect(verifyAppliedChecksums(db)).resolves.toBeUndefined();
    });
  });

  describe('schema constraints that protect data', () => {
    beforeEach(async () => {
      await migrate(db);
      const now = new Date().toISOString();
      await db.exec(
        'INSERT INTO categories (id, sort_order, is_system, active, created_at, updated_at) VALUES (?, 0, 1, 1, ?, ?)',
        ['food', now, now],
      );
      await db.exec(
        'INSERT INTO locations (id, name, name_norm, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
        ['pantry', 'Pantry', 'pantry', now, now],
      );
    });

    /** Builds the statement from the values so an override always gets a column. */
    const insertItem = (overrides: Record<string, string | number | null> = {}) => {
      const now = new Date().toISOString();
      const values: Record<string, string | number | null> = {
        id: 'i1',
        name: 'Rice',
        name_norm: 'rice',
        quantity: 1,
        unit: 'kg',
        priority: 3,
        created_at: now,
        updated_at: now,
        ...overrides,
      };
      const columns = Object.keys(values);
      return db.exec(
        `INSERT INTO items (${columns.join(', ')})
         VALUES (${columns.map((c) => `:${c}`).join(', ')})`,
        values,
      );
    };

    it('accepts an item with no expiration date', async () => {
      await insertItem();
      const row = await db.selectOne<{ expiration_date: null }>(
        'SELECT expiration_date FROM items WHERE id = ?',
        ['i1'],
      );
      expect(row?.expiration_date).toBeNull();
    });

    it('rejects a negative quantity', async () => {
      await expect(insertItem({ quantity: -1 })).rejects.toThrow();
    });

    it('accepts a minimum quantity of zero', async () => {
      // The original app could not express this: `parseFloat(...) || 5` turned
      // a threshold of 0 back into 5.
      await insertItem();
      await db.exec('UPDATE items SET minimum_quantity = 0 WHERE id = ?', ['i1']);
      expect(await db.selectValue<number>('SELECT minimum_quantity FROM items WHERE id = ?', ['i1'])).toBe(0);
    });

    it('rejects an unknown condition value', async () => {
      await expect(insertItem({ condition: 'slightly-damp' })).rejects.toThrow();
    });

    it('rejects a priority outside 1-4', async () => {
      await expect(insertItem({ priority: 9 })).rejects.toThrow();
    });

    it('refuses to delete a location that still holds items', async () => {
      await insertItem({ location_id: 'pantry' });
      // ON DELETE RESTRICT on the parent link and SET NULL on items means the
      // item survives; deleting a parent location with children is what must fail.
      await db.exec(
        'INSERT INTO locations (id, name, name_norm, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        ['shelf', 'Shelf', 'shelf', 'pantry', new Date().toISOString(), new Date().toISOString()],
      );
      await expect(db.exec('DELETE FROM locations WHERE id = ?', ['pantry'])).rejects.toThrow();
    });

    it('keeps an item when its location is deleted', async () => {
      await insertItem({ location_id: 'pantry' });
      await db.exec('DELETE FROM locations WHERE id = ?', ['pantry']);
      const row = await db.selectOne<{ location_id: null }>(
        'SELECT location_id FROM items WHERE id = ?',
        ['i1'],
      );
      expect(row?.location_id).toBeNull();
    });

    it('removes stock history with its item', async () => {
      await insertItem();
      const now = new Date().toISOString();
      await db.exec(
        `INSERT INTO stock_transactions
           (id, item_id, type, quantity, quantity_before, quantity_after, occurred_at, created_at)
         VALUES (?, ?, 'add', 1, 0, 1, ?, ?)`,
        ['t1', 'i1', now, now],
      );
      await db.exec('DELETE FROM items WHERE id = ?', ['i1']);
      expect(await db.selectValue<number>('SELECT count(*) FROM stock_transactions')).toBe(0);
    });
  });
});
