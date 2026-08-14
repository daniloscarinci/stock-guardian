/**
 * The migration runner.
 *
 * `PRAGMA user_version` is the authoritative gate. It lives in the SQLite file
 * header and is bumped *inside* the same transaction as the DDL it describes.
 * Since SQLite executes DDL transactionally, that combination makes a partially
 * applied migration unreachable: either the schema change and its version bump
 * both committed, or neither did. A crash mid-COMMIT leaves a hot journal, the
 * next open rolls it back, and the runner simply re-runs the migration cleanly.
 */
import type { SqlDriver } from '../driver/types';
import { MIGRATIONS, LATEST_SCHEMA_VERSION, type Migration } from './index';

/**
 * The database was written by a newer build than this one.
 *
 * Nothing is touched when this is thrown - not a pragma, not a byte. The only
 * offers the interface may make are "export a backup" and "close". A user who
 * hits this on a stale device and is offered a reset button loses everything.
 */
export class SchemaTooNewError extends Error {
  constructor(
    readonly databaseVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `This data was created by a newer version of Stock Guardian (schema v${databaseVersion}; ` +
        `this version supports v${supportedVersion}). Your data has not been changed.`,
    );
    this.name = 'SchemaTooNewError';
  }
}

/** A migration left the database referentially inconsistent; it was rolled back. */
export class MigrationIntegrityError extends Error {
  constructor(
    readonly migration: Migration,
    readonly violations: readonly unknown[],
  ) {
    super(
      `Migration ${String(migration.version).padStart(4, '0')}_${migration.name} produced ` +
        `${violations.length} foreign-key violation(s) and was rolled back.`,
    );
    this.name = 'MigrationIntegrityError';
  }
}

/** The pending set skips a version, so the database cannot be brought forward safely. */
export class MigrationGapError extends Error {
  constructor(
    readonly expected: number,
    readonly found: number,
  ) {
    super(
      `Migration history has a gap: expected version ${expected} but the next available is ` +
        `${found}. Applying it would skip a schema step.`,
    );
    this.name = 'MigrationGapError';
  }
}

/** A previously applied migration file has been edited since it was applied. */
export class MigrationChecksumError extends Error {
  constructor(
    readonly version: number,
    readonly migrationName: string,
  ) {
    super(
      `Migration ${String(version).padStart(4, '0')}_${migrationName} has changed since it was applied. ` +
        `Shipped migrations are immutable - edit one and devices that already ran it will ` +
        `silently hold a different schema. Add a new migration instead.`,
    );
    this.name = 'MigrationChecksumError';
  }
}

export type MigrationOutcome =
  | { readonly status: 'up-to-date'; readonly version: number }
  | {
      readonly status: 'migrated';
      readonly from: number;
      readonly to: number;
      readonly applied: readonly string[];
    };

async function readUserVersion(db: SqlDriver): Promise<number> {
  const value = await db.selectValue<number>('PRAGMA user_version');
  return Number(value ?? 0);
}

function assertContiguous(current: number, pending: readonly Migration[]): void {
  let expected = current + 1;
  for (const migration of pending) {
    if (migration.version !== expected) {
      throw new MigrationGapError(expected, migration.version);
    }
    expected += 1;
  }
}

export async function migrate(
  db: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationOutcome> {
  const latest = migrations.at(-1)?.version ?? 0;
  const current = await readUserVersion(db);

  if (current > latest) throw new SchemaTooNewError(current, latest);
  if (current === latest) return { status: 'up-to-date', version: current };

  const pending = migrations.filter((m) => m.version > current);
  assertContiguous(current, pending);

  // PRAGMA foreign_keys is a no-op inside a transaction, and table rebuilds
  // (the 12-step ALTER TABLE dance) need it off. Toggle it outside, and restore
  // it even if a migration throws.
  await db.execScript('PRAGMA foreign_keys = OFF');
  const applied: string[] = [];

  try {
    for (const migration of pending) {
      await db.transaction(async (tx) => {
        await tx.execScript(migration.sql);

        const violations = await tx.select('PRAGMA foreign_key_check');
        if (violations.length > 0) throw new MigrationIntegrityError(migration, violations);

        await tx.exec(
          'INSERT INTO _schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
          [migration.version, migration.name, migration.checksum, new Date().toISOString()],
        );

        // PRAGMA cannot be parameterized. `| 0` makes it unambiguous that this
        // is a code-controlled integer and never user input.
        await tx.execScript(`PRAGMA user_version = ${migration.version | 0}`);
      }, 'IMMEDIATE');

      applied.push(`${String(migration.version).padStart(4, '0')}_${migration.name}`);
    }
  } finally {
    await db.execScript('PRAGMA foreign_keys = ON');
  }

  return { status: 'migrated', from: current, to: latest, applied };
}

/**
 * Confirms every applied migration still matches the file that produced it.
 *
 * Intended for development, where editing a shipped migration is an easy
 * mistake to make and an almost invisible one to debug: the developer's database
 * is rebuilt and looks right, while every user who already migrated keeps the
 * old schema forever.
 */
export async function verifyAppliedChecksums(
  db: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const rows = await db.select<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM _schema_migrations',
  );
  const byVersion = new Map(migrations.map((m) => [m.version, m]));

  for (const row of rows) {
    const migration = byVersion.get(Number(row.version));
    if (migration === undefined) continue; // Applied by a newer build; not ours to judge.
    if (migration.checksum !== row.checksum) {
      throw new MigrationChecksumError(Number(row.version), String(row.name));
    }
  }
}

export { LATEST_SCHEMA_VERSION };
