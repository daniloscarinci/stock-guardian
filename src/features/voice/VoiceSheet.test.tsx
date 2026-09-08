// @vitest-environment happy-dom
/**
 * The ask sheet, driven through the box it is made of.
 *
 * There is no microphone left to stub. Android's recognizer refuses to
 * transcribe offline with no Portuguese pack installed, so voice commands were
 * removed and the typed box - which was never a fallback - is the whole
 * feature. Nothing here is stubbed at all.
 *
 * The database is real - the same in-memory SQLite driver the repository tests
 * use, migrated and seeded. That is what lets the central promise of this
 * feature be asserted rather than described: after a change is understood and
 * the card is on screen, the item's quantity is read straight out of the
 * database and is still the old one - and, for a change that was said in full,
 * that the quantity moved without anyone being asked to confirm it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository } from '../../repositories/items.repository';
import { createCategoriesRepository } from '../../repositories/categories.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { createCatalogRepository } from '../../repositories/catalog.repository';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { AppProvider } from '../../app/AppContext';
import type { AppContext } from '../../app/bootstrap';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';
import type { DatabaseDiagnostics } from '../../database/worker/protocol';
import { VoiceSheet } from './VoiceSheet';
import { VoiceButton } from './VoiceButton';

const DIAGNOSTICS: DatabaseDiagnostics = {
  sqliteVersion: 'test',
  vfsName: 'memory',
  journalMode: 'memory',
  foreignKeys: true,
  integrity: 'ok',
  poolCapacity: 0,
  poolFileCount: 0,
  pageCount: 0,
  pageSize: 4096,
};

let db: SqlDriver;
let items: ReturnType<typeof createItemsRepository>;

/** The provider the application itself uses, over a database made for this test. */
async function setup(overrides: Partial<Settings> = {}) {
  const startup: AppContext = {
    db,
    repositories: {
      items,
      categories: createCategoriesRepository(db),
      locations: createLocationsRepository(db),
      catalog: createCatalogRepository(db),
      settings: createSettingsRepository(db),
    },
    diagnostics: DIAGNOSTICS,
    settings: { ...DEFAULT_SETTINGS, language: 'en', ...overrides },
    invalidSettingKeys: [],
    quarantine: () => Promise.resolve('unused'),
    refreshDiagnostics: () => Promise.resolve(DIAGNOSTICS),
  };

  const user = userEvent.setup();
  const view = (children: React.ReactNode) =>
    render(<AppProvider startup={startup}>{children}</AppProvider>);
  return { user, view };
}

/**
 * Types a command into the box and presses Send.
 *
 * Found by role rather than by label, because the sheet is driven here in two
 * languages: the phrases that made this change necessary were spoken in
 * Portuguese on a Portuguese phone, and testing them in English would be
 * testing a translation of the bug.
 */
async function say(user: ReturnType<typeof userEvent.setup>, phrase: string) {
  await user.type(screen.getByRole('textbox'), phrase);
  await user.click(screen.getByRole('button', { name: /^(send|enviar)$/i }));
}

const quantityOf = async (name: string) =>
  db.selectValue<number>('SELECT quantity FROM items WHERE name = ?', [name]);

beforeEach(async () => {
  db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
  items = createItemsRepository(db);
  await items.create({ name: 'Rice', quantity: 3, unit: 'kg' });
  await items.create({ name: 'Beans', quantity: 12, unit: 'cans' });
  // The Portuguese half of the stock, for the sentences the real phone said.
  await items.create({ name: 'Ovos', quantity: 12, unit: 'un' });
  await items.create({ name: 'Arroz', quantity: 5, unit: 'kg' });
  await items.create({ name: 'Leite', quantity: 2, unit: 'l' });
});

afterEach(async () => {
  cleanup();
  await db.close().catch(() => undefined);
});

describe('VoiceSheet', () => {
  it('answers a typed question', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'how much rice do i have');

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
  });

  /**
   * "add five cans of beans" names the item exactly and says the number. There
   * is nothing in it to check, so it is not put to the user to check.
   */
  it('writes a change that was said in full, without a card', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'add five cans of beans');

    expect(await screen.findByText(/Beans: 17 cans/i)).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('button', { name: /^confirm:/i })).toBeNull();
    expect(await quantityOf('Beans')).toBe(17);

    // Stored without asking, so there has to be a way back out of it.
    expect(screen.getByRole('button', { name: /^undo/i })).toBeTruthy();
  });

  it('shows a confirmation card for a guessed change, and writes nothing until it is confirmed', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    // No number was spoken, so one was filled in.
    await say(user, 'i bought beans');

    const card = await screen.findByRole('group', { name: 'Beans' });
    // The card states the change in full: what it is now, and what it becomes.
    expect(within(card).getByText('12 cans')).toBeTruthy();
    expect(within(card).getByText('13 cans')).toBeTruthy();

    // And what it filled in, which is the part the reader has to judge.
    expect(
      within(card).getByText('Assumed a quantity of 1. You did not say a number.'),
    ).toBeTruthy();

    // The promise the whole feature rests on, asserted against the database
    // rather than against the screen.
    expect(await quantityOf('Beans')).toBe(12);
  });

  it('moves focus to Confirm and names the whole change on it', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'i bought beans');

    const confirm = await screen.findByRole('button', { name: /^confirm:/i });
    expect(confirm.getAttribute('aria-label')).toBe('Confirm: Beans, 12 cans becomes 13 cans');
    expect(document.activeElement).toBe(confirm);
  });

  it('writes when Confirm is pressed, and says what the item now holds', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'i bought beans');
    await user.click(await screen.findByRole('button', { name: /^confirm:/i }));

    expect(await screen.findByText(/Beans: 13 cans/i)).toBeTruthy();
    expect(await quantityOf('Beans')).toBe(13);
    // Confirmed, so there is no second chance to refuse the same change.
    expect(screen.queryByRole('button', { name: /^undo/i })).toBeNull();
  });

  it('leaves the database alone when the change is cancelled', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'i bought beans');
    await user.click(await screen.findByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('group', { name: 'Beans' })).toBeNull();
    expect(await quantityOf('Beans')).toBe(12);
  });

  it('shows what it heard when it did not understand, with examples to try', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'aaa bbb');

    expect(await screen.findByText(/aaa bbb/)).toBeTruthy();
    expect(screen.getByText(/did not understand/i)).toBeTruthy();
    expect(screen.getByText('how much rice do i have?')).toBeTruthy();
  });

  it('offers to create what a writing command could not find', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'add five cans of chickpeas');

    expect(await screen.findByText(/did not find "chickpeas"/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create it/i })).toBeTruthy();
  });

  it('does not offer to create for a question', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'where is the chickpeas');

    expect(await screen.findByText(/did not find "chickpeas"/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create it/i })).toBeNull();
  });

  it('fills in the grammar examples that execute returns empty', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'help');

    expect(await screen.findByText(/how much rice do i have\?/)).toBeTruthy();
  });
});

/**
 * The two sentences the phone was actually holding when this was reported.
 *
 * "usei 3 ovos" is not ambiguous and does not need a second opinion; "comprei
 * arroz" is missing its number and does. Everything below turns on that one
 * distinction.
 */
describe('VoiceSheet: acting when it is sure, asking when it guessed', () => {
  it('writes an explicit change at once and says what the item now holds', async () => {
    const { user, view } = await setup({ language: 'pt-BR' });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'usei 3 ovos');

    expect(await screen.findByText(/Ovos: 9 un/i)).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull();
    expect(await quantityOf('Ovos')).toBe(9);
  });

  it('takes the write back when Undo is pressed, and stops claiming it happened', async () => {
    const { user, view } = await setup({ language: 'pt-BR' });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'usei 3 ovos');
    await screen.findByText(/Ovos: 9 un/i);

    await user.click(screen.getByRole('button', { name: /^desfazer/i }));

    expect(await screen.findByText(/Desfeito/i)).toBeTruthy();
    expect(await quantityOf('Ovos')).toBe(12);
    // The log must not go on stating a quantity the database no longer holds.
    expect(screen.queryByText(/Ovos: 9 un/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^desfazer/i })).toBeNull();
  });

  /**
   * The case the receipt exists for.
   *
   * `adjustQuantity` clamps at zero, so removing five from two lands on zero -
   * and an undo that added five back would leave FIVE, three of them invented
   * out of the mistake the user was undoing.
   */
  it('restores the quantity that was there, not the delta that was applied', async () => {
    const { user, view } = await setup({ language: 'pt-BR' });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'tira 5 de leite');

    expect(await screen.findByText(/Leite: 0 l/i)).toBeTruthy();
    expect(await quantityOf('Leite')).toBe(0);

    await user.click(screen.getByRole('button', { name: /^desfazer/i }));
    await screen.findByText(/Desfeito/i);

    expect(await quantityOf('Leite')).toBe(2);
  });

  it('still asks about a change it had to guess at, and says what it guessed', async () => {
    const { user, view } = await setup({ language: 'pt-BR' });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'comprei arroz');

    const card = await screen.findByRole('group', { name: 'Arroz' });
    expect(within(card).getByText('5 kg')).toBeTruthy();
    expect(within(card).getByText('6 kg')).toBeTruthy();
    expect(within(card).getByText(/Assumi a quantidade de 1/)).toBeTruthy();
    expect(await quantityOf('Arroz')).toBe(5);

    await user.click(screen.getByRole('button', { name: /^confirmar:/i }));

    expect(await screen.findByText(/Arroz: 6 kg/i)).toBeTruthy();
    expect(await quantityOf('Arroz')).toBe(6);
  });
});


describe('VoiceButton', () => {
  it('renders no button when asking is switched off', async () => {
    const { view } = await setup({ askEnabled: false });
    view(<VoiceButton />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the sheet from the header, with no microphone anywhere', async () => {
    const { user, view } = await setup({ askEnabled: true });
    view(<VoiceButton />);

    const button = screen.getByRole('button', { name: /ask about your stock/i });
    // The listening path is gone, not hidden. Nothing here offers to hear.
    expect(screen.queryByRole('button', { name: /speak|microphone|listen/i })).toBeNull();

    await user.click(button);

    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /speak|microphone|listen/i })).toBeNull();
    expect(screen.queryByText(/speech pack|offline model|audio to Google/i)).toBeNull();
  });
});
