/**
 * Imports the shipped migration fixture - the actual file in `fixtures/`, read
 * from disk, not a copy pasted into the test.
 *
 * The point is to prove the documented migration behaviour against the thing a
 * user would actually feed in. Every claim in docs/MIGRATION.md about what
 * happens to an awkward record is asserted here, so the documentation cannot
 * quietly drift away from the code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { applyImport, inspectBackup } from './import.service';

const FIXTURE = resolve(process.cwd(), 'fixtures/legacy-stock-guardian-backup.json');
const CONTEXT: ItemContext = { today: '2026-08-14', defaultThreshold: 5, expiryWindows: [7, 30, 90] };

describe('the shipped legacy fixture', () => {
  let db: SqlDriver;
  let items: ReturnType<typeof createItemsRepository>;
  let locations: ReturnType<typeof createLocationsRepository>;
  let file: string;

  beforeEach(async () => {
    file = readFileSync(FIXTURE, 'utf8');
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    items = createItemsRepository(db);
    locations = createLocationsRepository(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  const byName = async (name: string) => {
    const page = await items.list(CONTEXT, { filters: { search: name }, lang: 'pt-BR' });
    return page.rows.find((row) => row.name === name);
  };

  const importFixture = async () => {
    const preview = await inspectBackup(file, db);
    expect(preview.ok).toBe(true);
    expect(preview.source).toBe('legacy');
    const result = await applyImport(db, preview.payload!, 'merge');
    return { preview, result };
  };

  it('is valid JSON in the original application\'s exact format', () => {
    const parsed: unknown = JSON.parse(file);
    expect(Array.isArray(parsed)).toBe(true);
    const first = (parsed as Record<string, unknown>[])[0];
    expect(Object.keys(first ?? {}).sort()).toEqual(['cat', 'expiry', 'loc', 'name', 'qty']);
  });

  it('imports every usable record and rejects only the nameless one', async () => {
    const { preview, result } = await importFixture();
    const total = (JSON.parse(file) as unknown[]).length;

    expect(result.itemsInserted).toBe(total - 1);
    expect(preview.problems.some((p) => p.code === 'record-rejected')).toBe(true);
  });

  it('files Portuguese, English and Spanish category labels into the same categories', async () => {
    await importFixture();

    // "Alimentos" and "Food" - the original app kept these apart forever.
    expect((await byName('Arroz'))?.categoryId).toBe('food');
    expect((await byName('Rice'))?.categoryId).toBe('food');

    // "Água" and "Agua" differ only by an accent.
    expect((await byName('Água Mineral'))?.categoryId).toBe('water');
    expect((await byName('Agua Embotellada'))?.categoryId).toBe('water');

    expect((await byName('Gaze Esterilizada'))?.categoryId).toBe('medical');
    expect((await byName('Surgical Gloves'))?.categoryId).toBe('medical');

    // "Power" is the original English label; the category now displays as Energy.
    expect((await byName('Power Bank'))?.categoryId).toBe('power');
    expect((await byName('Pilhas'))?.categoryId).toBe('power');
  });

  it('creates each location once, whatever case it was written in', async () => {
    await importFixture();
    const all = await locations.list();
    const names = all.map((location) => location.name.toLowerCase()).sort();

    // "Garagem" and "garagem" are the same place.
    expect(names.filter((name) => name === 'garagem')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps an item whose expiry was blank, as an item that does not expire', async () => {
    await importFixture();
    const hammer = await byName('Martelo');
    expect(hammer?.expirationDate).toBeNull();
    expect(hammer?.expiryBucket).toBe('none');
  });

  it('keeps an item that had no expiry field at all', async () => {
    await importFixture();
    const compass = await byName('Bússola');
    expect(compass).toBeDefined();
    expect(compass?.expirationDate).toBeNull();
  });

  it('preserves an unreadable quantity instead of inventing one', async () => {
    await importFixture();
    const tarp = await byName('Lona Impermeável');
    expect(tarp?.quantity).toBe(0);

    const stored = await items.getById(tarp!.id);
    expect(stored?.migrationNotes).toContain('cerca de 3');
  });

  it('preserves an impossible date instead of storing it', async () => {
    await importFixture();
    // 2026-02-30 does not exist. The original app compared it as a string and
    // sorted it happily between real dates.
    const milk = await byName('Leite em Pó');
    expect(milk?.expirationDate).toBeNull();

    const stored = await items.getById(milk!.id);
    expect(stored?.migrationNotes).toContain('2026-02-30');
  });

  it('recreates a category the original app never shipped', async () => {
    await importFixture();
    const seeds = await byName('Sementes de Feijão');
    expect(seeds?.categoryId).toBe('imported-horta-do-sitio');
    expect(seeds?.categoryName).toBe('Horta do Sítio');
  });

  it('imports a record whose every optional field was blank', async () => {
    await importFixture();
    const soap = await byName('Sabonete');
    expect(soap).toBeDefined();
    expect(soap).toMatchObject({ quantity: 0, categoryId: null, locationId: null, expirationDate: null });
  });

  it('keeps fields the original application never defined', async () => {
    await importFixture();
    const radio = await byName('Rádio a Manivela');
    const stored = await items.getById(radio!.id);

    expect(stored?.migrationNotes).toContain('comprado_em');
    expect(stored?.migrationNotes).toContain('Testar as pilhas');
  });

  it('leaves the reference catalog untouched', async () => {
    await importFixture();
    expect(await db.selectValue<number>('SELECT count(*) FROM catalog_items')).toBe(194);
  });

  it('produces a database that is still consistent afterwards', async () => {
    await importFixture();
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.selectValue<string>('PRAGMA integrity_check')).toBe('ok');
  });

  it('is idempotent: importing twice as a merge adds nothing the second time', async () => {
    const first = await importFixture();
    const preview = await inspectBackup(file, db);
    const second = await applyImport(db, preview.payload!, 'merge');

    expect(second.itemsInserted).toBe(0);
    expect(second.itemsSkipped).toBe(first.result.itemsInserted);
  });
});
