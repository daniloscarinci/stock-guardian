import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { serializeBackup } from './export.service';
import { inspectBackup } from './import.service';

interface BackupShape {
  readonly data: { readonly settings: Record<string, unknown> };
}

describe('backup stamping and device-only settings', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('records the stamp in the file, and the file still verifies', async () => {
    const stamp = '2026-11-07T12:00:00.000Z';
    const json = await serializeBackup(db, { stampLastBackupAt: stamp });

    expect((JSON.parse(json) as BackupShape).data.settings.lastBackupAt).toBe(stamp);

    const preview = await inspectBackup(json, db);
    expect(preview.ok).toBe(true);
    expect(preview.checksumValid).toBe(true);
  });

  it('writes nothing of its own when no stamp is given', async () => {
    const parsed = JSON.parse(await serializeBackup(db, {})) as BackupShape;
    expect(parsed.data.settings.lastBackupAt ?? null).toBeNull();
  });

  it('leaves the Anthropic key out of the file but keeps the other AI setting', async () => {
    await createSettingsRepository(db).save({
      anthropicApiKey: 'sk-ant-test-key-do-not-ship',
      aiEnabled: true,
    });

    const json = await serializeBackup(db, {});
    const parsed = JSON.parse(json) as BackupShape;

    expect(parsed.data.settings).not.toHaveProperty('anthropicApiKey');
    expect(parsed.data.settings.aiEnabled).toBe(true);
    expect(json).not.toContain('sk-ant-test-key-do-not-ship');
  });
});
