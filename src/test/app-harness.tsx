/**
 * Renders a component inside the real application context, over a database made
 * for the test. The same arrangement `VoiceSheet.test.tsx` and
 * `PhrasebookScreen.test.tsx` build by hand, once, for the tests that follow.
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AppProvider } from '../app/AppContext';
import type { AppContext } from '../app/bootstrap';
import type { SqlDriver } from '../database/driver/types';
import type { DatabaseDiagnostics } from '../database/worker/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings';
import { createBackupRepository } from '../repositories/backup.repository';
import { createCatalogRepository } from '../repositories/catalog.repository';
import { createCategoriesRepository } from '../repositories/categories.repository';
import { createContactsRepository } from '../repositories/contacts.repository';
import { createItemsRepository } from '../repositories/items.repository';
import { createLocationsRepository } from '../repositories/locations.repository';
import { createSettingsRepository } from '../repositories/settings.repository';

const DIAGNOSTICS: DatabaseDiagnostics = {
  sqliteVersion: 'test',
  vfsName: 'memory',
  journalMode: 'memory',
  foreignKeys: true,
  integrity: 'ok',
  poolCapacity: 0,
  poolFileCount: 0,
  pageCount: 0,
  pageSize: 4096,
};

/** `overrides` apply to the settings the interface starts with, not to the database rows. */
export function renderWithApp(
  ui: ReactElement,
  db: SqlDriver,
  overrides: Partial<Settings> = {},
) {
  const startup: AppContext = {
    db,
    repositories: {
      items: createItemsRepository(db),
      categories: createCategoriesRepository(db),
      locations: createLocationsRepository(db),
      catalog: createCatalogRepository(db),
      contacts: createContactsRepository(db),
      settings: createSettingsRepository(db),
      backup: createBackupRepository(db),
    },
    diagnostics: DIAGNOSTICS,
    settings: { ...DEFAULT_SETTINGS, language: 'en', ...overrides },
    invalidSettingKeys: [],
    quarantine: () => Promise.resolve('unused'),
    refreshDiagnostics: () => Promise.resolve(DIAGNOSTICS),
  };

  return render(<AppProvider startup={startup}>{ui}</AppProvider>);
}
