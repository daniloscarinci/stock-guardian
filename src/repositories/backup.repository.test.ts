import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../database/driver/memory.driver';
import type { SqlDriver } from '../database/driver/types';
import { migrate } from '../database/migrations/runner';
import { seedDatabase } from '../database/seed/seed';
import { createBackupRepository } from './backup.repository';
import { createContactsRepository } from './contacts.repository';
import { createItemsRepository } from './items.repository';
import { createLocationsRepository } from './locations.repository';

describe('backup repository', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('reports no dates for an empty database', async () => {
    expect(await createBackupRepository(db).dataSpan()).toEqual({
      earliestAt: null,
      latestChangeAt: null,
    });
  });

  it('spans the items', async () => {
    await createItemsRepository(db).create({ name: 'Rice', quantity: 3 });
    await db.exec('UPDATE items SET created_at = ?, updated_at = ?', [
      '2026-01-02T00:00:00.000Z',
      '2026-03-04T00:00:00.000Z',
    ]);

    expect(await createBackupRepository(db).dataSpan()).toEqual({
      earliestAt: '2026-01-02T00:00:00.000Z',
      latestChangeAt: '2026-03-04T00:00:00.000Z',
    });
  });

  it('takes the earliest creation and the latest change across items, locations and contacts', async () => {
    await createItemsRepository(db).create({ name: 'Rice', quantity: 3 });
    await createLocationsRepository(db).create({ name: 'Pantry' });
    await createContactsRepository(db).create({ name: 'Ana' });

    await db.exec('UPDATE items SET created_at = ?, updated_at = ?', [
      '2026-02-01T00:00:00.000Z',
      '2026-02-10T00:00:00.000Z',
    ]);
    await db.exec('UPDATE locations SET created_at = ?, updated_at = ?', [
      '2026-02-05T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ]);
    await db.exec('UPDATE contacts SET created_at = ?, updated_at = ?', [
      '2026-01-15T00:00:00.000Z',
      '2026-01-20T00:00:00.000Z',
    ]);

    expect(await createBackupRepository(db).dataSpan()).toEqual({
      earliestAt: '2026-01-15T00:00:00.000Z',
      latestChangeAt: '2026-06-01T00:00:00.000Z',
    });
  });
});
