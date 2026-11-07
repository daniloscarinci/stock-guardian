import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { serializeBackup } from './export.service';
import { checksumOf } from './format';
import { applyImport, inspectBackup, type ImportMode } from './import.service';

const SEP = '2026-09-01T00:00:00.000Z';
const NOV = '2026-11-01T00:00:00.000Z';

async function freshDb(): Promise<SqlDriver> {
  const db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
  return db;
}

/** Inspects `json` against `target`, applies it, and fails loudly if it was refused. */
async function importInto(target: SqlDriver, json: string, mode: ImportMode): Promise<void> {
  const preview = await inspectBackup(json, target);
  if (!preview.ok || preview.payload === null) {
    throw new Error(`the file was refused: ${JSON.stringify(preview.problems)}`);
  }
  await applyImport(target, preview.payload, mode);
}

describe('importing settings from a backup', () => {
  let source: SqlDriver;
  let target: SqlDriver;

  beforeEach(async () => {
    source = await freshDb();
    target = await freshDb();
  });

  afterEach(async () => {
    await source.close().catch(() => undefined);
    await target.close().catch(() => undefined);
  });

  describe.each(['merge', 'replace'] as const)('%s mode', (mode) => {
    const lastBackupAfter = async (): Promise<string | null> =>
      (await createSettingsRepository(target).load()).settings.lastBackupAt;

    it('does not move lastBackupAt backwards', async () => {
      await createSettingsRepository(target).save({ lastBackupAt: NOV });
      await createSettingsRepository(source).save({ lastBackupAt: SEP });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(NOV);
    });

    it('moves lastBackupAt forwards', async () => {
      await createSettingsRepository(target).save({ lastBackupAt: SEP });
      await createSettingsRepository(source).save({ lastBackupAt: NOV });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(NOV);
    });

    it('sets lastBackupAt when the device had none', async () => {
      await createSettingsRepository(source).save({ lastBackupAt: SEP });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(SEP);
    });

    it('leaves lastBackupAt alone when the file has none', async () => {
      await createSettingsRepository(target).save({ lastBackupAt: NOV });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(NOV);
    });

    it("never overwrites this device's Anthropic key, even from an older file that holds one", async () => {
      await createSettingsRepository(target).save({ anthropicApiKey: 'keep-me', aiEnabled: false });

      // Craft a file as an older version would have written it: a key inside, and a
      // checksum that matches, so the import is accepted and the key must be ignored.
      const doc = JSON.parse(await serializeBackup(source, {})) as {
        checksum: string;
        data: { settings: Record<string, unknown> };
      };
      doc.data.settings.anthropicApiKey = 'attacker-key';
      doc.data.settings.aiEnabled = true;
      doc.checksum = await checksumOf(doc.data);

      await importInto(target, JSON.stringify(doc), mode);

      const { settings } = await createSettingsRepository(target).load();
      expect(settings.anthropicApiKey).toBe('keep-me');
      expect(settings.aiEnabled).toBe(true);
    });

    it('does not create a key on a device that has none', async () => {
      const doc = JSON.parse(await serializeBackup(source, {})) as {
        checksum: string;
        data: { settings: Record<string, unknown> };
      };
      doc.data.settings.anthropicApiKey = 'attacker-key';
      doc.checksum = await checksumOf(doc.data);

      await importInto(target, JSON.stringify(doc), mode);

      expect((await createSettingsRepository(target).load()).settings.anthropicApiKey).toBe('');
    });
  });
});
