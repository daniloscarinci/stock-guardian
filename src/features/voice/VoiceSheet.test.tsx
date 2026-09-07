// @vitest-environment happy-dom
/**
 * The voice sheet, driven through the typed box.
 *
 * The typed path needs no browser speech API and no Capacitor bridge, which
 * makes it the honest thing to test: every assertion below is about the state
 * machine and the interface, not about a stubbed recognizer agreeing with
 * itself.
 *
 * The database is real - the same in-memory SQLite driver the repository tests
 * use, migrated and seeded. That is what lets the central promise of this
 * feature be asserted rather than described: after a change is understood and
 * the card is on screen, the item's quantity is read straight out of the
 * database and is still the old one - and, for a change that was said in full,
 * that the quantity moved without anyone being asked to confirm it.
 *
 * The recognizer is the one thing stubbed, and only in the last block. Speech
 * cannot be typed, and the bug being tested there is precisely what the
 * interface does with a listen that fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
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
import type * as RecognizerModule from '../../services/speech/recognizer';
import {
  selectRecognizer,
  SpeechFailureError,
  type SpeechFailure,
  type SpeechRecognizer,
} from '../../services/speech/recognizer';
import { VoiceSheet } from './VoiceSheet';
import { VoiceButton } from './VoiceButton';

// Only the choice of recognizer. `speechFailureReason` and the failure codes
// stay real, because reading a reason out of what a platform threw is half of
// what these tests are checking.
vi.mock('../../services/speech/recognizer', async (importOriginal) => {
  const actual = await importOriginal<typeof RecognizerModule>();
  return { ...actual, selectRecognizer: vi.fn() };
});

/** A device that can listen, and whose every listen ends the same way. */
function recognizerFailing(reason: SpeechFailure): SpeechRecognizer {
  return {
    availability: () => Promise.resolve('ready'),
    listen: () => Promise.reject(new SpeechFailureError(reason)),
  };
}

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

/**
 * Lets the availability probe settle before the microphone is pressed.
 *
 * `useAsyncData` selects the recognizer in an effect, so a press in the same
 * tick would find no recognizer and report the device unable to transcribe -
 * which is a different message from the one under test.
 */
async function ready() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
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

  vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('cancelled'));
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
  it('renders no microphone when voice is switched off', async () => {
    const { view } = await setup({ voiceEnabled: false });
    view(<VoiceButton />);

    expect(screen.queryByRole('button', { name: /speak a command/i })).toBeNull();
  });

  it('renders the microphone when voice is on', async () => {
    const { view } = await setup({ voiceEnabled: true });
    view(<VoiceButton />);

    expect(screen.getByRole('button', { name: /speak a command/i })).toBeTruthy();
  });
});

/**
 * The reported bug, in a test.
 *
 * "the mobile seems to be blocking the mic" - it was not. Every failure the
 * Android plugin could not name came back as "cancelled", and a cancellation is
 * the one failure this interface answers with silence, so a phone with no
 * offline speech pack produced nothing at all: no sentence, no banner, no way
 * to find out. Each case below is a failure that must now say something, and
 * the one case that must still say nothing.
 */
describe('VoiceButton: why the microphone failed', () => {
  const press = async (user: ReturnType<typeof userEvent.setup>) => {
    await ready();
    await user.click(screen.getByRole('button', { name: /speak a command/i }));
    await ready();
  };

  it('explains a missing speech pack, and offers the two ways round it', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const { user, view } = await setup();
    view(<VoiceButton />);

    await press(user);

    expect(await screen.findByText(/no offline speech pack/i)).toBeTruthy();

    // The install path is there, folded away until it is asked for.
    const steps = screen.getByText(/Voice input → Google → Offline speech recognition/i);
    expect(steps.hidden).toBe(true);
    await user.click(screen.getByRole('button', { name: /how to install/i }));
    expect(steps.hidden).toBe(false);

    // And the setting is pointed at, not touched.
    expect(screen.getByText(/send your audio to Google/i)).toBeTruthy();
  });

  it('dismisses that panel to the typed box, which is the feature that still works', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const { user, view } = await setup();
    view(<VoiceButton />);

    await press(user);
    await screen.findByText(/no offline speech pack/i);

    await user.click(screen.getByRole('button', { name: /type the command instead/i }));

    expect(screen.queryByText(/no offline speech pack/i)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it.each([
    ['no-recognizer', /cannot transcribe speech on its own/i],
    ['network', /did not find it/i],
    ['no-match', /did not hear anything/i],
    ['busy', /Something else is using the microphone/i],
    ['failed', /microphone could not be used/i],
  ] as const)('says what happened when the listen failed with %s', async (reason, expected) => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing(reason));
    const { user, view } = await setup();
    view(<VoiceButton />);

    await press(user);

    expect(await screen.findByText(expected)).toBeTruthy();
  });

  /** A banner after a deliberate "never mind" teaches people to ignore banners. */
  it('shows nothing at all when the listen was cancelled', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('cancelled'));
    const { user, view } = await setup();
    view(<VoiceButton />);

    await press(user);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The sheet is open and the typed box works, which is the whole point.
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});
