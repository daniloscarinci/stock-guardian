import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import type { Settings } from '../../domain/settings';
import { exportBackupToDevice } from './run-export';

interface BackupShape {
  readonly data: { readonly settings: Record<string, unknown> };
}

describe('exportBackupToDevice', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  const now = new Date(2026, 10, 7, 12, 0, 0); // 7 November 2026, local time

  it('saves the file, then records when, and returns both', async () => {
    const log: string[] = [];
    const saved: { filename: string; contents: string; mime: string }[] = [];
    const patches: Partial<Settings>[] = [];

    const result = await exportBackupToDevice({
      db,
      includeTransactions: false,
      now,
      save: (filename, contents, mime) => {
        log.push('save');
        saved.push({ filename, contents, mime });
      },
      updateSettings: (patch) => {
        log.push('record');
        patches.push(patch);
        return Promise.resolve();
      },
    });

    expect(log).toEqual(['save', 'record']);
    expect(result.filename).toBe('stock-guardian-backup-2026-11-07.json');
    expect(result.stampedAt).toBe(now.toISOString());
    expect(saved).toHaveLength(1);
    expect(saved[0]?.filename).toBe(result.filename);
    expect(saved[0]?.mime).toBe('application/json');
    expect(patches).toEqual([{ lastBackupAt: result.stampedAt }]);
  });

  it('stamps the file with the same instant it records', async () => {
    let contents = '';
    const result = await exportBackupToDevice({
      db,
      includeTransactions: false,
      now,
      save: (_filename, text) => {
        contents = text;
      },
      updateSettings: () => Promise.resolve(),
    });

    expect((JSON.parse(contents) as BackupShape).data.settings.lastBackupAt).toBe(result.stampedAt);
  });

  it('records nothing when the file cannot be saved', async () => {
    const patches: Partial<Settings>[] = [];

    await expect(
      exportBackupToDevice({
        db,
        includeTransactions: false,
        now,
        save: () => {
          throw new Error('disk full');
        },
        updateSettings: (patch) => {
          patches.push(patch);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('disk full');

    expect(patches).toEqual([]);
  });
});
