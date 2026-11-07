/**
 * Making a backup file, the one way.
 *
 * Settings and the dashboard both offer "back up now". Both call this, so they
 * cannot drift apart: same stamp, same file name, same order of operations.
 *
 * The order is the point:
 *
 *   1. choose one instant;
 *   2. build the file with that instant stamped inside it;
 *   3. hand the file to the device;
 *   4. only then record the instant.
 *
 * If building or saving fails, nothing is recorded, so the reminder never claims
 * a backup that was not made. If recording fails after the file was handed over,
 * the file exists and the error reaches the caller, who can press the button
 * again. On Android step 3 only STARTS the save (the native shell writes to
 * Downloads and reports nothing back), which is why every sentence in the
 * interface says "last backup" and never "you are safe".
 */
import type { SqlDriver } from '../../database/driver/types';
import { nowInstant } from '../../domain/dates';
import type { Settings } from '../../domain/settings';
import { downloadText } from '../download';
import { backupFilename, serializeBackup } from './export.service';

export interface ExportToDeviceArgs {
  readonly db: SqlDriver;
  readonly updateSettings: (patch: Partial<Settings>) => Promise<void>;
  readonly includeTransactions: boolean;
  /** Replaceable so tests need no browser. Defaults to the real download. */
  readonly save?: (filename: string, contents: string, mime: string) => void;
  /** Replaceable so tests are deterministic. Defaults to the current time. */
  readonly now?: Date;
}

export interface ExportToDeviceResult {
  readonly filename: string;
  readonly stampedAt: string;
}

export async function exportBackupToDevice(
  args: ExportToDeviceArgs,
): Promise<ExportToDeviceResult> {
  const now = args.now ?? new Date();
  const stampedAt = nowInstant(now);
  const filename = backupFilename(now);

  const json = await serializeBackup(args.db, {
    includeTransactions: args.includeTransactions,
    stampLastBackupAt: stampedAt,
  });

  (args.save ?? downloadText)(filename, json, 'application/json');
  await args.updateSettings({ lastBackupAt: stampedAt });

  return { filename, stampedAt };
}
