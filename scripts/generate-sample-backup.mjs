#!/usr/bin/env node
/**
 * Produces `fixtures/sample-backup.json` - a complete, valid v2 backup.
 *
 * Built by actually running the migration: it creates a database, applies the
 * schema, seeds the reference data, imports the shipped legacy fixture, and
 * exports the result. So the sample is not hand-written and cannot describe a
 * format the code does not produce.
 *
 * Run with `npm run generate:sample`.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// The application's modules are TypeScript, so run them through Vite's pipeline
// rather than maintaining a duplicate JavaScript copy of the export logic.
const { createServer } = require('vite');

const server = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { createMemoryDriver } = await server.ssrLoadModule('/src/database/driver/memory.driver.ts');
  const { migrate } = await server.ssrLoadModule('/src/database/migrations/runner.ts');
  const { seedDatabase } = await server.ssrLoadModule('/src/database/seed/seed.ts');
  const { inspectBackup, applyImport } = await server.ssrLoadModule(
    '/src/services/backup/import.service.ts',
  );
  const { buildBackup } = await server.ssrLoadModule('/src/services/backup/export.service.ts');

  const db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);

  const legacy = readFileSync(resolve(ROOT, 'fixtures/legacy-stock-guardian-backup.json'), 'utf8');
  const preview = await inspectBackup(legacy, db);
  if (!preview.ok || preview.payload === null) {
    throw new Error(`the legacy fixture did not import: ${JSON.stringify(preview.problems)}`);
  }
  const result = await applyImport(db, preview.payload, 'merge');

  // A couple of movements, so the sample shows history and stock targets too.
  const items = await db.select('SELECT id, name FROM items ORDER BY name LIMIT 3');
  const now = new Date('2026-08-14T09:00:00.000Z').toISOString();
  for (const [index, item] of items.entries()) {
    await db.exec(
      `UPDATE items SET minimum_quantity = ?, ideal_quantity = ?, updated_at = ? WHERE id = ?`,
      [(index + 1) * 5, (index + 1) * 15, now, item.id],
    );
    await db.exec(
      `INSERT INTO stock_transactions
         (id, item_id, type, quantity, quantity_before, quantity_after, occurred_at, notes, created_at)
       VALUES (?, ?, 'purchase', 2, 0, 2, ?, 'sample movement', ?)`,
      [`sample-tx-${String(index)}`, item.id, now, now],
    );
  }

  const backup = await buildBackup(db, { includeTransactions: true });
  // A fixed timestamp keeps the file byte-stable across regenerations, so it
  // does not appear in every diff for no reason.
  const stable = { ...backup, exportedAt: '2026-08-14T09:00:00.000Z' };

  mkdirSync(resolve(ROOT, 'fixtures'), { recursive: true });
  writeFileSync(
    resolve(ROOT, 'fixtures/sample-backup.json'),
    `${JSON.stringify(stable, null, 2)}\n`,
    'utf8',
  );

  console.log('generate-sample-backup: fixtures/sample-backup.json');
  console.log(`  items        ${String(backup.data.items.length)} (imported ${String(result.itemsInserted)})`);
  console.log(`  categories   ${String(backup.data.categories.length)}`);
  console.log(`  locations    ${String(backup.data.locations.length)}`);
  console.log(`  transactions ${String(backup.data.transactions.length)}`);
  console.log(`  checksum     ${backup.checksum ?? '(none)'}`);

  await db.close();
} finally {
  await server.close();
}
