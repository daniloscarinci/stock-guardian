/**
 * What the backup reminder needs to know about the data.
 *
 * Two dates across the three tables a person edits: when the oldest record was
 * made, and when anything was last changed. A quantity change updates its item,
 * so it counts. Settings are not included: changing the language is not a
 * reason to warn that a backup is stale.
 */
import type { SqlDriver, SqlRow } from '../database/driver/types';

export interface DataSpan {
  /** Smallest `created_at`, or null when there is no data. */
  readonly earliestAt: string | null;
  /** Largest `updated_at`, or null when there is no data. */
  readonly latestChangeAt: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function createBackupRepository(db: SqlDriver) {
  return {
    async dataSpan(): Promise<DataSpan> {
      const row = await db.selectOne<SqlRow>(
        `SELECT MIN(created_at) AS earliest, MAX(updated_at) AS latest FROM (
           SELECT created_at, updated_at FROM items
           UNION ALL SELECT created_at, updated_at FROM locations
           UNION ALL SELECT created_at, updated_at FROM contacts
         )`,
      );
      return { earliestAt: text(row?.earliest), latestChangeAt: text(row?.latest) };
    },
  };
}

export type BackupRepository = ReturnType<typeof createBackupRepository>;
