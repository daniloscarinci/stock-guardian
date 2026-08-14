import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { buildBackup, serializeBackup, backupFilename } from './export.service';
import { applyImport, inspectBackup } from './import.service';
import { mapLegacyRecord, mapLegacyBackup } from './legacy';
import { canonicalJson, checksumOf } from './format';

const CONTEXT: ItemContext = { today: '2026-08-14', defaultThreshold: 5, expiryWindows: [7, 30, 90] };

/** A record exactly as the original application exported it. */
const legacyRecord = (overrides: Record<string, unknown> = {}) => ({
  name: 'Arroz',
  qty: '10',
  loc: 'Despensa',
  expiry: '2026-12-31',
  cat: 'Alimentos',
  ...overrides,
});

describe('backup and import', () => {
  let db: SqlDriver;
  let items: ReturnType<typeof createItemsRepository>;
  let locations: ReturnType<typeof createLocationsRepository>;
  let settings: ReturnType<typeof createSettingsRepository>;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    items = createItemsRepository(db);
    locations = createLocationsRepository(db);
    settings = createSettingsRepository(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  const itemCount = async () =>
    (await db.selectValue<number>('SELECT count(*) FROM items')) ?? 0;

  // =========================================================================
  describe('legacy record mapping', () => {
    it('maps every field of a well-formed record', () => {
      const result = mapLegacyRecord(legacyRecord());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.item).toMatchObject({
        name: 'Arroz',
        quantity: 10,
        unit: 'un',
        locationName: 'Despensa',
        categoryId: 'food',
        expirationDate: '2026-12-31',
        migrationNotes: null,
      });
    });

    it('resolves the category whichever language it was saved in', () => {
      for (const [label, expected] of [
        ['Alimentos', 'food'],
        ['Food', 'food'],
        ['Água', 'water'],
        ['Agua', 'water'],
        ['Water', 'water'],
        ['Comunicação', 'communication'],
        ['Comunicación', 'communication'],
        ['Power', 'power'],
        ['Energía', 'power'],
      ] as const) {
        const result = mapLegacyRecord(legacyRecord({ cat: label }));
        expect(result.ok && result.item.categoryId, label).toBe(expected);
      }
    });

    it('keeps an unrecognised category rather than discarding it', () => {
      const result = mapLegacyRecord(legacyRecord({ cat: 'Meu Bunker' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.item.categoryId).toBeNull();
      expect(result.item.categoryLabel).toBe('Meu Bunker');
      expect(result.item.migrationNotes).toContain('Meu Bunker');
    });

    it('records an unreadable quantity instead of guessing', () => {
      const result = mapLegacyRecord(legacyRecord({ qty: 'about ten' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.item.quantity).toBe(0);
      expect(result.item.migrationNotes).toContain('about ten');
    });

    it('treats a blank quantity as zero without complaint', () => {
      const result = mapLegacyRecord(legacyRecord({ qty: '' }));
      expect(result.ok && result.item.quantity).toBe(0);
      expect(result.ok && result.item.migrationNotes).toBeNull();
    });

    it('preserves an impossible date rather than storing it', () => {
      const result = mapLegacyRecord(legacyRecord({ expiry: '2026-02-30' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.item.expirationDate).toBeNull();
      expect(result.item.migrationNotes).toContain('2026-02-30');
    });

    it('accepts a record with no expiry, which the original app could not store', () => {
      const result = mapLegacyRecord(legacyRecord({ expiry: '' }));
      expect(result.ok && result.item.expirationDate).toBeNull();
      expect(result.ok && result.item.migrationNotes).toBeNull();
    });

    it('keeps fields the original application never defined', () => {
      const result = mapLegacyRecord(legacyRecord({ customField: 'keep me', tags: ['a', 'b'] }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.item.migrationNotes).toContain('keep me');
      expect(result.item.migrationNotes).toContain('tags');
    });

    it('rejects a record with no name, and says so', () => {
      const result = mapLegacyRecord(legacyRecord({ name: '   ' }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.reason).toBe('missing-name');
    });

    it('summarises a whole legacy file', () => {
      const summary = mapLegacyBackup([
        legacyRecord(),
        legacyRecord({ name: '' }),
        legacyRecord({ qty: 'lots' }),
        legacyRecord({ expiry: 'soon' }),
        legacyRecord({ cat: 'Unknown Thing' }),
      ]);

      expect(summary.counts).toEqual({
        total: 5,
        mapped: 4,
        rejected: 1,
        quantityUnreadable: 1,
        expiryUnreadable: 1,
        categoryUnrecognised: 1,
        extraFields: 0,
      });
    });
  });

  // =========================================================================
  describe('inspecting a legacy backup', () => {
    it('reads a file in the exact format the original app exported', async () => {
      const file = JSON.stringify([legacyRecord(), legacyRecord({ name: 'Feijão', cat: 'Food' })], null, 2);
      const preview = await inspectBackup(file, db);

      expect(preview.ok).toBe(true);
      expect(preview.source).toBe('legacy');
      expect(preview.counts.items).toBe(2);
      expect(await itemCount()).toBe(0); // nothing written yet
    });

    it('reports problems without blocking a salvageable file', async () => {
      const file = JSON.stringify([legacyRecord({ qty: 'ten' }), legacyRecord({ name: '' })]);
      const preview = await inspectBackup(file, db);

      expect(preview.ok).toBe(true);
      expect(preview.problems.map((p) => p.code).sort()).toEqual([
        'field-unreadable',
        'record-rejected',
      ]);
      expect(preview.problems.every((p) => p.severity === 'warning')).toBe(true);
    });
  });

  // =========================================================================
  describe('importing a legacy backup', () => {
    it('lands every field where it belongs', async () => {
      const file = JSON.stringify([legacyRecord()]);
      const preview = await inspectBackup(file, db);
      const result = await applyImport(db, preview.payload!, 'merge');

      expect(result.itemsInserted).toBe(1);

      const row = (await items.list(CONTEXT, { lang: 'pt-BR' })).rows[0];
      expect(row).toMatchObject({
        name: 'Arroz',
        quantity: 10,
        unit: 'un',
        expirationDate: '2026-12-31',
        categoryId: 'food',
        categoryName: 'Alimentos',
        locationName: 'Despensa',
      });
    });

    it('files a record saved in English into the same category as one saved in Portuguese', async () => {
      // This is the original app's category bug, tested end to end.
      const file = JSON.stringify([
        legacyRecord({ name: 'Arroz', cat: 'Alimentos' }),
        legacyRecord({ name: 'Rice', cat: 'Food' }),
      ]);
      const preview = await inspectBackup(file, db);
      await applyImport(db, preview.payload!, 'merge');

      const rows = (await items.list(CONTEXT)).rows;
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.categoryId))).toEqual(new Set(['food']));
    });

    it('creates the location once for records that share it', async () => {
      const file = JSON.stringify([
        legacyRecord({ name: 'Arroz', loc: 'Despensa' }),
        legacyRecord({ name: 'Feijão', loc: 'despensa' }),
        legacyRecord({ name: 'Sal', loc: 'DESPENSA' }),
      ]);
      const preview = await inspectBackup(file, db);
      await applyImport(db, preview.payload!, 'merge');

      expect(await locations.list()).toHaveLength(1);
    });

    it('reuses a location the user already has', async () => {
      const existing = await locations.create({ name: 'Despensa' });
      const preview = await inspectBackup(JSON.stringify([legacyRecord()]), db);
      await applyImport(db, preview.payload!, 'merge');

      expect(await locations.list()).toHaveLength(1);
      const row = (await items.list(CONTEXT)).rows[0];
      expect(row?.locationId).toBe(existing.id);
    });

    it('recreates an unrecognised category instead of losing the classification', async () => {
      const file = JSON.stringify([legacyRecord({ cat: 'Meu Bunker' })]);
      const preview = await inspectBackup(file, db);
      await applyImport(db, preview.payload!, 'merge');

      const row = (await items.list(CONTEXT)).rows[0];
      expect(row?.categoryId).toBe('imported-meu-bunker');
      expect(row?.categoryName).toBe('Meu Bunker');
    });

    it('preserves unmapped values on the item', async () => {
      const file = JSON.stringify([legacyRecord({ qty: 'about ten', customField: 'keep me' })]);
      const preview = await inspectBackup(file, db);
      await applyImport(db, preview.payload!, 'merge');

      const item = (await items.list(CONTEXT)).rows[0];
      const stored = await items.getById(item!.id);
      expect(stored?.migrationNotes).toContain('about ten');
      expect(stored?.migrationNotes).toContain('keep me');
    });

    it('imports an item with no expiry date at all', async () => {
      const file = JSON.stringify([legacyRecord({ name: 'Martelo', expiry: '', cat: 'Ferramentas' })]);
      const preview = await inspectBackup(file, db);
      await applyImport(db, preview.payload!, 'merge');

      const row = (await items.list(CONTEXT)).rows[0];
      expect(row?.expirationDate).toBeNull();
      expect(row?.expiryBucket).toBe('none');
    });
  });

  // =========================================================================
  describe('round-tripping a v2 backup', () => {
    beforeEach(async () => {
      const pantry = await locations.create({ name: 'Pantry' });
      const shelf = await locations.create({ name: 'Top shelf', parentId: pantry.id });
      const item = await items.create({
        name: 'Água Mineral',
        categoryId: 'water',
        locationId: shelf.id,
        quantity: 12,
        unit: 'L',
        minimumQuantity: 20,
        idealQuantity: 60,
        expirationDate: '2027-01-01',
        notes: 'six-packs',
      });
      await items.adjustQuantity(item.id, 6, { type: 'purchase' });
      await settings.save({ language: 'pt-BR', defaultLowStockThreshold: 0 });
    });

    it('carries everything the user created', async () => {
      const backup = await buildBackup(db, { includeTransactions: true });

      expect(backup.format).toBe('stock-guardian-backup');
      expect(backup.formatVersion).toBe(2);
      expect(backup.counts?.items).toBe(1);
      expect(backup.data.locations).toHaveLength(2);
      expect(backup.data.transactions).toHaveLength(1);
      expect(backup.data.settings.language).toBe('pt-BR');
    });

    it('leaves the reference catalog out', async () => {
      const backup = await buildBackup(db);
      expect(JSON.stringify(backup)).not.toContain('catalog_items');
      // Only the seeded categories, which are needed to interpret item links.
      expect(backup.data.categories).toHaveLength(20);
    });

    it('omits movement history unless asked for it', async () => {
      const backup = await buildBackup(db);
      expect(backup.data.transactions).toEqual([]);
    });

    it('restores into an empty database exactly', async () => {
      const file = await serializeBackup(db, { includeTransactions: true });

      const fresh = await createMemoryDriver();
      try {
        await migrate(fresh);
        await seedDatabase(fresh);
        const preview = await inspectBackup(file, fresh);
        expect(preview.ok).toBe(true);
        expect(preview.checksumValid).toBe(true);

        const result = await applyImport(fresh, preview.payload!, 'replace');
        expect(result.itemsInserted).toBe(1);

        const restored = createItemsRepository(fresh);
        const row = (await restored.list(CONTEXT)).rows[0];
        expect(row).toMatchObject({
          name: 'Água Mineral',
          quantity: 18,
          unit: 'L',
          minimumQuantity: 20,
          idealQuantity: 60,
          expirationDate: '2027-01-01',
          notes: 'six-packs',
          locationName: 'Top shelf',
        });

        const freshSettings = createSettingsRepository(fresh);
        expect((await freshSettings.load()).settings.defaultLowStockThreshold).toBe(0);
      } finally {
        await fresh.close().catch(() => undefined);
      }
    });

    it('restores the location hierarchy even when a child is listed first', async () => {
      const backup = await buildBackup(db);
      // Reverse the order so a child precedes its parent, which a naive insert
      // would reject on the foreign key.
      const reordered = { ...backup, data: { ...backup.data, locations: [...backup.data.locations].reverse() } };
      const file = JSON.stringify({ ...reordered, checksum: await checksumOf(reordered.data) });

      const fresh = await createMemoryDriver();
      try {
        await migrate(fresh);
        await seedDatabase(fresh);
        const preview = await inspectBackup(file, fresh);
        await applyImport(fresh, preview.payload!, 'replace');

        const freshLocations = createLocationsRepository(fresh);
        const tree = await freshLocations.tree();
        expect(tree).toHaveLength(1);
        expect(tree[0]?.children[0]?.name).toBe('Top shelf');
      } finally {
        await fresh.close().catch(() => undefined);
      }
    });
  });

  // =========================================================================
  describe('merge versus replace', () => {
    beforeEach(async () => {
      await items.create({ name: 'Existing', categoryId: 'food', quantity: 5 });
    });

    it('merge keeps what is already there', async () => {
      const file = JSON.stringify([legacyRecord({ name: 'Novo' })]);
      const preview = await inspectBackup(file, db);
      await applyImport(db, preview.payload!, 'merge');

      const names = (await items.list(CONTEXT)).rows.map((r) => r.name).sort();
      expect(names).toEqual(['Existing', 'Novo']);
    });

    it('merge skips an item that is already present', async () => {
      const file = JSON.stringify([
        legacyRecord({ name: 'Existing', cat: 'Food', expiry: '' }),
        legacyRecord({ name: 'Novo' }),
      ]);
      const preview = await inspectBackup(file, db);
      expect(preview.duplicates).toBe(1);

      const result = await applyImport(db, preview.payload!, 'merge');
      expect(result.itemsInserted).toBe(1);
      expect(result.itemsSkipped).toBe(1);
      expect(await itemCount()).toBe(2);
    });

    it('replace clears user data but keeps the built-in catalog', async () => {
      const file = JSON.stringify([legacyRecord({ name: 'Novo' })]);
      const preview = await inspectBackup(file, db);
      await applyImport(db, preview.payload!, 'replace');

      expect((await items.list(CONTEXT)).rows.map((r) => r.name)).toEqual(['Novo']);
      expect(await db.selectValue<number>('SELECT count(*) FROM catalog_items')).toBe(194);
      expect(await db.selectValue<number>('SELECT count(*) FROM categories WHERE is_system = 1')).toBe(20);
    });
  });

  // =========================================================================
  describe('a failed import never destroys existing data', () => {
    beforeEach(async () => {
      await items.create({ name: 'Precious', quantity: 42 });
    });

    const expectUntouched = async () => {
      const rows = (await items.list(CONTEXT)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Precious', quantity: 42 });
    };

    it.each([
      ['not JSON at all', 'this is not json {{{'],
      ['an empty file', ''],
      ['a JSON scalar', '42'],
      ['a JSON string', '"hello"'],
      ['null', 'null'],
      ['an unrelated object', '{"hello":"world"}'],
      ['an object claiming the wrong format', '{"format":"some-other-app","data":{}}'],
    ])('refuses %s', async (_label, content) => {
      const preview = await inspectBackup(content, db);
      expect(preview.ok).toBe(false);
      expect(preview.payload).toBeNull();
      expect(preview.problems[0]?.severity).toBe('error');
      await expectUntouched();
    });

    it('says the existing data is safe, in words a user can act on', async () => {
      const preview = await inspectBackup('{"format":"other"}', db);
      expect(preview.problems[0]?.detail).toMatch(/has NOT been changed/i);
      expect(preview.problems[0]?.detail).not.toMatch(/JSON|token|undefined|SyntaxError/i);
    });

    it('refuses a v2 envelope with a damaged body', async () => {
      const preview = await inspectBackup(
        JSON.stringify({
          format: 'stock-guardian-backup',
          formatVersion: 2,
          schemaVersion: 1,
          appVersion: '2.0.0',
          exportedAt: new Date().toISOString(),
          data: { items: [{ notAName: true }] },
        }),
        db,
      );
      expect(preview.ok).toBe(false);
      expect(preview.problems[0]?.code).toBe('invalid-structure');
      await expectUntouched();
    });

    it('refuses a backup from a newer schema without touching anything', async () => {
      const backup = await buildBackup(db);
      const file = JSON.stringify({ ...backup, schemaVersion: 999 });
      const preview = await inspectBackup(file, db);

      expect(preview.ok).toBe(false);
      expect(preview.problems.some((p) => p.code === 'newer-schema')).toBe(true);
      await expectUntouched();
    });

    it('refuses a backup from a newer file format', async () => {
      const backup = await buildBackup(db);
      const preview = await inspectBackup(JSON.stringify({ ...backup, formatVersion: 99 }), db);
      expect(preview.ok).toBe(false);
      expect(preview.problems.some((p) => p.code === 'newer-format')).toBe(true);
    });

    it('rolls back completely when a write fails partway through', async () => {
      // `replace` deletes the existing inventory as its first act. If a later
      // insert fails and the transaction did not roll back, the user would be
      // left with neither their old data nor their new data - the single worst
      // outcome this whole design exists to prevent.
      const preview = await inspectBackup(JSON.stringify([legacyRecord({ name: 'A' })]), db);
      const payload = preview.payload!;
      const poisoned = {
        ...payload,
        data: {
          ...payload.data,
          // Violates the schema's `priority BETWEEN 1 AND 4` check constraint.
          items: [{ ...payload.data.items[0]!, priority: 99 }],
        },
      };

      await expect(applyImport(db, poisoned, 'replace')).rejects.toThrow();
      await expectUntouched();
    });
  });

  // =========================================================================
  describe('hostile input', () => {
    it('stores markup as literal text rather than interpreting it', async () => {
      // The original app interpolated item names straight into innerHTML, so a
      // crafted backup was a code-execution vector that survived reloads.
      const payload = '<img src=x onerror=alert(1)>';
      const preview = await inspectBackup(JSON.stringify([legacyRecord({ name: payload })]), db);
      await applyImport(db, preview.payload!, 'merge');

      const row = (await items.list(CONTEXT)).rows[0];
      expect(row?.name).toBe(payload);
      const stored = await db.selectValue<string>('SELECT name FROM items LIMIT 1');
      expect(stored).toBe(payload);
    });

    it('does not let a crafted string reach the SQL engine as syntax', async () => {
      const payload = "'; DROP TABLE items; --";
      const preview = await inspectBackup(JSON.stringify([legacyRecord({ name: payload })]), db);
      await applyImport(db, preview.payload!, 'merge');

      expect(await itemCount()).toBe(1);
      expect(await db.selectValue<number>('SELECT count(*) FROM catalog_items')).toBe(194);
      expect((await items.list(CONTEXT)).rows[0]?.name).toBe(payload);
    });

    it('finds an item whose name contains SQL wildcards, literally', async () => {
      const preview = await inspectBackup(JSON.stringify([legacyRecord({ name: '100% Cotton' })]), db);
      await applyImport(db, preview.payload!, 'merge');

      expect((await items.list(CONTEXT, { filters: { search: '100%' } })).rows).toHaveLength(1);
      expect((await items.list(CONTEXT, { filters: { search: '%%%' } })).rows).toHaveLength(0);
    });

    it('strips control characters that would corrupt exports and reports', async () => {
      const preview = await inspectBackup(
        JSON.stringify([legacyRecord({ name: 'Rice  Bag' })]),
        db,
      );
      await applyImport(db, preview.payload!, 'merge');
      expect((await items.list(CONTEXT)).rows[0]?.name).toBe('Rice Bag');
    });

    it('caps an absurdly long name instead of storing it whole', async () => {
      const preview = await inspectBackup(
        JSON.stringify([legacyRecord({ name: 'A'.repeat(100_000) })]),
        db,
      );
      await applyImport(db, preview.payload!, 'merge');
      const name = (await items.list(CONTEXT)).rows[0]?.name ?? '';
      expect(name.length).toBe(500);
    });

    it('refuses a file beyond the size limit', async () => {
      const huge = `[${'{"name":"x"},'.repeat(10)}{"name":"x"}]`.padEnd(65 * 1024 * 1024, ' ');
      const preview = await inspectBackup(huge, db);
      expect(preview.ok).toBe(false);
      expect(preview.problems[0]?.code).toBe('file-too-large');
    });

    it('rejects a quantity of Infinity rather than storing it', async () => {
      const preview = await inspectBackup(JSON.stringify([legacyRecord({ qty: '1e999' })]), db);
      await applyImport(db, preview.payload!, 'merge');
      expect((await items.list(CONTEXT)).rows[0]?.quantity).toBe(0);
    });

    it('does not follow a path-like value anywhere', async () => {
      const payload = '../../../etc/passwd';
      const preview = await inspectBackup(JSON.stringify([legacyRecord({ loc: payload })]), db);
      await applyImport(db, preview.payload!, 'merge');
      expect((await locations.list()).map((l) => l.name)).toEqual([payload]);
    });
  });

  // =========================================================================
  describe('checksums', () => {
    it('is stable regardless of key order', async () => {
      const a = await checksumOf({ x: 1, y: [1, 2], z: { b: 2, a: 1 } });
      const b = await checksumOf({ z: { a: 1, b: 2 }, y: [1, 2], x: 1 });
      expect(a).toBe(b);
    });

    it('changes when the data changes', async () => {
      expect(await checksumOf({ x: 1 })).not.toBe(await checksumOf({ x: 2 }));
    });

    it('sorts object keys but preserves array order', () => {
      expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
      expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    });

    it('warns when a backup has been edited, without refusing it', async () => {
      await items.create({ name: 'Rice' });
      const backup = await buildBackup(db);
      const tampered = {
        ...backup,
        data: { ...backup.data, items: [{ ...backup.data.items[0]!, quantity: 9999 }] },
      };

      const preview = await inspectBackup(JSON.stringify(tampered), db);
      expect(preview.ok).toBe(true);
      expect(preview.checksumValid).toBe(false);
      expect(preview.problems.some((p) => p.code === 'checksum-mismatch')).toBe(true);
    });
  });

  describe('filenames', () => {
    it('is dated and unambiguous', () => {
      expect(backupFilename(new Date(2026, 7, 14))).toBe('stock-guardian-backup-2026-08-14.json');
    });
  });
});
