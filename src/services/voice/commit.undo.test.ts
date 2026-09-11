/**
 * Taking back a write that was stored without asking.
 *
 * An explicit write goes straight into the database and the user is offered
 * Undo instead of a confirmation. That trade only holds if Undo really puts
 * things back, which is why the receipt records the VALUE that was there
 * rather than the change that replaced it - see the clamping test below, the
 * case that decided the design.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import { SqlError, type SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createCategoriesRepository } from '../../repositories/categories.repository';
import { createContactsRepository } from '../../repositories/contacts.repository';
import type { InventoryItem } from '../../types/domain';
import { execute, type PendingWrite, type VoiceDeps } from './execute';
import { commit, undo, type Committed } from './commit';
import { evaluatePreparedness } from '../../domain/preparedness';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

/**
 * The item a sentence produced, or a failure saying what came back instead.
 *
 * `Committed.wrote` says which kind of row was written, because a sentence can
 * now make a place or a contact as well as an item. A test that reached past
 * that with a cast would go on compiling on the day one of these phrases
 * started producing something else; asserting the kind makes that day a
 * failure that names what it got.
 */
function committedItem(committed: Committed): InventoryItem {
  if (committed.wrote.kind !== 'item') {
    throw new Error(`expected an item, got a ${committed.wrote.kind}`);
  }
  return committed.wrote.item;
}

describe('undo', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;
  let feijaoId: string;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const categories = createCategoriesRepository(db);
    const contacts = createContactsRepository(db);
    await locations.create({ name: 'Despensa' });

    const feijao = await items.create({
      name: 'Feijão Preto', quantity: 2, unit: 'kg', expirationDate: '2026-12-01',
    });
    feijaoId = feijao.id;

    deps = {
      items, locations, categories, contacts, context: CONTEXT, language: 'pt-BR',
      trackedCategoryIds: [], dismissedItemIds: [],
    };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  async function write(...args: Parameters<typeof execute>): Promise<PendingWrite> {
    const result = await execute(...args);
    if (result.kind !== 'pending') throw new Error(`expected pending, got ${result.kind}`);
    return result.write;
  }

  /**
   * The value that was there, not the inverse of the change - the same rule the
   * quantity follows, for a different reason. An item moved out of NOWHERE has
   * no previous shelf, and an undo that could only move it back somewhere would
   * have to invent one.
   */
  it('puts an item back on the shelf it came from', async () => {
    const shelf = await deps.locations.findByName('Despensa');
    const garage = await deps.locations.create({ name: 'Garagem' });
    expect(shelf).toBeDefined();
    if (shelf === undefined) return;
    await deps.items.update(feijaoId, { locationId: shelf.id });

    const saved = await commit(deps, await write(deps, { kind: 'MOVE_ITEM',
      item: 'feijao preto', location: 'garagem' }));
    expect(committedItem(saved).locationId).toBe(garage.id);
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreLocation', itemId: feijaoId, to: shelf.id }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.locationId).toBe(shelf.id);
  });

  it('puts an item back to having no shelf at all', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'MOVE_ITEM',
      item: 'feijao preto', location: 'despensa' }));
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreLocation', itemId: feijaoId, to: null }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.locationId).toBeNull();
  });

  /**
   * `null` and `0` are different minimums and the undo must not confuse them:
   * null leaves the global threshold in charge, zero silences the item. An undo
   * that turned the first into the second would quietly stop a warning the user
   * never asked to stop.
   */
  it('puts a minimum back to never having been set', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'SET_MINIMUM',
      item: 'feijao preto', amount: 8, unit: null }));
    expect(committedItem(saved).minimumQuantity).toBe(8);
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreMinimum', itemId: feijaoId, to: null }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.minimumQuantity).toBeNull();
  });

  it('puts a minimum back to the number it held', async () => {
    await deps.items.update(feijaoId, { minimumQuantity: 4 });
    const saved = await commit(deps, await write(deps, { kind: 'SET_MINIMUM',
      item: 'feijao preto', amount: 8, unit: null }));
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreMinimum', itemId: feijaoId, to: 4 }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.minimumQuantity).toBe(4);
  });

  it('puts a target back', async () => {
    await deps.items.update(feijaoId, { idealQuantity: 15 });
    const saved = await commit(deps, await write(deps, { kind: 'SET_TARGET',
      item: 'feijao preto', amount: 30, unit: null }));
    expect(committedItem(saved).idealQuantity).toBe(30);
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreTarget', itemId: feijaoId, to: 15 }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.idealQuantity).toBe(15);
  });

  it('puts an added quantity back', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 5, direction: 'up', transaction: 'purchase',
      unit: null, amountAssumed: false }));
    expect(committedItem(saved).quantity).toBe(7);
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreQuantity', itemId: feijaoId, to: 2 }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(2);
  });

  /**
   * The case the whole design turns on.
   *
   * `adjustQuantity` clamps at zero, so removing 5 from 2 lands on 0 - and
   * undoing by adding 5 back would leave FIVE, three of which never existed.
   * The receipt records the 2 that was there, so the way back is a correction
   * of +2 rather than the inverse of the change.
   */
  it('restores the quantity that was there, not the delta that was applied', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 5, direction: 'down', transaction: 'consume',
      unit: null, amountAssumed: false }));
    expect(committedItem(saved).quantity).toBe(0);

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(2);
  });

  /**
   * The transaction log is deliberate, and an undo is part of the story rather
   * than an erasure of it: the quantity moved twice and the log says so twice,
   * the second time as a correction.
   */
  it('records the way back as a correction instead of deleting history', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 5, direction: 'down', transaction: 'consume',
      unit: null, amountAssumed: false }));

    await undo(deps, saved.receipt);

    const history = await deps.items.history(feijaoId);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ type: 'correction', quantity_before: 0, quantity_after: 2 });
    expect(history[1]).toMatchObject({ type: 'consume', quantity_before: 2, quantity_after: 0 });
  });

  it('puts back the expiry date that was replaced', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'SET_EXPIRY',
      item: 'feijao preto', expiresOn: '2027-01-01', dateAssumed: false }));
    expect(committedItem(saved).expirationDate).toBe('2027-01-01');
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreExpiry', itemId: feijaoId, to: '2026-12-01' }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.expirationDate).toBe('2026-12-01');
  });

  /** An item that had no date goes back to having none, not to today's. */
  it('puts back an absent expiry date as absent', async () => {
    const arroz = await deps.items.create({ name: 'Arroz Branco', quantity: 1, unit: 'kg' });

    const saved = await commit(deps, await write(deps, { kind: 'SET_EXPIRY',
      item: 'arroz branco', expiresOn: '2027-01-01', dateAssumed: false }));
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreExpiry', itemId: arroz.id, to: null }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(arroz.id))?.expirationDate).toBeNull();
  });

  /**
   * Deleted rather than archived. An item created seconds ago by a misheard
   * sentence was never stock: archiving would leave it in the archived list,
   * in the counts and in an export, and saying the sentence again would make a
   * duplicate rather than bring it back.
   */
  it('takes a creation away entirely, leaving nothing archived', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'CREATE_ITEM', name: 'quinoa',
      amount: 2, unit: 'kg', location: null, expiresOn: null }));
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'deleteItem', itemId: committedItem(saved).id }] });

    await undo(deps, saved.receipt);

    expect(await deps.items.getById(committedItem(saved).id)).toBeUndefined();
    const everything = await deps.items.list(deps.context, {
      filters: { search: 'quinoa', archived: 'all' },
      lang: 'pt-BR',
    });
    expect(everything.rows).toHaveLength(0);
  });

  /**
   * Undo is offered for a few seconds, and a row can be deleted inside them.
   * Being asked to restore something that is gone is not an error worth
   * showing anybody.
   */
  it('says nothing when the item it would restore has been deleted', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'ADJUST_QUANTITY',
      item: 'feijao preto', amount: 1, direction: 'up', transaction: 'add',
      unit: null, amountAssumed: false }));

    await deps.items.remove(feijaoId);
    await expect(undo(deps, saved.receipt)).resolves.toBeUndefined();
  });

  /**
   * The receipt names the quantity that was actually replaced, read at the
   * moment of the write. A `PendingWrite` carries a view built when the phrase
   * was executed, and a `+` tap on the item screen in between would make that
   * view - and an undo trusting it - a quantity out of date.
   */
  it('records the quantity as it was when the write landed, not when it was described', async () => {
    const pendingWrite = await write(deps, { kind: 'ADJUST_QUANTITY', item: 'feijao preto',
      amount: 1, direction: 'up', transaction: 'add', unit: null, amountAssumed: false });

    await deps.items.adjustQuantity(feijaoId, 3, { type: 'add' });

    const saved = await commit(deps, pendingWrite);
    expect(committedItem(saved).quantity).toBe(6);
    expect(saved.receipt).toMatchObject({ undo: [{ kind: 'restoreQuantity', itemId: feijaoId, to: 5 }] });

    await undo(deps, saved.receipt);
    expect((await deps.items.getById(feijaoId))?.quantity).toBe(5);
  });

  /**
   * The order is the whole of it.
   *
   * One sentence writes twice - "move the rice to the cellar" against a pantry
   * that has no cellar makes the place and then moves the rice - and the way
   * back has to run backwards. Taking the place
   * away first would not merely be untidy: `locations.remove` refuses a place
   * that still holds something, so the deletion would fail and the user would
   * be left with a shelf nobody asked for.
   *
   * The receipt is built by hand here so the ORDER can be tested on its own,
   * away from whatever `commit` happens to put in one - the test below says a
   * real sentence produces exactly this pair. The calls underneath it are
   * real, recorded by wrapping the repositories rather than replacing them, so
   * this says both that the order was right and that the rows actually moved.
   */
  it('unwinds a receipt newest action first', async () => {
    const order: string[] = [];
    const cellar = await deps.locations.create({ name: 'Adega' });
    await deps.items.transfer(feijaoId, cellar.id, 'Por voz');

    const watched: VoiceDeps = {
      ...deps,
      items: {
        ...deps.items,
        transfer: async (id, to, notes) => {
          order.push(`transfer:${id}`);
          return deps.items.transfer(id, to, notes);
        },
      },
      locations: {
        ...deps.locations,
        remove: async (id, options) => {
          order.push(`removeLocation:${id}`);
          return deps.locations.remove(id, options);
        },
      },
    };

    await undo(watched, {
      undo: [
        { kind: 'restoreLocation', itemId: feijaoId, to: null },
        { kind: 'deleteLocation', locationId: cellar.id },
      ],
    });

    expect(order).toEqual([`transfer:${feijaoId}`, `removeLocation:${cellar.id}`]);
    expect((await deps.items.getById(feijaoId))?.locationId).toBeNull();
    expect(await deps.locations.getById(cellar.id)).toBeUndefined();
  });

  /**
   * The sentence the receipt above was written for, said for real.
   *
   * "Move the beans to the cellar" against a pantry with no cellar makes the
   * place and then moves the item, so the way back is both halves in reverse.
   * A receipt with only the transfer in it would pass every other test in this
   * file and still leave a shelf nobody asked for.
   */
  it('takes back both halves of a move that had to make its destination', async () => {
    const shelf = await deps.locations.findByName('Despensa');
    expect(shelf).toBeDefined();
    if (shelf === undefined) return;
    await deps.items.update(feijaoId, { locationId: shelf.id });

    const saved = await commit(deps, await write(deps, { kind: 'MOVE_ITEM',
      item: 'feijao preto', location: 'adega' }));

    const made = await deps.locations.findByName('adega');
    expect(made).toBeDefined();
    expect(committedItem(saved).locationId).toBe(made?.id);
    expect(saved.receipt.undo).toEqual([
      { kind: 'restoreLocation', itemId: feijaoId, to: shelf.id },
      { kind: 'deleteLocation', locationId: made?.id },
    ]);

    await undo(deps, saved.receipt);

    expect((await deps.items.getById(feijaoId))?.locationId).toBe(shelf.id);
    expect(await deps.locations.getById(made?.id ?? '')).toBeUndefined();
  });

  /**
   * The same for a creation, whose two halves go the other way round: the
   * place is made first and the item filed on it, so the item is deleted first
   * and the empty place taken away after. Deleting the place first would fail
   * - `locations.remove` refuses one that still holds something - and leave
   * both rows behind.
   */
  it('takes back both halves of a creation that had to make its shelf', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'CREATE_ITEM', name: 'quinoa',
      amount: 2, unit: 'kg', location: 'adega', expiresOn: null }));

    const made = await deps.locations.findByName('adega');
    expect(made).toBeDefined();
    expect(saved.receipt.undo).toEqual([
      { kind: 'deleteItem', itemId: committedItem(saved).id },
      { kind: 'deleteLocation', locationId: made?.id },
    ]);

    await undo(deps, saved.receipt);

    expect(await deps.items.getById(committedItem(saved).id)).toBeUndefined();
    expect(await deps.locations.getById(made?.id ?? '')).toBeUndefined();
  });

  /** A move onto a shelf that exists makes nothing, so its receipt stays one action long. */
  it('leaves a move to an existing shelf with a single action', async () => {
    const saved = await commit(deps, await write(deps, { kind: 'MOVE_ITEM',
      item: 'feijao preto', location: 'despensa' }));

    expect(saved.receipt.undo).toHaveLength(1);
    expect(saved.receipt.undo[0]).toMatchObject({ kind: 'restoreLocation' });
  });

  /**
   * A sentence whose whole content was a place: "novo lugar, adega".
   *
   * One row goes in and nothing else does, so the receipt is one action long -
   * there is no item beside it, and `NEW_LOCATION` reaches `commit` only after
   * `execute` has found that no place already answers to the name.
   *
   * The place is empty the second it is made, because nothing in the sentence
   * put anything in it. So `locations.remove` has nothing to refuse, and Undo
   * really does leave the Locations screen as it found it - which is the whole
   * claim the ten-second offer makes.
   */
  it('takes back a place it made', async () => {
    const { wrote, receipt } = await commit(
      deps,
      await write(deps, { kind: 'CREATE_LOCATION', name: 'adega' }),
    );

    expect(wrote.kind).toBe('location');
    if (wrote.kind !== 'location') return;

    expect(wrote.location.name).toBe('adega');
    expect(receipt.undo).toEqual([{ kind: 'deleteLocation', locationId: wrote.location.id }]);
    expect(await deps.locations.getById(wrote.location.id)).toBeDefined();

    await undo(deps, receipt);

    expect(await deps.locations.getById(wrote.location.id)).toBeUndefined();
    expect(await deps.locations.findByName('adega')).toBeUndefined();
  });

  /**
   * A place that filled up in the ten seconds Undo was on screen.
   *
   * Somebody put something there on purpose, so the place is theirs now rather
   * than the sentence's, and `locations.remove` refuses to take it. That is
   * not a failed undo and must not be reported as one: the undo resolves, the
   * place stands, and what is in it is left alone.
   */
  it('leaves a place that filled up, and still reports the undo as done', async () => {
    const cellar = await deps.locations.create({ name: 'Adega' });
    await deps.items.transfer(feijaoId, cellar.id, 'Por voz');

    await expect(
      undo(deps, { undo: [{ kind: 'deleteLocation', locationId: cellar.id }] }),
    ).resolves.toBeUndefined();

    expect(await deps.locations.getById(cellar.id)).toBeDefined();
    expect((await deps.items.getById(feijaoId))?.locationId).toBe(cellar.id);
  });

  /**
   * A sentence whose whole content was a heading: "nova categoria, bunker".
   *
   * The same shape as the place above, and one thing of its own worth pinning:
   * the name is stored in ONE language, the one the interface is in. The
   * built-in categories are named in all three because they ship that way; a
   * name said out loud is a fact about one of those rows, and writing it into
   * the other two would claim a translation nobody made.
   */
  it('makes a category named in the language the sentence was said in, and takes it back', async () => {
    const { wrote, receipt } = await commit(
      deps,
      await write(deps, { kind: 'CREATE_CATEGORY', name: 'bunker' }),
    );

    expect(wrote.kind).toBe('category');
    if (wrote.kind !== 'category') return;

    expect(wrote.category.names).toEqual({ 'pt-BR': 'bunker' });
    // Not passed in, so the repository's own defaults are what landed.
    expect(wrote.category.icon).toBeNull();
    expect(wrote.category.color).toBeNull();
    expect(wrote.category.isSystem).toBe(false);

    expect(receipt.undo).toEqual([{ kind: 'deleteCategory', categoryId: wrote.category.id }]);
    expect(await deps.categories.getById(wrote.category.id)).toBeDefined();

    await undo(deps, receipt);

    expect(await deps.categories.getById(wrote.category.id)).toBeUndefined();
    // The side table goes with it, so the name cannot outlive the row.
    expect(
      Number(
        await db.selectValue<number>(
          'SELECT COUNT(*) FROM category_names WHERE category_id = :id',
          { id: wrote.category.id },
        ),
      ),
    ).toBe(0);
  });

  /**
   * Making an empty category moves no number the user is shown.
   *
   * `evaluatePreparedness` averages over the categories its ITEMS carry, plus
   * any the user has explicitly tracked on the Settings screen, and a category
   * made by a sentence is in neither - `trackedCategoryIds` is empty here, as
   * it is by default. It joins that mean the day something is filed under it,
   * which is a different sentence on a different screen.
   */
  it('leaves the preparedness score where it was', async () => {
    const score = async () =>
      evaluatePreparedness({
        items: await deps.items.listForAnalysis(),
        today: CONTEXT.today,
        defaultThreshold: CONTEXT.defaultThreshold,
        trackedCategoryIds: deps.trackedCategoryIds,
        expiryWindows: CONTEXT.expiryWindows,
      }).score;

    const before = await score();
    await commit(deps, await write(deps, { kind: 'CREATE_CATEGORY', name: 'bunker' }));

    expect(await score()).toBe(before);
  });

  /**
   * A category something was filed under in the ten seconds Undo was on
   * screen, which is `CategoryInUseError` and the same judgement the place
   * above gets: the user has started using it, so it is theirs now.
   */
  it('leaves a category that was used, and still reports the undo as done', async () => {
    const { wrote, receipt } = await commit(
      deps,
      await write(deps, { kind: 'CREATE_CATEGORY', name: 'bunker' }),
    );
    if (wrote.kind !== 'category') throw new Error('expected a category');
    await deps.items.update(feijaoId, { categoryId: wrote.category.id });

    await expect(undo(deps, receipt)).resolves.toBeUndefined();

    expect(await deps.categories.getById(wrote.category.id)).toBeDefined();
    expect((await deps.items.getById(feijaoId))?.categoryId).toBe(wrote.category.id);
  });

  /**
   * The one guard, and nothing else.
   *
   * `LocationInUseError` is swallowed because it is not a failure. A database
   * that would not answer is, and the earlier shape of this - a bare `catch` -
   * absorbed that too, which left `takeBack` unable to show an error and the
   * user told "Desfeito" over a place that is still there.
   */
  it('reports a failure that is not the place being in use', async () => {
    const cellar = await deps.locations.create({ name: 'Adega' });
    const failure = new SqlError({ name: 'SqlError', message: 'database is locked', code: 5 });

    const failing: VoiceDeps = {
      ...deps,
      locations: {
        ...deps.locations,
        remove: () => Promise.reject(failure),
      },
    };

    await expect(
      undo(failing, { undo: [{ kind: 'deleteLocation', locationId: cellar.id }] }),
    ).rejects.toBe(failure);
  });
});
