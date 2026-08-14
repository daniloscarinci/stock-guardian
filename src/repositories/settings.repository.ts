/**
 * Settings persistence.
 *
 * Reads always produce a complete `Settings` object: a value that is missing or
 * unparseable falls back to its default and is reported, never thrown. A single
 * corrupt row - from a bad import, or a hand-edited database - must not be able
 * to stop the application from starting.
 */
import type { SqlDriver } from '../database/driver/types';
import { nowInstant } from '../domain/dates';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  toSettingRows,
  type Settings,
} from '../domain/settings';

export interface LoadedSettings {
  readonly settings: Settings;
  /** Keys that held an unusable value and fell back to their default. */
  readonly invalidKeys: readonly string[];
}

export function createSettingsRepository(db: SqlDriver) {
  return {
    async load(): Promise<LoadedSettings> {
      const rows = await db.select<{ key: string; value: string }>(
        'SELECT key, value FROM settings',
      );
      return parseSettings(rows.map((row) => ({ key: String(row.key), value: String(row.value) })));
    },

    async save(patch: Partial<Settings>): Promise<void> {
      const rows = toSettingRows(patch);
      if (rows.length === 0) return;
      const now = nowInstant();
      await db.batch(
        rows.map((row) => ({
          sql: `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :now)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          params: { key: row.key, value: row.value, now },
        })),
      );
    },

    /** Restores one setting to its shipped default. */
    async reset(key: keyof Settings): Promise<void> {
      await this.save({ [key]: DEFAULT_SETTINGS[key] } as Partial<Settings>);
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
