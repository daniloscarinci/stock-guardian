// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository } from '../../repositories/items.repository';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { downloadText } from '../../services/download';
import type * as DownloadModule from '../../services/download';
import { renderWithApp } from '../../test/app-harness';
import { BackupReminder } from './BackupReminder';

vi.mock('../../services/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadModule>();
  return { ...actual, downloadText: vi.fn() };
});

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

let db: SqlDriver;

async function addItem(): Promise<void> {
  await createItemsRepository(db).create({ name: 'Rice', quantity: 3 });
}

/** Back-dates every item, so the data looks as old as the test needs. */
async function dateItems(createdAt: string, updatedAt: string): Promise<void> {
  await db.exec('UPDATE items SET created_at = ?, updated_at = ?', [createdAt, updatedAt]);
}

beforeEach(async () => {
  db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
  vi.mocked(downloadText).mockReset();
});

afterEach(async () => {
  cleanup();
  await db.close().catch(() => undefined);
});

describe('BackupReminder', () => {
  it('shows nothing when the reminder is switched off', async () => {
    await addItem();
    await dateItems(ago(60), ago(60));
    renderWithApp(<BackupReminder />, db, { backupReminderEnabled: false });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.queryByText(/backup/i)).toBeNull();
  });

  it('says "No backup yet" for young data that was never backed up, with no warning', async () => {
    await addItem();
    renderWithApp(<BackupReminder />, db);

    expect(await screen.findByText('No backup yet')).toBeTruthy();
    expect(screen.queryByText('You have never made a backup')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeTruthy();
  });

  it('warns when nothing was ever backed up and the data is old', async () => {
    await addItem();
    await dateItems(ago(40), ago(40));
    renderWithApp(<BackupReminder />, db);

    expect(await screen.findByText('You have never made a backup')).toBeTruthy();
    expect(screen.getByText('Everything you have entered exists only on this device.')).toBeTruthy();
  });

  it('shows a quiet line, not a warning, for an old backup of data that has not changed', async () => {
    await addItem();
    await dateItems(ago(100), ago(100));
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(90) });

    expect(await screen.findByText('Last backup: 90 days ago')).toBeTruthy();
    expect(screen.queryByText(/Changes made since then/)).toBeNull();
  });

  it('warns when there are changes after an old backup', async () => {
    await addItem();
    await dateItems(ago(60), ago(2));
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(41) });

    expect(await screen.findByText('Your last backup was 41 days ago')).toBeTruthy();
    expect(screen.getByText('Changes made since then exist only on this device.')).toBeTruthy();
  });

  it('"Back up now" saves a file, records it, and turns the warning into the quiet line', async () => {
    await addItem();
    await dateItems(ago(60), ago(2));
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(41) });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));

    expect(await screen.findByText('Last backup: today')).toBeTruthy();
    expect(screen.queryByText(/Changes made since then/)).toBeNull();

    expect(downloadText).toHaveBeenCalledTimes(1);
    const [filename, contents, mime] = vi.mocked(downloadText).mock.calls[0] ?? [];
    expect(filename).toMatch(/^stock-guardian-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe('application/json');

    const stamped = (JSON.parse(String(contents)) as { data: { settings: Record<string, unknown> } })
      .data.settings.lastBackupAt;
    expect(typeof stamped).toBe('string');

    const recorded = (await createSettingsRepository(db).load()).settings.lastBackupAt;
    expect(recorded).toBe(stamped);

    expect(screen.getByText(/^Backup saved as stock-guardian-backup-/)).toBeTruthy();
  });

  it('shows the error and records nothing when the backup fails', async () => {
    await addItem();
    await dateItems(ago(60), ago(2));
    vi.mocked(downloadText).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(41) });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));

    expect(await screen.findByText('disk full')).toBeTruthy();
    expect((await createSettingsRepository(db).load()).settings.lastBackupAt).toBeNull();
    expect(screen.getByText('Your last backup was 41 days ago')).toBeTruthy();
  });
});
