import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { resolveItem } from './resolve';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

describe('resolveItem', () => {
  let db: SqlDriver;
  let items: ReturnType<typeof createItemsRepository>;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    items = createItemsRepository(db);
    await items.create({ name: 'Feijão Preto', quantity: 12, unit: 'latas' });
    await items.create({ name: 'Feijão Carioca', quantity: 4, unit: 'latas' });
    await items.create({ name: 'Arroz Branco', quantity: 10, unit: 'kg' });
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('matches one item exactly, accents and all', async () => {
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao preto');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Feijão Preto');
  });

  it('matches a single item from a partial phrase', async () => {
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'arroz');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Arroz Branco');
  });

  it('never guesses between two equally good matches', async () => {
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao');
    expect(result.kind).toBe('many');
    if (result.kind === 'many') expect(result.items).toHaveLength(2);
  });

  it('prefers an exact name over a longer one that also contains it', async () => {
    await items.create({ name: 'Feijão', quantity: 1, unit: 'kg' });
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Feijão');
  });

  it('reports nothing found rather than returning an empty list', async () => {
    expect((await resolveItem(items, CONTEXT, 'pt-BR', 'quinoa')).kind).toBe('none');
  });

  it('treats a blank phrase as nothing found', async () => {
    expect((await resolveItem(items, CONTEXT, 'pt-BR', '   ')).kind).toBe('none');
  });

  it('caps a large tie at five choices rather than reciting the whole shelf', async () => {
    for (const name of ['Feijão Branco', 'Feijão Fradinho', 'Feijão Verde', 'Feijão Azuki', 'Feijão Rosinha']) {
      await items.create({ name, quantity: 1, unit: 'kg' });
    }
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao');
    expect(result.kind).toBe('many');
    if (result.kind === 'many') expect(result.items).toHaveLength(5);
  });

  it('never offers an archived item', async () => {
    const preto = await items.create({ name: 'Feijão Fradinho', quantity: 3, unit: 'kg' });
    await items.archive(preto.id);
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao fradinho');
    expect(result.kind).toBe('none');
  });

  it('leaves an archived item out of a tie instead of raising a choice', async () => {
    const carioca = (await items.list(CONTEXT, { filters: { search: 'feijao carioca' } })).rows[0];
    expect(carioca).toBeDefined();
    if (carioca !== undefined) await items.archive(carioca.id);
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Feijão Preto');
  });

  it('finds an item whose only match is a word in its notes', async () => {
    await items.create({ name: 'Macarrão', quantity: 2, unit: 'pacotes', notes: 'formato espaguete' });
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'espaguete');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Macarrão');
  });

  it('prefers a name match to a notes match', async () => {
    await items.create({ name: 'Macarrão', quantity: 2, unit: 'pacotes', notes: 'servir com feijao' });
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao preto');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Feijão Preto');
  });

  it('folds case and accents in the stored name, not just in the phrase', async () => {
    await items.create({ name: 'ÁGUA MINERAL', quantity: 6, unit: 'garrafas' });
    const exact = await resolveItem(items, CONTEXT, 'pt-BR', 'agua mineral');
    expect(exact.kind).toBe('one');
    if (exact.kind === 'one') expect(exact.item.name).toBe('ÁGUA MINERAL');

    const partial = await resolveItem(items, CONTEXT, 'pt-BR', 'agua');
    expect(partial.kind).toBe('one');
    if (partial.kind === 'one') expect(partial.item.name).toBe('ÁGUA MINERAL');
  });

  it('finds an item by the translated name a backup import gave it', async () => {
    const rice = await items.create({ name: 'Rice', quantity: 3, unit: 'kg' });
    await db.exec(
      `INSERT INTO item_names (item_id, lang, name, name_norm)
       VALUES (:id, 'pt-BR', 'Arroz Integral', 'arroz integral')`,
      { id: rice.id },
    );
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'arroz integral');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Rice');
  });
  it('ranks a name match above a row the search matched only by category', async () => {
    // 'water' is 'Água' in pt-BR, so the search returns this item for 'agua'
    // even though nothing in its own name or notes says so.
    await items.create({ name: 'Sal Grosso', quantity: 1, unit: 'kg', categoryId: 'water' });

    const only = await resolveItem(items, CONTEXT, 'pt-BR', 'agua');
    expect(only.kind).toBe('one');
    if (only.kind === 'one') expect(only.item.name).toBe('Sal Grosso');

    await items.create({ name: 'Água Mineral', quantity: 6, unit: 'garrafas' });
    const both = await resolveItem(items, CONTEXT, 'pt-BR', 'agua');
    expect(both.kind).toBe('one');
    if (both.kind === 'one') expect(both.item.name).toBe('Água Mineral');
  });
});
