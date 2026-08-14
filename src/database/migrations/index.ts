/**
 * Loads the migration set from the .sql files beside this module.
 *
 * `import.meta.glob` behaves identically under Vite and Vitest, which is the
 * point: tests execute the literal production SQL files rather than a
 * hand-maintained copy that can silently drift.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const FILENAME_PATTERN = /(\d{4})_(.+)\.sql$/;

/**
 * FNV-1a, 32-bit, hex.
 *
 * Deliberately not a cryptographic hash: this detects an accidentally edited
 * migration, not an adversary. Web Crypto is async and would force the loader
 * to be async for no benefit.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const modules = import.meta.glob('./*.sql', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

function loadMigrations(): Migration[] {
  const loaded = Object.entries(modules).map(([path, sql]) => {
    const match = FILENAME_PATTERN.exec(path);
    if (match === null) {
      throw new Error(
        `Migration "${path}" does not follow the NNNN_name.sql convention. ` +
          `Ordering depends on that prefix.`,
      );
    }
    const [, digits, name] = match;
    return {
      version: Number(digits),
      name: name as string,
      sql,
      checksum: fnv1a(sql),
    } satisfies Migration;
  });

  loaded.sort((a, b) => a.version - b.version);

  const seen = new Set<number>();
  for (const migration of loaded) {
    if (migration.version < 1) {
      throw new Error(`Migration versions start at 1; found ${migration.version}.`);
    }
    if (seen.has(migration.version)) {
      throw new Error(
        `Two migrations share version ${migration.version}. Versions must be unique - ` +
          `a collision would leave one of them silently unapplied on some devices.`,
      );
    }
    seen.add(migration.version);
  }

  return loaded;
}

export const MIGRATIONS: readonly Migration[] = loadMigrations();

export const LATEST_SCHEMA_VERSION: number = MIGRATIONS.at(-1)?.version ?? 0;
