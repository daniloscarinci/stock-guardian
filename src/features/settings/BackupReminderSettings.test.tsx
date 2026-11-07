// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { renderWithApp } from '../../test/app-harness';
import { BackupReminderSettings } from './BackupReminderSettings';

let db: SqlDriver;

beforeEach(async () => {
  db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
});

afterEach(async () => {
  cleanup();
  await db.close().catch(() => undefined);
});

const stored = async () => (await createSettingsRepository(db).load()).settings;

describe('BackupReminderSettings', () => {
  it('says there is no backup yet when there has not been one', () => {
    renderWithApp(<BackupReminderSettings />, db);
    expect(screen.getByText('No backup yet')).toBeTruthy();
  });

  it('says how long ago the last backup was', () => {
    const twelveDaysAgo = new Date(Date.now() - 12 * 86_400_000).toISOString();
    renderWithApp(<BackupReminderSettings />, db, { lastBackupAt: twelveDaysAgo });
    expect(screen.getByText('Last backup: 12 days ago')).toBeTruthy();
  });

  it('starts with the reminder on and 30 days chosen', () => {
    renderWithApp(<BackupReminderSettings />, db);
    expect((screen.getByLabelText('Remind me to back up') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Remind me after') as HTMLSelectElement).value).toBe('30');
  });

  it('switching the reminder off is saved and disables the day choice', async () => {
    renderWithApp(<BackupReminderSettings />, db);

    await userEvent.setup().click(screen.getByLabelText('Remind me to back up'));

    await waitFor(async () => {
      expect((await stored()).backupReminderEnabled).toBe(false);
    });
    // The interface updates after the write resolves, so wait for it as well.
    await waitFor(() => {
      expect((screen.getByLabelText('Remind me after') as HTMLSelectElement).disabled).toBe(true);
    });
  });

  it('choosing 60 days is saved', async () => {
    renderWithApp(<BackupReminderSettings />, db);

    await userEvent.setup().selectOptions(screen.getByLabelText('Remind me after'), '60');

    await waitFor(async () => {
      expect((await stored()).backupReminderDays).toBe(60);
    });
  });

  it('keeps a stored value that is not one of the offered choices', () => {
    renderWithApp(<BackupReminderSettings />, db, { backupReminderDays: 45 });
    expect(screen.getByRole('option', { name: '45 days' })).toBeTruthy();
    expect((screen.getByLabelText('Remind me after') as HTMLSelectElement).value).toBe('45');
  });

  it('gives the advice and says the key is never in a backup', () => {
    renderWithApp(<BackupReminderSettings />, db);
    expect(screen.getByText(/somewhere other than this device/)).toBeTruthy();
    expect(screen.getByText(/Your Anthropic key is never included in a backup/)).toBeTruthy();
  });
});
