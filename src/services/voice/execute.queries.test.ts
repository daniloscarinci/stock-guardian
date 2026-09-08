import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import {
  createItemsRepository,
  type ItemContext,
  type ItemsRepository,
} from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createCategoriesRepository } from '../../repositories/categories.repository';
import { createContactsRepository } from '../../repositories/contacts.repository';
import { evaluatePreparedness } from '../../domain/preparedness';
import { execute, type VoiceDeps } from './execute';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

/**
 * The score the Preparedness card shows, computed the way `DashboardScreen`
 * computes it. The point of the assertions below is that the spoken number
 * equals this one, so this is the screen's own call and not a copy of the rule.
 */
async function screenScore(
  items: ItemsRepository,
  trackedCategoryIds: readonly string[],
): Promise<number> {
  return evaluatePreparedness({
    items: await items.listForAnalysis(),
    today: CONTEXT.today,
    defaultThreshold: CONTEXT.defaultThreshold,
    trackedCategoryIds,
    expiryWindows: CONTEXT.expiryWindows,
  }).score;
}

async function spokenScore(deps: VoiceDeps): Promise<number> {
  const result = await execute(deps, { kind: 'QUERY_SCORE' });
  if (result.kind !== 'answer' || result.answer.kind !== 'SCORE') {
    throw new Error(`expected SCORE, got ${result.kind}`);
  }
  return result.answer.score;
}

describe('execute: queries', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    const pantry = await locations.create({ name: 'Despensa' });

    await items.create({
      name: 'Arroz Branco', quantity: 10, unit: 'kg', locationId: pantry.id,
      minimumQuantity: 5, categoryId: 'food',
    });
    await contacts.create({
      name: 'Dra. Silva', relationship: 'Médico', phone: '11 5555-0000', priority: 1,
    });
    await items.create({ name: 'Leite', quantity: 2, unit: 'l', expirationDate: '2026-09-12' });
    await items.create({
      name: 'Feijão Preto', quantity: 1, unit: 'kg', minimumQuantity: 10, idealQuantity: 20,
    });

    deps = {
      items, locations, categories, contacts, context: CONTEXT, language: 'pt-BR',
      trackedCategoryIds: [], dismissedItemIds: [],
    };
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

  /*
   * The defect this test exists to keep fixed.
   *
   * The Replenishment screen honours a dismissal and this answer did not, so
   * the application disagreed with itself about the same list. `dismissedItemIds`
   * now comes through `VoiceDeps`, from the same setting the screen reads.
   */
  it('leaves out an item the user dismissed from the replenishment list', async () => {
    const before = await execute(deps, { kind: 'QUERY_MISSING' });
    if (before.kind !== 'answer' || before.answer.kind !== 'MISSING') {
      throw new Error(`expected MISSING, got ${before.kind}`);
    }
    const dropped = before.answer.lines[0];
    if (dropped === undefined) throw new Error('the fixture has nothing to dismiss');

    const after = await execute(
      { ...deps, dismissedItemIds: [dropped.itemId] },
      { kind: 'QUERY_MISSING' },
    );
    if (after.kind !== 'answer' || after.answer.kind !== 'MISSING') {
      throw new Error(`expected MISSING, got ${after.kind}`);
    }
    expect(after.answer.lines.map((line) => line.name)).not.toContain(dropped.name);
    expect(after.answer.lines).toHaveLength(before.answer.lines.length - 1);
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

  /**
   * "o que tem em X" is two questions, and the database decides which.
   *
   * The place is tried first because it is the more concrete of the two:
   * locations are things this household made and named, categories are twenty
   * fixed labels that ship with the application. When no place fits, the
   * category answers; when neither does, the phrase comes back as notFound
   * rather than as an empty list, because "there is nothing in the cellar" and
   * "you have no cellar" are different sentences.
   */
  it('falls back to a category when the phrase names no place', async () => {
    const result = await execute(deps, { kind: 'QUERY_WHERE', item: null, location: 'alimentos' });
    if (result.kind === 'answer' && result.answer.kind === 'CATEGORY') {
      expect(result.answer.categoryName).toBe('Alimentos');
    } else {
      throw new Error(`expected CATEGORY, got ${result.kind}`);
    }
  });

  it('prefers a place over a category with the same name', async () => {
    const locations = createLocationsRepository(db);
    await locations.create({ name: 'Alimentos' });

    const result = await execute(deps, { kind: 'QUERY_WHERE', item: null, location: 'alimentos' });
    expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'WHERE_LOCATION' } });
  });

  it('says so when the phrase is neither a place nor a category', async () => {
    const result = await execute(deps, { kind: 'QUERY_WHERE', item: null, location: 'sotao' });
    expect(result).toMatchObject({ kind: 'notFound', phrase: 'sotao' });
  });

  describe('a category', () => {
    it('lists what it holds, under its name in the active language', async () => {
      const result = await execute(deps, { kind: 'QUERY_CATEGORY', category: 'alimentos' });
      if (result.kind === 'answer' && result.answer.kind === 'CATEGORY') {
        expect(result.answer.categoryName).toBe('Alimentos');
        expect(result.answer.items.map((item) => item.name)).toContain('Arroz Branco');
        expect(result.answer.total).toBe(result.answer.items.length);
      } else {
        throw new Error(`expected CATEGORY, got ${result.kind}`);
      }
    });

    /**
     * Category names live in a side table, one row per language, so the same
     * category answers to a different word depending on who is asking.
     */
    it('is found by its English name when the interface is English', async () => {
      const english: VoiceDeps = { ...deps, language: 'en' };
      const result = await execute(english, { kind: 'QUERY_CATEGORY', category: 'food' });
      if (result.kind === 'answer' && result.answer.kind === 'CATEGORY') {
        expect(result.answer.categoryName).toBe('Food');
      } else {
        throw new Error(`expected CATEGORY, got ${result.kind}`);
      }
    });

    it('answers an empty category with the category rather than with nothing', async () => {
      const result = await execute(deps, { kind: 'QUERY_CATEGORY', category: 'navegacao' });
      if (result.kind === 'answer' && result.answer.kind === 'CATEGORY') {
        expect(result.answer.items).toHaveLength(0);
        expect(result.answer.total).toBe(0);
      } else {
        throw new Error(`expected CATEGORY, got ${result.kind}`);
      }
    });

    /**
     * No fallback here, unlike the ambiguous question above. A phrase that says
     * "categoria" out loud and matches none is a category that does not exist,
     * and saying so beats reading out a shelf that shares a word with it.
     */
    it('reports a category it could not find', async () => {
      const result = await execute(deps, { kind: 'QUERY_CATEGORY', category: 'brinquedos' });
      expect(result).toMatchObject({ kind: 'notFound', phrase: 'brinquedos' });
    });
  });

  describe('a contact', () => {
    it('finds one by relationship and carries the phone and the relationship', async () => {
      const result = await execute(deps, { kind: 'QUERY_CONTACT', query: 'medico' });
      if (result.kind === 'answer' && result.answer.kind === 'CONTACT') {
        expect(result.answer.contacts[0]).toMatchObject({
          name: 'Dra. Silva', phone: '11 5555-0000', relationship: 'Médico',
        });
      } else {
        throw new Error(`expected CONTACT, got ${result.kind}`);
      }
    });

    it('finds one by name, accents and all', async () => {
      const result = await execute(deps, { kind: 'QUERY_CONTACT', query: 'silva' });
      expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'CONTACT' } });
    });

    /**
     * An empty result is an ANSWER, not a notFound.
     *
     * The interface offers to create a missing ITEM under notFound, and a
     * question about the address book has no business reaching that button.
     */
    it('answers with an empty list rather than a notFound', async () => {
      const result = await execute(deps, { kind: 'QUERY_CONTACT', query: 'dentista' });
      if (result.kind === 'answer' && result.answer.kind === 'CONTACT') {
        expect(result.answer.contacts).toHaveLength(0);
        expect(result.answer.query).toBe('dentista');
      } else {
        throw new Error(`expected CONTACT, got ${result.kind}`);
      }
    });
  });

  describe('the history of one item', () => {
    it('reads back the movements, newest first, with their type and day', async () => {
      const found = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'arroz branco' });
      if (found.kind !== 'answer' || found.answer.kind !== 'QUANTITY') {
        throw new Error('the fixture should hold one rice');
      }
      const arroz = found.answer.item;

      await deps.items.adjustQuantity(arroz.id, 5, {
        type: 'purchase', occurredAt: '2026-09-01T10:00:00.000Z',
      });
      await deps.items.adjustQuantity(arroz.id, -2, {
        type: 'consume', occurredAt: '2026-09-05T10:00:00.000Z',
      });

      const result = await execute(deps, { kind: 'QUERY_HISTORY', item: 'arroz' });
      if (result.kind === 'answer' && result.answer.kind === 'HISTORY') {
        expect(result.answer.item.name).toBe('Arroz Branco');
        expect(result.answer.entries[0]).toMatchObject({
          type: 'consume', quantity: 2, on: '2026-09-05',
        });
        expect(result.answer.entries[1]).toMatchObject({ type: 'purchase', on: '2026-09-01' });
      } else {
        throw new Error(`expected HISTORY, got ${result.kind}`);
      }
    });

    /**
     * An item nobody has adjusted has never moved, which is a fact about the
     * item rather than a failure to find it.
     */
    it('answers an item with no movements at all', async () => {
      const result = await execute(deps, { kind: 'QUERY_HISTORY', item: 'leite' });
      if (result.kind === 'answer' && result.answer.kind === 'HISTORY') {
        expect(result.answer.entries).toHaveLength(0);
      } else {
        throw new Error(`expected HISTORY, got ${result.kind}`);
      }
    });

    it('reports an item it could not find', async () => {
      const result = await execute(deps, { kind: 'QUERY_HISTORY', item: 'quinoa' });
      expect(result).toMatchObject({ kind: 'notFound', phrase: 'quinoa' });
    });
  });

  /**
   * The same call the dashboard makes, so the spoken count and the screen's
   * count cannot drift apart.
   */
  it('counts the whole inventory the way the dashboard counts it', async () => {
    const result = await execute(deps, { kind: 'QUERY_TOTAL' });
    if (result.kind === 'answer' && result.answer.kind === 'TOTAL') {
      expect(result.answer.stats).toEqual(await deps.items.dashboardStats(CONTEXT));
      expect(result.answer.stats.totalItems).toBe(3);
    } else {
      throw new Error(`expected TOTAL, got ${result.kind}`);
    }
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

  it('speaks the number the preparedness screen shows', async () => {
    const items = createItemsRepository(db);
    const spoken = await spokenScore(deps);

    expect(spoken).toBe(await screenScore(items, deps.trackedCategoryIds));
    expect(spoken).toBeGreaterThan(0);
  });

  it('speaks the screen number when only some categories are tracked', async () => {
    const items = createItemsRepository(db);
    await items.create({
      name: 'Arroz Agulhinha', quantity: 20, unit: 'kg', categoryId: 'food', minimumQuantity: 5,
    });
    const tracked = ['food', 'water'];
    const scoped: VoiceDeps = { ...deps, trackedCategoryIds: tracked };

    expect(await spokenScore(scoped)).toBe(await screenScore(items, tracked));
  });

  /**
   * The case the old calculation got wrong, and the reason this one exists.
   *
   * Four fully stocked food items and an empty water category: every item on
   * hand is healthy, so a flat percentage of healthy items answers 100. The
   * application weights categories equally, which is what stops a full pantry
   * hiding an empty water category, and answers 50. The screen says 50, so the
   * voice must say 50.
   */
  it('lets an empty category pull the spoken score down, exactly as the screen does', async () => {
    const stocked = await createMemoryDriver();
    try {
      await migrate(stocked);
      await seedDatabase(stocked);
      const items = createItemsRepository(stocked);
      for (const name of ['Arroz', 'Feijão', 'Macarrão', 'Farinha']) {
        await items.create({
          name, quantity: 40, unit: 'kg', categoryId: 'food', minimumQuantity: 5,
        });
      }
      const tracked = ['food', 'water'];

      const spoken = await spokenScore({
        items,
        locations: createLocationsRepository(stocked),
        categories: createCategoriesRepository(stocked),
        contacts: createContactsRepository(stocked),
        context: CONTEXT,
        language: 'pt-BR',
        trackedCategoryIds: tracked,
        dismissedItemIds: [],
      });

      expect(spoken).toBe(await screenScore(items, tracked));
      expect(spoken).toBe(50);
    } finally {
      await stocked.close().catch(() => undefined);
    }
  });

  it('scores an empty inventory zero rather than dividing by it', async () => {
    const empty = await createMemoryDriver();
    try {
      await migrate(empty);
      await seedDatabase(empty);
      const items = createItemsRepository(empty);
      const spoken = await spokenScore({
        items,
        locations: createLocationsRepository(empty),
        categories: createCategoriesRepository(empty),
        contacts: createContactsRepository(empty),
        context: CONTEXT,
        language: 'pt-BR',
        trackedCategoryIds: [], dismissedItemIds: [],
      });

      expect(spoken).toBe(0);
      expect(spoken).toBe(await screenScore(items, []));
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
