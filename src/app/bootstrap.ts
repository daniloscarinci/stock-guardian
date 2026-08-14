/**
 * Application start-up.
 *
 * Opens the database, checks it, brings the schema forward, seeds reference
 * data, and loads settings. Every way this can fail is turned into a typed
 * outcome rather than an exception thrown at a render, because each failure has
 * a different thing the user should be told and a different thing they can do.
 *
 * The governing rule throughout: nothing here deletes or overwrites user data.
 * A database that is corrupt, or newer than this build understands, stops the
 * start-up and offers an export - never a reset.
 */
import { openDatabase, DatabaseLockedError, InsecureContextError } from '../database/worker/opfs.driver';
import type { DatabaseDiagnostics } from '../database/worker/protocol';
import type { SqlDriver } from '../database/driver/types';
import { SqlError } from '../database/driver/types';
import { migrate, SchemaTooNewError, verifyAppliedChecksums } from '../database/migrations/runner';
import { seedDatabase } from '../database/seed/seed';
import { createItemsRepository } from '../repositories/items.repository';
import { createCategoriesRepository } from '../repositories/categories.repository';
import { createLocationsRepository } from '../repositories/locations.repository';
import { createCatalogRepository } from '../repositories/catalog.repository';
import { createSettingsRepository } from '../repositories/settings.repository';
import type { Settings } from '../domain/settings';

export interface Repositories {
  readonly items: ReturnType<typeof createItemsRepository>;
  readonly categories: ReturnType<typeof createCategoriesRepository>;
  readonly locations: ReturnType<typeof createLocationsRepository>;
  readonly catalog: ReturnType<typeof createCatalogRepository>;
  readonly settings: ReturnType<typeof createSettingsRepository>;
}

export interface AppContext {
  readonly db: SqlDriver;
  readonly repositories: Repositories;
  readonly diagnostics: DatabaseDiagnostics;
  readonly settings: Settings;
  readonly invalidSettingKeys: readonly string[];
  readonly quarantine: (label: string) => Promise<string>;
  readonly refreshDiagnostics: () => Promise<DatabaseDiagnostics>;
}

export type StartupFailureKind =
  | 'insecure-context'
  | 'locked'
  | 'corrupt'
  | 'schema-too-new'
  | 'unknown';

export interface StartupFailure {
  readonly kind: StartupFailureKind;
  /** Present when the database opened; lets the user export before acting. */
  readonly db: SqlDriver | null;
  readonly detail: string;
  readonly databaseVersion?: number;
  readonly supportedVersion?: number;
}

export type StartupResult =
  | { readonly status: 'ready'; readonly context: AppContext }
  | { readonly status: 'failed'; readonly failure: StartupFailure };

function buildRepositories(db: SqlDriver): Repositories {
  return {
    items: createItemsRepository(db),
    categories: createCategoriesRepository(db),
    locations: createLocationsRepository(db),
    catalog: createCatalogRepository(db),
    settings: createSettingsRepository(db),
  };
}

export async function startApplication(): Promise<StartupResult> {
  let opened: Awaited<ReturnType<typeof openDatabase>>;

  try {
    opened = await openDatabase();
  } catch (error) {
    if (error instanceof InsecureContextError) {
      return { status: 'failed', failure: { kind: 'insecure-context', db: null, detail: error.message } };
    }
    if (error instanceof DatabaseLockedError) {
      return { status: 'failed', failure: { kind: 'locked', db: null, detail: error.message } };
    }
    if (error instanceof SqlError && error.isCorruption) {
      return { status: 'failed', failure: { kind: 'corrupt', db: null, detail: error.message } };
    }
    return {
      status: 'failed',
      failure: {
        kind: 'unknown',
        db: null,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const { driver, diagnostics, quarantine, refreshDiagnostics } = opened;

  // `quick_check` runs on open. A failure here means the file is damaged, so
  // stop before a migration or a write can make it worse.
  if (diagnostics.integrity !== 'ok') {
    return {
      status: 'failed',
      failure: { kind: 'corrupt', db: driver, detail: diagnostics.integrity },
    };
  }

  try {
    await migrate(driver);
  } catch (error) {
    if (error instanceof SchemaTooNewError) {
      return {
        status: 'failed',
        failure: {
          kind: 'schema-too-new',
          db: driver,
          detail: error.message,
          databaseVersion: error.databaseVersion,
          supportedVersion: error.supportedVersion,
        },
      };
    }
    if (error instanceof SqlError && error.isCorruption) {
      return { status: 'failed', failure: { kind: 'corrupt', db: driver, detail: error.message } };
    }
    return {
      status: 'failed',
      failure: {
        kind: 'unknown',
        db: driver,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  // Development-only: catches a shipped migration being edited after the fact,
  // which would otherwise leave every already-migrated device on a different
  // schema from the developer's.
  if (import.meta.env.DEV) {
    try {
      await verifyAppliedChecksums(driver);
    } catch (error) {
      console.error('[migrations]', error);
    }
  }

  await seedDatabase(driver);

  const repositories = buildRepositories(driver);
  const { settings, invalidKeys } = await repositories.settings.load();

  // Asked for once, after the database is known to work. Without it the browser
  // may evict everything when the device runs low on space - which for an app
  // that can sit unopened for months is a real way to lose data.
  if (!settings.storagePersistenceRequested) {
    void requestPersistentStorage().then(async () => {
      await repositories.settings.save({ storagePersistenceRequested: true });
    });
  }

  return {
    status: 'ready',
    context: {
      db: driver,
      repositories,
      diagnostics: await refreshDiagnostics(),
      settings,
      invalidSettingKeys: invalidKeys,
      quarantine,
      refreshDiagnostics,
    },
  };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist === undefined) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate === undefined) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
