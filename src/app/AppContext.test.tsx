// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryDriver } from '../database/driver/memory.driver';
import type { SqlDriver } from '../database/driver/types';
import { migrate } from '../database/migrations/runner';
import { seedDatabase } from '../database/seed/seed';
import { createSettingsRepository } from '../repositories/settings.repository';
import { renderWithApp } from '../test/app-harness';
import { useApp } from './AppContext';

/** Shows what `reloadSettings` changes, and what it reports back. */
function Probe() {
  const { revision, settingsEpoch, settings, reloadSettings } = useApp();
  const [outcome, setOutcome] = useState('not run');
  return (
    <>
      <p data-testid="state">{`revision ${String(revision)}, reloads ${String(settingsEpoch)}`}</p>
      <p data-testid="threshold">{String(settings.defaultLowStockThreshold)}</p>
      <p data-testid="outcome">{outcome}</p>
      <button
        type="button"
        onClick={() => {
          reloadSettings().then(
            () => {
              setOutcome('resolved');
            },
            () => {
              setOutcome('rejected');
            },
          );
        }}
      >
        reload
      </button>
    </>
  );
}

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

describe('reloadSettings', () => {
  it('reads the settings the database holds now, and tells the views to read again', async () => {
    renderWithApp(<Probe />, db);
    expect(screen.getByTestId('threshold').textContent).toBe('5');
    expect(screen.getByTestId('state').textContent).toBe('revision 0, reloads 0');

    // Something other than `updateSettings` writes the table, as an import does.
    await createSettingsRepository(db).save({ defaultLowStockThreshold: 9 });
    await userEvent.setup().click(screen.getByRole('button', { name: 'reload' }));

    await waitFor(() => {
      expect(screen.getByTestId('outcome').textContent).toBe('resolved');
    });
    expect(screen.getByTestId('threshold').textContent).toBe('9');
    expect(screen.getByTestId('state').textContent).toBe('revision 1, reloads 1');
  });

  it('still tells the views to read again, and reports the failure, when the read fails', async () => {
    renderWithApp(<Probe />, db);
    await db.close();

    await userEvent.setup().click(screen.getByRole('button', { name: 'reload' }));

    await waitFor(() => {
      expect(screen.getByTestId('outcome').textContent).toBe('rejected');
    });
    // The settings on screen are the ones from before: nothing was read.
    expect(screen.getByTestId('threshold').textContent).toBe('5');
    expect(screen.getByTestId('state').textContent).toBe('revision 1, reloads 0');
  });
});
