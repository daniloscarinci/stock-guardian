// @vitest-environment happy-dom
/**
 * A restored backup has to show on screen at once.
 *
 * The application reads its settings a single time, at start-up, and keeps them
 * in the context. An import writes the file's settings to the database; until
 * 2.8.2 nothing told the context, so the last-backup line, the language and the
 * Settings inputs kept showing the old values until the app was opened again.
 * Measured in a real browser: still "No backup yet" three seconds after a
 * restore, correct after a reload.
 *
 * These tests drive the real screens through the real file input, so they would
 * have failed on 2.8.1.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import type { Settings } from '../../domain/settings';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { serializeBackup } from '../../services/backup/export.service';
import { renderWithApp } from '../../test/app-harness';
import { BackupReminder } from '../dashboard/BackupReminder';
import { BackupPanel } from './BackupPanel';
import { SettingsScreen } from './SettingsScreen';

const DAY = 86_400_000;

async function freshDb(): Promise<SqlDriver> {
  const db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
  return db;
}

/** A backup file made by another device whose settings are `settings`. */
async function backupMadeWith(settings: Partial<Settings>): Promise<File> {
  const source = await freshDb();
  try {
    await createSettingsRepository(source).save(settings);
    return new File([await serializeBackup(source, {})], 'backup.json', {
      type: 'application/json',
    });
  } finally {
    await source.close().catch(() => undefined);
  }
}

/** Chooses `file` in the import box and presses Merge, as a person does. */
async function restore(file: File): Promise<void> {
  const input = document.querySelector('input[type=file]');
  if (input === null) throw new Error('the import box is not on screen');
  const user = userEvent.setup();
  await user.upload(input as HTMLInputElement, file);
  await user.click(await screen.findByRole('button', { name: /^merge$/i }));
}

let db: SqlDriver;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  cleanup();
  await db.close().catch(() => undefined);
});

describe('restoring a backup updates the screen without reopening the app', () => {
  it('shows the restored last-backup date on the dashboard and in Settings', async () => {
    renderWithApp(
      <>
        <BackupReminder />
        <BackupPanel />
      </>,
      db,
    );
    // Both places say it before the restore (the dashboard line loads a moment
    // after it mounts): this is the state the bug left behind.
    await waitFor(() => {
      expect(screen.getAllByText('No backup yet')).toHaveLength(2);
    });

    // Three and a half days, not three: the line counts whole days from the moment
    // it mounted, a little before this, so an exact three would round down to two.
    const backedUpAt = new Date(Date.now() - 3.5 * DAY).toISOString();
    await restore(await backupMadeWith({ lastBackupAt: backedUpAt }));

    // The restore itself worked: the database holds the date...
    await waitFor(async () => {
      expect((await createSettingsRepository(db).load()).settings.lastBackupAt).toBe(backedUpAt);
    });
    // ...and so must the screen.
    await waitFor(() => {
      expect(screen.getAllByText('Last backup: 3 days ago')).toHaveLength(2);
    });
    expect(screen.queryByText('No backup yet')).toBeNull();
  });

  it('switches to the restored language at once', async () => {
    renderWithApp(<BackupPanel />, db);
    expect(screen.getByText('Export')).toBeTruthy();

    await restore(await backupMadeWith({ language: 'pt-BR' }));

    await waitFor(() => {
      expect(screen.getByText('Exportar')).toBeTruthy();
    });
  });

  it('shows the restored values in the Settings inputs, not the ones from before', async () => {
    renderWithApp(<SettingsScreen />, db);
    const threshold = () => screen.getByLabelText('Default low-stock threshold') as HTMLInputElement;
    const windows = () => screen.getByLabelText('Warning windows') as HTMLInputElement;
    expect(threshold().value).toBe('5');
    expect(windows().value).toBe('7, 30, 90');

    await restore(await backupMadeWith({ defaultLowStockThreshold: 9, expiryWarningDays: [3, 14] }));

    await waitFor(() => {
      expect(threshold().value).toBe('9');
    });
    expect(windows().value).toBe('3, 14');
  });
});
