import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { execute, type VoiceDeps } from './execute';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

describe('execute: queries', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const pantry = await locations.create({ name: 'Despensa' });

    await items.create({
      name: 'Arroz Branco', quantity: 10, unit: 'kg', locationId: pantry.id,
      minimumQuantity: 5,
    });
    await items.create({ name: 'Leite', quantity: 2, unit: 'l', expirationDate: '2026-09-12' });
    await items.create({
      name: 'Feijão Preto', quantity: 1, unit: 'kg', minimumQuantity: 10, idealQuantity: 20,
    });

    deps = { items, locations, context: CONTEXT, language: 'pt-BR' };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('answers a quantity question with the item and its number', async () => {
    const result = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'arroz' });
    expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'QUANTITY' } });
    if (result.kind === 'answer' && result.answer.kind === 'QUANTITY') {
      expect(result.answer.item.name).toBe('Arroz Branco');
      expect(result.answer.item.quantity).toBe(10);
    }
  });

  it('lists what is expiring inside the window', async () => {
    const result = await execute(deps, {
      kind: 'QUERY_EXPIRING', withinDays: 30, expiredOnly: false,
    });
    expect(result.kind).toBe('answer');
    if (result.kind === 'answer' && result.answer.kind === 'EXPIRING') {
      expect(result.answer.items.map((i) => i.name)).toContain('Leite');
    }
  });

  it('lists what is missing', async () => {
    const result = await execute(deps, { kind: 'QUERY_MISSING' });
    expect(result.kind).toBe('answer');
    if (result.kind === 'answer' && result.answer.kind === 'MISSING') {
      expect(result.answer.lines.length).toBeGreaterThan(0);
    }
  });

  it('says where an item is', async () => {
    const result = await execute(deps, { kind: 'QUERY_WHERE', item: 'arroz', location: null });
    if (result.kind === 'answer' && result.answer.kind === 'WHERE_ITEM') {
      expect(result.answer.item.locationName).toBe('Despensa');
    } else {
      throw new Error(`expected WHERE_ITEM, got ${result.kind}`);
    }
  });

  it('raises a choice instead of guessing', async () => {
    const items = createItemsRepository(db);
    await items.create({ name: 'Arroz Integral', quantity: 3, unit: 'kg' });
    const result = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'arroz' });
    expect(result.kind).toBe('choice');
  });

  it('reports an item it could not find, by the phrase that was said', async () => {
    const result = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'quinoa' });
    expect(result).toMatchObject({ kind: 'notFound', phrase: 'quinoa' });
  });

  it('counts the whole tie, not just the five it offers', async () => {
    const items = createItemsRepository(db);
    for (const name of ['Arroz Integral', 'Arroz Parboilizado', 'Arroz Arbóreo',
      'Arroz Cateto', 'Arroz Selvagem', 'Arroz Doce']) {
      await items.create({ name, quantity: 1, unit: 'kg' });
    }
    const result = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'arroz' });
    expect(result.kind).toBe('choice');
    if (result.kind === 'choice') {
      expect(result.items).toHaveLength(5);
      expect(result.total).toBe(7);
    }
  });

  it('lists what is in a location named only in part', async () => {
    const result = await execute(deps, { kind: 'QUERY_WHERE', item: null, location: 'despensa' });
    if (result.kind === 'answer' && result.answer.kind === 'WHERE_LOCATION') {
      expect(result.answer.locationName).toBe('Despensa');
      expect(result.answer.items.map((i) => i.name)).toEqual(['Arroz Branco']);
    } else {
      throw new Error(`expected WHERE_LOCATION, got ${result.kind}`);
    }
  });

  it('finds a location by the short name a speaker actually uses', async () => {
    const locations = createLocationsRepository(db);
    await locations.create({ name: 'Garagem Principal' });
    const result = await execute(deps, { kind: 'QUERY_WHERE', item: null, location: 'garagem' });
    if (result.kind === 'answer' && result.answer.kind === 'WHERE_LOCATION') {
      expect(result.answer.locationName).toBe('Garagem Principal');
      expect(result.answer.items).toHaveLength(0);
    } else {
      throw new Error(`expected WHERE_LOCATION, got ${result.kind}`);
    }
  });

  it('reports a location it could not find, by the phrase that was said', async () => {
    const result = await execute(deps, { kind: 'QUERY_WHERE', item: null, location: 'porao' });
    expect(result).toMatchObject({ kind: 'notFound', phrase: 'porao' });
  });

  it('answers the expiry of one item', async () => {
    const result = await execute(deps, { kind: 'QUERY_EXPIRY_OF', item: 'leite' });
    if (result.kind === 'answer' && result.answer.kind === 'EXPIRY_OF') {
      expect(result.answer.item.expirationDate).toBe('2026-09-12');
    } else {
      throw new Error(`expected EXPIRY_OF, got ${result.kind}`);
    }
  });

  it('falls back to the first warning window when no number was spoken', async () => {
    const result = await execute(deps, {
      kind: 'QUERY_EXPIRING', withinDays: null, expiredOnly: false,
    });
    if (result.kind === 'answer' && result.answer.kind === 'EXPIRING') {
      expect(result.answer.withinDays).toBe(7);
      expect(result.answer.items.map((i) => i.name)).toEqual(['Leite']);
    } else {
      throw new Error(`expected EXPIRING, got ${result.kind}`);
    }
  });

  it('leaves out what expires after the window', async () => {
    const items = createItemsRepository(db);
    await items.create({ name: 'Iogurte', quantity: 4, unit: 'un', expirationDate: '2026-11-30' });
    const result = await execute(deps, {
      kind: 'QUERY_EXPIRING', withinDays: 30, expiredOnly: false,
    });
    if (result.kind === 'answer' && result.answer.kind === 'EXPIRING') {
      expect(result.answer.items.map((i) => i.name)).not.toContain('Iogurte');
    } else {
      throw new Error(`expected EXPIRING, got ${result.kind}`);
    }
  });

  it('asks only for what has already expired when told to', async () => {
    const items = createItemsRepository(db);
    await items.create({ name: 'Pão', quantity: 1, unit: 'un', expirationDate: '2026-09-01' });
    const result = await execute(deps, {
      kind: 'QUERY_EXPIRING', withinDays: 30, expiredOnly: true,
    });
    if (result.kind === 'answer' && result.answer.kind === 'EXPIRING') {
      expect(result.answer.expiredOnly).toBe(true);
      expect(result.answer.items.map((i) => i.name)).toEqual(['Pão']);
    } else {
      throw new Error(`expected EXPIRING, got ${result.kind}`);
    }
  });

  it('scores a stocked inventory above an empty one, and never below zero', async () => {
    const result = await execute(deps, { kind: 'QUERY_SCORE' });
    if (result.kind === 'answer' && result.answer.kind === 'SCORE') {
      // Three items, two of them critical: one third is in good order.
      expect(result.answer.score).toBe(33);
    } else {
      throw new Error(`expected SCORE, got ${result.kind}`);
    }
  });

  it('scores an empty inventory zero rather than dividing by it', async () => {
    const empty = await createMemoryDriver();
    try {
      await migrate(empty);
      await seedDatabase(empty);
      const result = await execute(
        {
          items: createItemsRepository(empty),
          locations: createLocationsRepository(empty),
          context: CONTEXT,
          language: 'pt-BR',
        },
        { kind: 'QUERY_SCORE' },
      );
      if (result.kind === 'answer' && result.answer.kind === 'SCORE') {
        expect(result.answer.score).toBe(0);
      } else {
        throw new Error(`expected SCORE, got ${result.kind}`);
      }
    } finally {
      await empty.close().catch(() => undefined);
    }
  });

  it('leaves the examples for help to the caller that owns the grammar', async () => {
    const result = await execute(deps, { kind: 'HELP' });
    expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'HELP', examples: [] } });
  });

  it('hands back what it heard when it understood nothing', async () => {
    const result = await execute(deps, { kind: 'UNKNOWN', transcript: 'ligue a televisao' });
    expect(result).toMatchObject({ kind: 'unknown', transcript: 'ligue a televisao' });
  });
});
