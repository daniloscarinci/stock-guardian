// @vitest-environment happy-dom
/**
 * The ask sheet, driven through the box it is made of.
 *
 * Two things are stubbed and nothing else. The network - the Anthropic SDK, so
 * that not one assertion here can reach the real API or spend anybody's money.
 * And the choice of recognizer, in the last blocks only, because speech cannot
 * be typed and what those blocks test is precisely what the interface does with
 * a listen that fails. `speechFailureReason` and the failure codes stay real:
 * reading a reason out of what a platform threw is half of what is checked.
 *
 * The database is real - the same in-memory SQLite driver the repository tests
 * use, migrated and seeded. That is what lets the central promise of this
 * feature be asserted rather than described: after a change is understood and
 * the card is on screen, the item's quantity is read straight out of the
 * database and is still the old one - and, for a change that was said in full,
 * that the quantity moved without anyone being asked to confirm it. It holds
 * for both engines, and the second half of this file is about the one that
 * cannot be trusted to have understood.
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
import { createContactsRepository } from '../../repositories/contacts.repository';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { AppProvider } from '../../app/AppContext';
import type { AppContext } from '../../app/bootstrap';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';
import type { DatabaseDiagnostics } from '../../database/worker/protocol';
import Anthropic from '@anthropic-ai/sdk';
import type * as AnthropicSdk from '@anthropic-ai/sdk';
import type * as ConverseModule from '../../services/ai/converse';
import type { AiOutcome } from '../../services/ai/converse';
import type * as RecognizerModule from '../../services/speech/recognizer';
import {
  openAppSettings,
  selectRecognizer,
  SpeechFailureError,
  type SpeechFailure,
  type SpeechRecognizer,
} from '../../services/speech/recognizer';
import { VoiceSheet } from './VoiceSheet';
import { VoiceButton } from './VoiceButton';

// Only the choice of recognizer. Everything else in that module is the real
// thing, including the reason-reading the microphone was rebuilt around.
vi.mock('../../services/speech/recognizer', async (importOriginal) => {
  const actual = await importOriginal<typeof RecognizerModule>();
  // `openAppSettings` leaves the application, so it is a spy rather than the
  // real thing. What is asserted is that the button reaches it at all.
  return { ...actual, selectRecognizer: vi.fn(), openAppSettings: vi.fn() };
});

/** A device that can listen, and whose every listen ends the same way. */
function recognizerFailing(reason: SpeechFailure): SpeechRecognizer {
  return {
    availability: () => Promise.resolve('ready'),
    listen: () => Promise.reject(new SpeechFailureError(reason)),
  };
}

/**
 * A device that hears one thing, however many times it is asked.
 *
 * `online` is what a real recognizer reports when its on-device attempt failed
 * and the retry transcribed instead. The two attempts themselves are pinned in
 * capacitor.test.ts and webspeech.test.ts; what is checked here is that the
 * sheet says which one answered.
 */
function recognizerHearing(phrase: string, online = false): SpeechRecognizer {
  return {
    availability: () => Promise.resolve('ready'),
    listen: () => Promise.resolve({ text: phrase, online }),
  };
}

/**
 * A device that is still listening, and can be told to stop.
 *
 * The listen never settles, which is what a real one looks like between the
 * press and the sentence. `cancel` is the whole point: Android now binds the
 * recognition service itself and shows no screen, so this is the only way back
 * out of a press.
 */
function recognizerListening(): {
  readonly recognizer: SpeechRecognizer;
  readonly cancel: ReturnType<typeof vi.fn>;
} {
  const cancel = vi.fn(async () => undefined);
  return {
    recognizer: {
      availability: () => Promise.resolve('ready'),
      listen: () => new Promise<never>(() => {}),
      cancel,
    },
    cancel,
  };
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

/**
 * The log, which is the one live region in the sheet.
 *
 * Found by the attribute rather than by role, because what several assertions
 * below are about is precisely which elements are INSIDE it: the log is
 * announced as it grows, so anything placed in it is read out when it changes,
 * and the examples must not be.
 */
function liveRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[aria-live]');
  if (region === null) throw new Error('the sheet lost its live region');
  return region;
}

/** Presses the microphone and lets the listen settle. */
async function listen(user: ReturnType<typeof userEvent.setup>) {
  await ready();
  await user.click(screen.getByRole('button', { name: /speak instead of typing/i }));
  await ready();
}

/** A `speechSynthesis` that records what it was asked to read. */
function stubSpeaker() {
  const spoken = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak: spoken, cancel: vi.fn(), getVoices: () => [] });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = '';
      voice: unknown = null;
      constructor(public text: string) {}
    },
  );
  return spoken;
}

/*
 * The SDK, replaced. The real error classes are kept as statics, because
 * `converse` narrows with `instanceof` and a lookalike would make those
 * branches pass for the wrong reason. `client.ts` still runs for real, so the
 * assertion that no key constructs no client is made against the code that
 * would have constructed one.
 */
const anthropic = vi.hoisted(() => ({
  create: vi.fn<(params: unknown) => Promise<unknown>>(),
  constructed: vi.fn<(options: unknown) => void>(),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof AnthropicSdk>();
  class MockAnthropic {
    messages = { create: (params: unknown): Promise<unknown> => anthropic.create(params) };
    constructor(options: unknown) {
      anthropic.constructed(options);
    }
    static APIError = actual.APIError;
    static APIConnectionError = actual.APIConnectionError;
    static AuthenticationError = actual.AuthenticationError;
    static RateLimitError = actual.RateLimitError;
  }
  return { ...actual, default: MockAnthropic };
});

/*
 * `converse` runs for real over that mocked SDK, EXCEPT where a test needs an
 * outcome the real loop cannot produce - a proposal whose certainty field lies.
 * The point of that one test is what the interface does with such a write, and
 * the only way to hand it one is to fabricate it here.
 */
const ai = vi.hoisted(() => ({ outcome: null as AiOutcome | null }));

vi.mock('../../services/ai/converse', async (importOriginal) => {
  const actual = await importOriginal<typeof ConverseModule>();
  return {
    ...actual,
    converse: async (
      deps: Parameters<typeof actual.converse>[0],
      options: Parameters<typeof actual.converse>[1],
      question: string,
    ): Promise<AiOutcome> =>
      ai.outcome === null ? actual.converse(deps, options, question) : ai.outcome,
  };
});

/** A reply from the API, with only the parts that matter spelled out. */
function reply(overrides: Record<string, unknown>): unknown {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...overrides,
  };
}

const spoke = (value: string): unknown => ({ type: 'text', text: value });

const toolUse = (name: string, input: Record<string, unknown>): unknown => ({
  type: 'tool_use',
  id: 'toolu_test',
  name,
  input,
});

/** Settings with the assistant on and a key nobody could bill. */
const WITH_CLAUDE = {
  aiEnabled: true,
  anthropicApiKey: 'sk-ant-not-a-real-key',
  aiModel: 'claude-opus-5',
} as const;

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
      contacts: createContactsRepository(db),
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

/** The Beans row as the interface sees it, for a proposal built by hand. */
async function beansRow() {
  const page = await items.list(
    { today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90] },
    { filters: { search: 'Beans' }, lang: 'en' },
  );
  const row = page.rows[0];
  if (row === undefined) throw new Error('the fixture lost its beans');
  return row;
}

const quantityOf = async (name: string) =>
  db.selectValue<number>('SELECT quantity FROM items WHERE name = ?', [name]);

/** Asked of the table rather than of a repository, so nothing can normalise it away. */
const countOfLocations = async (name: string) =>
  db.selectValue<number>('SELECT COUNT(*) FROM locations WHERE name = ?', [name]);

/**
 * The same question about a category, asked of the side table the names live
 * in - `categories` itself holds no name at all.
 */
const countOfCategoryNames = async (name: string) =>
  db.selectValue<number>('SELECT COUNT(*) FROM category_names WHERE name = ?', [name]);

/** The phone number stored against a contact, or undefined for no such row. */
const phoneOf = async (name: string) =>
  db.selectValue<string>('SELECT phone FROM contacts WHERE name = ?', [name]);

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

  ai.outcome = null;
  anthropic.create.mockReset();
  anthropic.constructed.mockReset();

  // A microphone whose every listen ends in a cancellation, which is the one
  // outcome the interface answers with silence. Tests that care override it.
  vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('cancelled'));
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await db.close().catch(() => undefined);
});

describe('VoiceSheet', () => {
  /**
   * What the sheet offers somebody who has not said anything yet.
   *
   * The examples were always there - nine per language, translated, every one
   * of them a phrase the grammar accepts - and nothing put them on screen
   * until a sentence failed or somebody asked for help outright. This is the
   * whole of that fix, and the assertion that matters is the second one:
   * pressing a chip FILLS the box. It does not send it. A first reader gets to
   * see the shape of a sentence and change the noun before anything happens,
   * which is why the last line here asks the screen for an answer that must
   * not be on it.
   */
  it('offers examples before anything has been asked, and fills the box with one', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    // Named after the line above it, so the list announces what it is for.
    const hints = screen.getByRole('list', { name: 'Try one of these' });
    // Six of the grammar's twelve, which is the resting count and no longer a
    // height budget: the other six are behind the disclosure below them, and the
    // microphone and the box are pinned in the footer where no number of chips
    // can reach them.
    expect(within(hints).getAllByRole('button')).toHaveLength(6);

    await user.click(within(hints).getByRole('button', { name: 'how much rice do i have?' }));

    const box = screen.getByRole('textbox') as HTMLInputElement;
    expect(box.value).toBe('how much rice do i have?');
    expect(document.activeElement).toBe(box);
    expect(screen.queryByText(/Rice: 3 kg/i)).toBeNull();
  });

  /**
   * And they go once there is a log to read instead.
   *
   * By then the exchange above says what this application understood and what
   * it did about it, which teaches the same lesson better; leaving the chips
   * would put six buttons between the reader and their own conversation.
   */
  it('drops the examples once there is a history', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'how much rice do i have');
    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();

    expect(screen.queryByRole('list', { name: 'Try one of these' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'how much rice do i have?' })).toBeNull();
  });

  /**
   * THE PLACEMENT THAT CANNOT REGRESS.
   *
   * The chips are a sibling of the log, inside the same scroll box, and never a
   * child of it. That `<ol>` is `aria-live="polite"`, so everything inside it is
   * read out when it changes: six example sentences appearing as a sheet opens
   * and vanishing as the first answer arrives would be six announcements about
   * nothing. The second half of this is what made the rework worth doing - the
   * twelve examples under "I did not understand that" used to be rendered INSIDE
   * the live region, so somebody not looking at the screen heard the failure and
   * then twelve whole sentences read at them.
   */
  it('keeps the examples outside the live region, at rest and after a failure', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    const log = liveRegion();
    expect(log.getAttribute('aria-live')).toBe('polite');

    const chips = screen.getByRole('list', { name: 'Try one of these' });
    expect(log.contains(chips)).toBe(false);
    // Siblings in the same scroll box, which is what makes them the log's empty
    // state rather than a block standing above the controls they teach about.
    expect(chips.closest('div')?.parentElement).toBe(log.parentElement);

    await say(user, 'aaa bbb');
    expect(await screen.findByText(/did not understand/i)).toBeTruthy();

    expect(liveRegion().contains(screen.getByRole('list', { name: 'Try one of these' }))).toBe(
      false,
    );
    // The failure is announced. The sentences to try are not.
    expect(liveRegion().textContent).toMatch(/did not understand/i);
    expect(liveRegion().textContent).not.toMatch(/how much rice do i have/i);
  });

  /**
   * The other six, one press away rather than read at anybody.
   *
   * One list, lengthened - not a second list beside the first. `aria-expanded`
   * on the button is what says so to a reader who cannot see the row grow, which
   * is the same contract the install steps in `MicNotice` use.
   */
  it('reveals all twelve examples from a disclosure, in the same list', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    const chips = () => screen.getByRole('list', { name: 'Try one of these' });
    expect(within(chips()).getAllByRole('button')).toHaveLength(6);

    const more = screen.getByRole('button', { name: 'More examples' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.getAttribute('aria-controls')).toBe(chips().id);

    await user.click(more);

    expect(within(chips()).getAllByRole('button')).toHaveLength(12);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('list', { name: 'Try one of these' })).toHaveLength(1);
    // The twelfth is the longest sentence the grammar accepts, and it is here
    // rather than in a paragraph somewhere else.
    expect(
      within(chips()).getByRole('button', { name: 'new contact ana phone number 555 1234' }),
    ).toBeTruthy();

    await user.click(more);
    expect(within(chips()).getAllByRole('button')).toHaveLength(6);
  });

  /**
   * The box is the dialog's footer, and the footer is not in the scroll box.
   *
   * This is the whole point of the rework, asserted in the only honest form
   * available without layout: happy-dom computes no heights, so "Send is below
   * the fold" cannot be measured here. What CAN be pinned is the reason it can
   * no longer happen - all three ways in are inside `<footer>`, which is a
   * sibling of the scrolling body rather than its last block, so no amount of
   * conversation and no number of example rows can move any of them.
   */
  it('keeps the composer out of the scroll box, so nothing in the log can move it', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    const footer = screen.getByRole('textbox').closest('footer');
    expect(footer).not.toBeNull();
    expect(footer?.contains(screen.getByRole('button', { name: /^send$/i }))).toBe(true);
    expect(footer?.contains(screen.getByRole('button', { name: /speak instead of typing/i }))).toBe(
      true,
    );
    expect(footer?.contains(liveRegion())).toBe(false);
    expect(liveRegion().closest('footer')).toBeNull();

    await say(user, 'how much rice do i have');
    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    await say(user, 'what is expiring');
    await vi.waitFor(() => {
      expect(within(liveRegion()).getAllByRole('listitem')).toHaveLength(2);
    });

    // Still the same element, still outside the scroller.
    expect(screen.getByRole('textbox').closest('footer')).toBe(footer);
  });

  /**
   * The instruction moved into the header, AND THAT IS A TRADE.
   *
   * What it buys is the assertion below: the sentence is the dialog's
   * description, so it is announced when the sheet opens, which a label sixty
   * pixels above the box never was. What it costs is a visible label that
   * persists - the placeholder disappears on the first keystroke and is not an
   * accessible name in any case. So the box keeps a real `<label>`, hidden with
   * the same `sr-only` utility the search boxes on the other screens use, and
   * the assertion for that is the one that finds the box BY ITS NAME.
   */
  it('says what the box is for in the header, and still labels the box itself', async () => {
    const { view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    const dialog = document.querySelector('dialog');
    const describedBy = dialog === null ? null : dialog.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const description = describedBy === null ? null : document.getElementById(describedBy);
    expect(description?.textContent).toBe('Ask a question, or type a command');

    const box = screen.getByRole('textbox', { name: 'Ask a question, or type a command' });
    expect(box.getAttribute('placeholder')).toBe('Type here');
    const label = document.querySelector(`label[for="${box.id}"]`);
    expect(label?.className).toContain('sr-only');
  });

  /**
   * One busy treatment, over the two regions that hold controls.
   *
   * Nine controls in this sheet used to carry a `disabled={busy}` of their own,
   * and `:disabled` dimmed each one separately. Six went when these two regions
   * were introduced, and the last three went with the confirmation card's own
   * rework - there is a test for those among the proposal cards below. `inert`
   * on a region does the whole job once per region: the subtree leaves the tab
   * order, leaves the accessibility tree, and stops answering a pointer.
   *
   * THE CATCH IS THE LAST THREE ASSERTIONS. The status line saying why the sheet
   * has gone quiet has to stand outside both regions. Inside one, it would be
   * removed from the accessibility tree along with everything else, which would
   * leave the explanation for the greying readable only by people who could see
   * the greying.
   */
  it('takes the log and the composer out of reach while Claude is waited on, and says why outside both', async () => {
    let answer: (value: unknown) => void = () => undefined;
    anthropic.create.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          answer = resolve;
        }),
    );

    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'what should i eat before it goes off');

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/reading your stock/i);

    const conversation = liveRegion().parentElement;
    const composer = screen.getByRole('textbox').closest('form');
    expect(conversation?.hasAttribute('inert')).toBe(true);
    expect(composer?.hasAttribute('inert')).toBe(true);

    // happy-dom honours `inert` in the one way a test can observe it: nothing
    // inside can take focus.
    const box = screen.getByRole('textbox');
    box.focus();
    expect(document.activeElement).not.toBe(box);

    expect(conversation?.contains(status)).toBe(false);
    expect(composer?.contains(status)).toBe(false);
    expect(status.closest('[inert]')).toBeNull();

    await act(async () => {
      answer(reply({ content: [spoke('Eat the milk first.')] }));
    });

    expect(await screen.findByText(/Eat the milk first/)).toBeTruthy();
    expect(conversation?.hasAttribute('inert')).toBe(false);
    expect(composer?.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

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

  /**
   * THE CARD IS THREE BANDS, AND THE STRUCTURE IS ALL THIS FILE CAN CHECK.
   *
   * happy-dom computes no layout, so the height this grouping bought cannot be
   * asserted here; it was measured in Edge instead, and the figures live in the
   * note on `.band` in Voice.module.css. What IS assertable is the arrangement
   * those figures come out of: three children, and which lines are in which of
   * them. The card used to be five or six children with the same gap between
   * every pair, so the name and the two facts stored under it stood as far
   * apart as the change stood from the button that performs it.
   *
   * The contact is the card with the most to group - its identity band is the
   * name and two facts stored under it - which is why this asserts on that one
   * rather than on the quantity card above.
   *
   * The bands are `<div>`s with no role. Nothing a screen reader walks changes,
   * and the two assertions on the buttons are here to say so: they are still
   * found by their own names, from inside the band that now holds them.
   */
  it('groups the card into identity, the decision, and the reasons with the buttons', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'new contact my sister ana phone five five five one two three four');

    const card = await screen.findByRole('group', { name: 'ana' });
    const band = (position: number): HTMLElement => {
      const node = card.children[position];
      if (!(node instanceof HTMLElement)) throw new Error('the card lost a band');
      return node;
    };
    expect(card.children).toHaveLength(3);

    // Identity: who this is, and everything stored under the name.
    expect(within(band(0)).getByRole('heading', { name: 'ana' })).toBeTruthy();
    expect(within(band(0)).getByText('Relationship: sister')).toBeTruthy();
    expect(within(band(0)).getByText('Phone: 5551234')).toBeTruthy();
    expect(within(band(0)).queryByText('New contact')).toBeNull();

    // The decision, on its own. No heading, because the heading is a fact
    // about the row rather than part of what is being asked.
    expect(within(band(1)).getByText('New contact')).toBeTruthy();
    expect(within(band(1)).queryByRole('heading')).toBeNull();

    // The reasons and the verdict, together: somebody reading a guess is about
    // to press one of these two.
    expect(within(band(2)).getByText('What I filled in')).toBeTruthy();
    expect(
      within(band(2)).getByText(
        'I heard this number rather than being shown it. Check every digit.',
      ),
    ).toBeTruthy();
    expect(within(band(2)).getByRole('button', { name: /^confirm:/i })).toBeTruthy();
    expect(within(band(2)).getByRole('button', { name: /^cancel$/i })).toBeTruthy();
  });

  /**
   * THE GUESSES ARE STILL A LIST, AND THE DASH IN FRONT OF EACH IS NOT IN IT.
   *
   * The indent went so that these sentences get the card's own width, and a
   * hanging en dash took the bullet's place - `.guessList` and `.guessDash` in
   * Voice.module.css measure what each of those was worth. Both halves are
   * asserted here, because both can regress on their own: the `<ul>` and its
   * `<li>`s are what tell a screen reader how many separate things were filled
   * in, which is work no run of paragraphs would do, while the dash is
   * decoration and is hidden. What cannot be asserted in this file is the
   * hanging itself, which is layout, and happy-dom computes none.
   *
   * The last assertion is the load-bearing one and is easy to misread.
   * `getByText` matches an element against ITS OWN text nodes, so the sentence
   * being found ON THE `<li>` is what proves the dash sits in a child element of
   * its own rather than inside the sentence a screen reader reads out.
   */
  it('keeps the guesses a real list, with the dash out of what is read', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'create item 2 kg of quinoa in the cellar');

    const card = await screen.findByRole('group', { name: 'quinoa' });
    const list = within(card).getByRole('list');
    expect(list.tagName).toBe('UL');

    const guesses = within(list).getAllByRole('listitem');
    expect(guesses.length).toBeGreaterThan(0);
    for (const guess of guesses) {
      // There to look at...
      expect(guess.textContent?.trimStart().startsWith('–')).toBe(true);
      // ...and not there to hear.
      expect(within(guess).getByText('–').getAttribute('aria-hidden')).toBe('true');
    }

    const line = within(card).getByText('No place is called cellar. Confirming makes it.');
    expect(line.tagName).toBe('LI');
  });

  /**
   * The one guess on a card that names something the user does not have.
   *
   * Every other reason points at a row that exists and asks whether it is the
   * right one. This one says a second row is about to be made, and confirming
   * writes both - so the card has to say it in the same list it says
   * everything else in, and the name it shows has to be the name that will be
   * stored.
   */
  it('says on the card that a place a creation named will be made', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'create item 2 kg of quinoa in the cellar');

    const card = await screen.findByRole('group', { name: 'quinoa' });
    expect(
      within(card).getByText('No place is called cellar. Confirming makes it.'),
    ).toBeTruthy();

    // Nothing is written until Confirm, the place least of all.
    expect(await countOfLocations('cellar')).toBe(0);
  });

  /**
   * The sentence whose whole content is a place, from the box to the database
   * and back out as words.
   *
   * Every other card in this file is about an item, so this is the one that
   * shows the card rendering a write with no row behind it: the heading is the
   * name that was said, the line under it is the kind of thing being made, and
   * the guess is the only question actually open - whether that is how the user
   * spells it. There is no quantity and no shelf above it, because there is no
   * item to have either.
   *
   * The read-back is asked of the PLACE, there being no item to ask after.
   * "There is nothing in cellar" is a thin sentence and a true one, and it is
   * read out of the database after the write: a name that had not been stored
   * would have come back as nothing found and said nothing at all, so hearing
   * this sentence is itself the proof the row is there.
   */
  it('makes a place that was asked for on its own, and reads back what is in it', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'new place, cellar');

    const card = await screen.findByRole('group', { name: 'cellar' });
    expect(within(card).getByText('New location')).toBeTruthy();
    expect(
      within(card).getByText('No place is called cellar. Confirming makes it.'),
    ).toBeTruthy();

    // Nothing is written while the card is on screen, here as everywhere else.
    expect(await countOfLocations('cellar')).toBe(0);

    // The whole change on the button, for the reader who never sees the card.
    const confirm = await screen.findByRole('button', { name: /^confirm:/i });
    expect(confirm.getAttribute('aria-label')).toBe('Confirm: cellar, New location');
    await user.click(confirm);

    expect(await screen.findByText('There is nothing in cellar.')).toBeTruthy();
    expect(await countOfLocations('cellar')).toBe(1);
    // Confirmed on the card, so there is no second chance to refuse it.
    expect(screen.queryByRole('button', { name: /^undo/i })).toBeNull();
  });

  /**
   * The same sentence about a heading rather than a shelf, end to end.
   *
   * The card has no quantity, no unit and no place on it, because there is no
   * item to have any; the heading is the name that was said and the line under
   * it is the kind of row being made. The read-back is asked of the CATEGORY,
   * and "Nothing is filed under bunker" is thin, true, and read out of the
   * database after the write - a name that had not been stored would have come
   * back as nothing found and said nothing at all.
   */
  it('makes a category that was asked for on its own, and reads back what is in it', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'new category, bunker');

    const card = await screen.findByRole('group', { name: 'bunker' });
    expect(within(card).getByText('New category')).toBeTruthy();
    expect(
      within(card).getByText('No category is called this. Confirming makes it.'),
    ).toBeTruthy();

    // Nothing is written while the card is on screen, here as everywhere else.
    expect(await countOfCategoryNames('bunker')).toBe(0);

    const confirm = await screen.findByRole('button', { name: /^confirm:/i });
    expect(confirm.getAttribute('aria-label')).toBe('Confirm: bunker, New category');
    await user.click(confirm);

    expect(await screen.findByText('Nothing is filed under bunker.')).toBeTruthy();
    expect(await countOfCategoryNames('bunker')).toBe(1);
    // Named in the one language the interface is in, and not in the other two.
    expect(
      await db.selectValue<number>(
        "SELECT COUNT(*) FROM category_names WHERE name = 'bunker' AND lang = 'en'",
      ),
    ).toBe(1);
    expect(screen.queryByRole('button', { name: /^undo/i })).toBeNull();
  });

  /**
   * A heading the household already has is described, not made a second time.
   *
   * The seeded categories include Tools, so this sentence never reaches a card
   * at all: `execute` answers it with what is filed under the one that exists,
   * which is what lets the user hear that they already have it. Two headings
   * whose names they cannot tell apart would be the worse outcome.
   */
  it('answers a category that already exists instead of making a second', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'new category, tools');

    expect(await screen.findByText('Nothing is filed under Tools.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^confirm:/i })).toBeNull();
    expect(await countOfCategoryNames('tools')).toBe(0);
  });

  /**
   * A person, a relationship and a phone number said one digit at a time -
   * the sentence this whole task exists for, from the box to the database and
   * back out as words.
   *
   * Three things are asserted here that no layer below can assert together.
   *
   * THE NUMBER IS DIGITS. "five five five one two three four" reaches the
   * table as the string 5551234. Put through `parseNumber` the same words come
   * to 5551234's arithmetic - 5 + 5 + 5 + 1 + 2 + 3 + 4 = 25 - and what would
   * be stored is a number nobody said.
   *
   * THE CARD SHOWS IT. The guess says to check every digit, so the digits have
   * to be in front of the reader - on the card, and on the button that carries
   * the whole change for somebody who never sees the card.
   *
   * THE READ-BACK SAYS IT. After Confirm, the sentence is read out of the
   * DATABASE by the same QUERY_CONTACT anybody could ask out loud, so what is
   * heard is what was stored rather than what was understood. That is the only
   * check there is on a number that was heard rather than typed.
   */
  it('makes a contact, shows the digits it heard, and reads them back', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'new contact my sister ana phone five five five one two three four');

    const card = await screen.findByRole('group', { name: 'ana' });
    expect(within(card).getByText('New contact')).toBeTruthy();
    expect(within(card).getByText('Relationship: sister')).toBeTruthy();
    expect(within(card).getByText('Phone: 5551234')).toBeTruthy();
    expect(
      within(card).getByText('I heard this number rather than being shown it. Check every digit.'),
    ).toBeTruthy();

    // Nothing is written while the card is on screen, here as everywhere else.
    expect(await phoneOf('ana')).toBeUndefined();

    const confirm = await screen.findByRole('button', { name: /^confirm:/i });
    expect(confirm.getAttribute('aria-label')).toBe(
      'Confirm: ana, Relationship: sister, Phone: 5551234, New contact',
    );
    await user.click(confirm);

    expect(await screen.findByText('ana, sister: 5551234.')).toBeTruthy();
    expect(await phoneOf('ana')).toBe('5551234');
    // Confirmed on the card, so there is no second chance to refuse it.
    expect(screen.queryByRole('button', { name: /^undo/i })).toBeNull();
  });

  /**
   * The sentence a review found the card lying about.
   *
   * "my doctor" is the handle the relationship slot exists to catch, so this
   * is an ordinary thing to say. The rule's first shape could not attach its
   * phone group at the front of the name slot, so the digits ended up inside
   * the name and the phone field stayed null - and with no phone there is no
   * `heardDigits` guess, so the button read "Confirm: phone 5551234,
   * Relationship: doctor, New contact" and told a reader who could not see the
   * screen to check nothing at all.
   *
   * Asserted end to end rather than on the intent alone, because the harm was
   * end to end: what makes it a defect is not where the digits are stored but
   * what the button says about them.
   */
  it('does not melt a number into the name when the relationship comes first', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'new contact my doctor phone five five five one two three four');

    const card = await screen.findByRole('group', { name: 'my doctor' });
    expect(within(card).getByText('Phone: 5551234')).toBeTruthy();
    expect(
      within(card).getByText('I heard this number rather than being shown it. Check every digit.'),
    ).toBeTruthy();

    const confirm = await screen.findByRole('button', { name: /^confirm:/i });
    expect(confirm.getAttribute('aria-label')).toBe(
      'Confirm: my doctor, Phone: 5551234, New contact',
    );
    await user.click(confirm);

    expect(await screen.findByText('my doctor: 5551234.')).toBeTruthy();
    expect(await phoneOf('my doctor')).toBe('5551234');
  });

  /**
   * A sentence that named a number the grammar could not read as digits is
   * refused whole.
   *
   * "five hundred" is a quantity. Storing the contact without it would drop
   * the half of the sentence the speaker cared about and leave them believing
   * a number was saved, so the rule declines and the sheet says it did not
   * understand. Nothing is written, and no card offers to write it.
   */
  it('refuses a contact whose spoken number was a quantity, and stores nothing', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'new contact ana phone five hundred');

    expect(await screen.findByText(/did not understand|didn.t understand/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^confirm:/i })).toBeNull();
    expect(await phoneOf('ana')).toBeUndefined();
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

  /**
   * One chip treatment, reached the second way.
   *
   * A sentence that was not understood used to be followed by a bulleted list of
   * all twelve examples, inside the exchange, in a shape nothing could be done
   * with. It is the same six chips as an empty sheet now, with the same
   * disclosure behind them, and pressing one still fills the box rather than
   * sending it - which is the assertion at the end.
   */
  it('shows what it heard when it did not understand, and offers the chips for it', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'aaa bbb');

    expect(await screen.findByText(/aaa bbb/)).toBeTruthy();
    expect(screen.getByText(/did not understand/i)).toBeTruthy();

    const chips = screen.getByRole('list', { name: 'Try one of these' });
    expect(within(chips).getAllByRole('button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'More examples' })).toBeTruthy();

    await user.click(within(chips).getByRole('button', { name: 'how much rice do i have?' }));

    const box = screen.getByRole('textbox') as HTMLInputElement;
    expect(box.value).toBe('how much rice do i have?');
    expect(document.activeElement).toBe(box);
  });

  /**
   * And they go again the moment a sentence lands.
   *
   * They are help for the failure, not a permanent fixture of a sheet that has
   * ever failed once: the chips hang off the LAST exchange, so an answer after a
   * failure takes them away exactly as the first answer does on an empty sheet.
   */
  it('drops the chips again once a later sentence was understood', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'aaa bbb');
    expect(await screen.findByRole('list', { name: 'Try one of these' })).toBeTruthy();

    await say(user, 'how much rice do i have');
    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();

    expect(screen.queryByRole('list', { name: 'Try one of these' })).toBeNull();
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

  /*
   * The header opens the sheet and does not listen. That is the placement
   * decision, asserted rather than described: a header control that started a
   * listen would put a speech failure in front of everybody who only came to
   * type, on exactly the phone this feature failed on the first time.
   */
  it('opens the sheet from the header, and starts no listen of its own', async () => {
    const { user, view } = await setup({ askEnabled: true });
    view(<VoiceButton />);

    await user.click(screen.getByRole('button', { name: /ask about your stock/i }));

    expect(screen.getByRole('textbox')).toBeTruthy();
    // The microphone is here, inside the sheet, and it has not been used.
    expect(screen.getByRole('button', { name: /speak instead of typing/i })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/speech pack|offline model|on this device only/i)).toBeNull();
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
describe('the microphone: why it produced nothing', () => {
  it.each([
    ['no-recognizer', /cannot transcribe speech on its own/i],
    ['network', /did not find it/i],
    ['no-match', /did not hear anything/i],
    ['busy', /Something else is using the microphone/i],
    ['failed', /microphone could not be used/i],
  ] as const)('says what happened when the listen failed with %s', async (reason, expected) => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing(reason));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(expected)).toBeTruthy();
  });

  /** A banner after a deliberate "never mind" teaches people to ignore banners. */
  it('shows nothing at all when the listen was cancelled', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The box is still there and still works, which is the whole point.
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('explains a missing speech pack, and offers the install path', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/no offline speech pack/i)).toBeTruthy();

    /*
     * The panel is a message and the microphone is a control, so they are in
     * different halves of the sheet: this goes at the top of the scroll box, and
     * the button stays in the pinned footer beside the box. A paragraph, two
     * buttons, a collapsible explanation, a switch and a hint cannot sit in a
     * footer, and putting them there would be the original bug again - an
     * explanation of the control that failed on top of the one that works.
     */
    expect(screen.getByText(/no offline speech pack/i).closest('footer')).toBeNull();
    expect(
      screen.getByRole('button', { name: /speak instead of typing/i }).closest('footer'),
    ).not.toBeNull();

    // The install path is there, folded away until it is asked for.
    const steps = screen.getByText(/Offline speech recognition/i);
    expect(steps.hidden).toBe(true);
    await user.click(screen.getByRole('button', { name: /how to install/i }));
    expect(steps.hidden).toBe(false);
  });

  it('dismisses that panel to the typed box, which is the feature that still works', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);
    await screen.findByText(/no offline speech pack/i);

    await user.click(screen.getByRole('button', { name: /type the command instead/i }));

    expect(screen.queryByText(/no offline speech pack/i)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });
});

/**
 * The microphone permission, which this application did not use to hold.
 *
 * Speech arrived through Android's own recognizer screen, so there was nothing
 * to refuse and no refusal to explain. That design could not work on the phone
 * this is built for - the Intent behind that screen is handled by a component
 * the device does not have, while the keyboard's voice typing works perfectly -
 * so the application now records, holds RECORD_AUDIO, and asks for it on the
 * first press.
 *
 * A refusal is an outcome, not an error, and the two refusals are different
 * outcomes. One can be asked again by pressing the microphone. The other cannot
 * be asked again at all, and an application that kept prompting into that void
 * would be a dead control with an animation on it.
 */
describe('the microphone: when the permission is refused', () => {
  it('says the permission was not given, and that the microphone can ask again', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('permission-denied'));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/needs your permission/i)).toBeTruthy();
    // No settings button here: the next press raises the system prompt again,
    // so sending somebody to a settings screen would be the longer way round.
    expect(screen.queryByRole('button', { name: /open app settings/i })).toBeNull();
  });

  it('says a permanent refusal is permanent, and offers the one screen that undoes it', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('permission-blocked'));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/refused for good/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /open app settings/i }));
    expect(vi.mocked(openAppSettings)).toHaveBeenCalled();
  });

  it('leaves the typed box as the way through, which is the feature that still works', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('permission-blocked'));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);
    await screen.findByText(/refused for good/i);

    await user.click(screen.getByRole('button', { name: /type the command instead/i }));

    expect(screen.queryByText(/refused for good/i)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });
});

/**
 * Taking a press back.
 *
 * The system's recognizer screen came with a back button and this replaces it.
 * Without it a press made by mistake holds the microphone open until the
 * recognizer tires of the silence, on a device where this process - not the
 * system - is the one recording.
 */
describe('the microphone: stopping a listen', () => {
  it('offers a way to stop while it is listening, and tells the platform to', async () => {
    const listening = recognizerListening();
    vi.mocked(selectRecognizer).mockResolvedValue(listening.recognizer);
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(screen.getByRole('status').textContent).toMatch(/listening/i);

    /*
     * Both of them beside the button that opened the microphone, in the pinned
     * footer. Stopping is the one urgent thing there is to do while a listen is
     * open - on Android it is this process holding the recorder - so the control
     * for it must not be somewhere a scrolled log could have taken it.
     */
    const mic = screen.getByRole('button', { name: /speak instead of typing/i });
    const stop = screen.getByRole('button', { name: /stop listening/i });
    expect(stop.parentElement).toBe(mic.parentElement);
    expect(screen.getByRole('status').parentElement).toBe(mic.parentElement);
    expect(stop.closest('footer')).not.toBeNull();

    await user.click(stop);

    expect(listening.cancel).toHaveBeenCalledTimes(1);
  });

  /**
   * The listening row takes a row of its own rather than the box's place.
   *
   * "Listening…" and "Stop listening" cannot share the composer row - at 350px of
   * inner width a status line and a second button leave the box no room at all -
   * so the microphone's slot claims the whole width while a listen is open and
   * the box and Send wrap below it. What it must NOT do is replace them, and this
   * is why: reaching for the microphone half way through typing a sentence is an
   * ordinary thing to do, and losing those words would be this application
   * throwing away work nobody asked it to.
   */
  it('keeps what was already typed while it is listening, and after it is stopped', async () => {
    const listening = recognizerListening();
    vi.mocked(selectRecognizer).mockResolvedValue(listening.recognizer);
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'how much ri');
    await listen(user);

    expect(screen.getByRole('status').textContent).toMatch(/listening/i);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('how much ri');

    await user.click(screen.getByRole('button', { name: /stop listening/i }));

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('how much ri');
  });

  it('releases the microphone when the sheet goes away mid-listen', async () => {
    const listening = recognizerListening();
    vi.mocked(selectRecognizer).mockResolvedValue(listening.recognizer);
    const { user, view } = await setup();
    const { unmount } = view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);
    expect(listening.cancel).not.toHaveBeenCalled();

    unmount();

    expect(listening.cancel).toHaveBeenCalledTimes(1);
  });

  /*
   * Chrome ends a listen on silence by itself and implements no `cancel`. A
   * button that cannot do anything is worse than no button.
   */
  it('offers no stop button where the platform cannot honour one', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue({
      availability: () => Promise.resolve('ready'),
      listen: () => new Promise<never>(() => {}),
    });
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(screen.getByRole('status').textContent).toMatch(/listening/i);
    expect(screen.queryByRole('button', { name: /stop listening/i })).toBeNull();
  });
});

/**
 * The refusal, on the panel, and never flipped by anything but a person.
 *
 * The microphone tries the device first and falls back to the network once, so
 * the missing-model panel now appears only where that fallback could not run -
 * which is either "no connection" or "this person asked for on-device only".
 * The switch that draws the line is on the panel for the same reason it was
 * ever there: telling somebody their phone has no "offline speech pack" and
 * then sending them to hunt through Settings is how this failed the first time.
 */
describe('the microphone: the on-device-only refusal', () => {
  it('says on the panel that the refusal is off, and offers the switch unchecked', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);
    await screen.findByText(/the internet could not fill in either/i);

    const opt = screen.getByRole('checkbox', { name: /transcribe on this device only/i });
    expect((opt as HTMLInputElement).checked).toBe(false);
    // Labelled with what it does and who would otherwise receive the audio.
    expect(screen.getByText(/on most phones, to Google/i)).toBeTruthy();
  });

  it('blames the refusal, and only the refusal, when it is the reason', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const { user, view } = await setup({ voiceOfflineOnly: true });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/did not try the internet/i)).toBeTruthy();
    const opt = screen.getByRole('checkbox', { name: /transcribe on this device only/i });
    expect((opt as HTMLInputElement).checked).toBe(true);
  });

  it('leaves it alone through a failure that never gets a press', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const store = createSettingsRepository(db);
    const before = (await store.load()).settings.voiceOfflineOnly;
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);
    await screen.findByText(/the internet could not fill in either/i);

    // Read back rather than compared to a constant: what matters is that the
    // failure changed nothing, not which way it was set beforehand.
    const { settings } = await store.load();
    expect(settings.voiceOfflineOnly).toBe(before);
  });

  it('writes the setting when, and only when, somebody presses it', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerFailing('no-offline-model'));
    const store = createSettingsRepository(db);
    const { user, view } = await setup({ voiceOfflineOnly: true });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);
    await screen.findByText(/did not try the internet/i);

    await user.click(screen.getByRole('checkbox', { name: /transcribe on this device only/i }));

    await vi.waitFor(async () => {
      const { settings } = await store.load();
      expect(settings.voiceOfflineOnly).toBe(false);
    });
  });
});

/**
 * A question asked out loud, answered out loud.
 *
 * The two halves of this feature were built in different releases and one of
 * them was deleted in between, so the whole path is asserted rather than
 * assumed: the recognizer hands over a sentence, `run` treats it exactly as it
 * treats a typed one, and the answer reaches `speechSynthesis`.
 */
describe('the microphone: a spoken question gets a spoken answer', () => {
  it('runs what was heard and reads the answer back', async () => {
    const spoken = stubSpeaker();
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerHearing('how much rice do i have'));

    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(screen.getByText(/You asked: how much rice do i have/i)).toBeTruthy();

    await vi.waitFor(() => {
      expect(spoken).toHaveBeenCalled();
    });
    expect((spoken.mock.calls[0]?.[0] as { text: string }).text).toMatch(/Rice: 3 kg/i);
  });

  it('says nothing aloud when the setting is off, and still answers on screen', async () => {
    const spoken = stubSpeaker();
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerHearing('how much rice do i have'));

    const { user, view } = await setup({ voiceSpeakAnswers: false });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(spoken).not.toHaveBeenCalled();
  });

  /*
   * The half of the fallback that makes it something offered rather than
   * something done quietly. A press the phone answered itself says nothing
   * extra - most presses are that one - and a press the network answered is
   * marked, in the log, beside the marker naming the engine.
   */
  it('says nothing about the network when the phone did the transcribing', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(recognizerHearing('how much rice do i have'));
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(screen.queryByText(/transcribed online/i)).toBeNull();
    // One slot filled and no separator left standing where the other would be.
    expect(screen.getByText(/answered on this device/i).parentElement?.children).toHaveLength(1);
  });

  /**
   * Both facts about one exchange, on one line.
   *
   * They were two paragraphs with identical styling that could stack back to
   * back above the same answer. Merged, they are one row with two slots; the
   * middot between them is for the eye only and the comma is for the ear only,
   * because a separator read out as "middle dot" is noise and two phrases run
   * together with nothing between them are one confusing phrase.
   */
  it('marks the exchange when the words came over the internet', async () => {
    vi.mocked(selectRecognizer).mockResolvedValue(
      recognizerHearing('how much rice do i have', true),
    );
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await listen(user);

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    const online = screen.getByText(/transcribed online/i);
    // Beside the marker that says which engine answered, not instead of it, and
    // in the same row rather than on a second line under it.
    const engine = screen.getByText(/answered on this device/i);
    expect(online.parentElement).toBe(engine.parentElement);

    const slots = Array.from(online.parentElement?.children ?? []);
    expect(slots.map((slot) => slot.textContent)).toEqual([
      'Transcribed online',
      ', ',
      '·',
      'Answered on this device',
    ]);
    expect(slots[1]?.className).toContain('sr-only');
    expect(slots[1]?.getAttribute('aria-hidden')).toBeNull();
    expect(slots[2]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the mark on a typed question at nothing, because nothing was heard', async () => {
    const { user, view } = await setup();
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'how much rice do i have');

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(screen.queryByText(/transcribed online/i)).toBeNull();
  });
});

/**
 * The second engine.
 *
 * Everything below turns on one distinction: a question goes to Claude only
 * when the assistant is switched on AND a key is stored, and a question that
 * goes nowhere still gets an answer. `anthropic.create` is the whole proof of
 * what was sent - it is not called at all in half of these.
 */
describe('the assistant, and which engine answered', () => {
  it('sends the question to Claude and says whose answer it is', async () => {
    anthropic.create.mockResolvedValue(
      reply({ content: [spoke('Three things expire this month: Leite, Ovos, Arroz.')] }),
    );
    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'what should i eat before it goes off, considering the rain');

    expect(await screen.findByText(/Three things expire this month/)).toBeTruthy();
    expect(screen.getByText('Answered by Claude')).toBeTruthy();
    expect(anthropic.create).toHaveBeenCalledTimes(1);
  });

  it('answers on this device when the assistant is off, and sends nothing', async () => {
    const { user, view } = await setup({ ...WITH_CLAUDE, aiEnabled: false });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'how much rice do i have');

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(screen.getByText('Answered on this device')).toBeTruthy();
    // Not one request, and not even a client built to make one.
    expect(anthropic.create).not.toHaveBeenCalled();
    expect(anthropic.constructed).not.toHaveBeenCalled();
  });

  it('answers on this device when there is no key, and sends nothing', async () => {
    const { user, view } = await setup({ ...WITH_CLAUDE, anthropicApiKey: '' });
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'how much rice do i have');

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(screen.getByText('Answered on this device')).toBeTruthy();
    expect(anthropic.create).not.toHaveBeenCalled();
    expect(anthropic.constructed).not.toHaveBeenCalled();
  });

  /*
   * The fallback is the reason the parser was kept. A phone with no signal, or
   * a key typed with one character wrong, still answers what the twenty-two rules
   * can answer - and says why the other engine did not, because a silent
   * fallback would make a wrong key look exactly like an assistant nobody had
   * switched on.
   */
  it('falls back to the twenty-two rules when Claude cannot be reached, and says why', async () => {
    anthropic.create.mockRejectedValue(new Anthropic.APIConnectionError({ message: 'no route' }));
    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'how much rice do i have');

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(screen.getByText('Answered on this device')).toBeTruthy();
    expect(screen.getByText(/Claude could not be reached/i)).toBeTruthy();
  });

  it('falls back rather than dead-ending when the key is refused', async () => {
    anthropic.create.mockRejectedValue(
      new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()),
    );
    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'how much rice do i have');

    expect(await screen.findByText(/Rice: 3 kg/i)).toBeTruthy();
    expect(screen.getByText(/That API key was refused/i)).toBeTruthy();
  });
});

describe('the proposals Claude makes', () => {
  /** Reads the stock, then asks for a change it does not get. */
  function proposesFiveMoreBeans(): void {
    anthropic.create
      .mockResolvedValueOnce(
        reply({
          stop_reason: 'tool_use',
          content: [toolUse('adjust_quantity', { item: 'beans', amount: 5, direction: 'up' })],
        }),
      )
      .mockResolvedValueOnce(
        reply({ content: [spoke('I have proposed five more cans of beans.')] }),
      );
  }

  it('renders a card and writes nothing until Confirm is pressed', async () => {
    proposesFiveMoreBeans();
    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'i came back from the shop with five cans of beans');

    const card = await screen.findByRole('group', { name: 'Beans' });
    expect(within(card).getByText('12 cans')).toBeTruthy();
    expect(within(card).getByText('17 cans')).toBeTruthy();

    // The honest reason. A model chose this row; the user did not name it, and
    // "you did not say its whole name" would be a sentence about nothing.
    expect(
      within(card).getByText('The assistant chose this item. Check it is the one you meant.'),
    ).toBeTruthy();

    // The promise the whole feature rests on, asserted against the database.
    expect(await quantityOf('Beans')).toBe(12);
  });

  /**
   * THE CARD'S BUTTONS CARRY NO `disabled` OF THEIR OWN, AND DO NOT NEED ONE.
   *
   * Confirm and Cancel were two of the last three `disabled={busy}` props in
   * this sheet, out of nine. What replaced the other six is the region: the log
   * is `inert` for as long as something is being worked out, so everything in it
   * leaves the tab order and the accessibility tree at once. These two were kept
   * one commit longer only because the file they live in was out of scope then,
   * and they were not free - `.button:disabled` sets its own `opacity: 0.5`,
   * which composes with the region's 0.55 rather than replacing it, so the two
   * controls the card exists for faded to half of what the sentences explaining
   * them faded to.
   *
   * The state this asserts in is the one those props existed for and the one no
   * other test in this file reaches: a card still on screen, unanswered, while
   * a LATER question is being waited on. Claude is left hanging to hold it
   * there. What is checked is that the card goes out of reach without either
   * button being disabled, and that it comes back.
   */
  it('puts the card out of reach through the region, not through its buttons', async () => {
    proposesFiveMoreBeans();
    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'i came back from the shop with five cans of beans');

    const card = await screen.findByRole('group', { name: 'Beans' });
    const confirm = within(card).getByRole('button', { name: /^confirm:/i });
    const cancel = within(card).getByRole('button', { name: /^cancel$/i });
    expect(card.closest('[inert]')).toBeNull();
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(cancel.hasAttribute('disabled')).toBe(false);

    let answer: (value: unknown) => void = () => undefined;
    anthropic.create.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          answer = resolve;
        }),
    );

    await say(user, 'what should i eat before it goes off');
    expect(await screen.findByRole('status')).toBeTruthy();

    // Out of reach, and still not disabled. happy-dom honours `inert` in the
    // one way a test can observe it: nothing inside can take focus.
    expect(card.closest('[inert]')).not.toBeNull();
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(cancel.hasAttribute('disabled')).toBe(false);
    confirm.focus();
    expect(document.activeElement).not.toBe(confirm);

    await act(async () => {
      answer(reply({ content: [spoke('Eat the milk first.')] }));
    });

    expect(await screen.findByText(/Eat the milk first/)).toBeTruthy();
    expect(card.closest('[inert]')).toBeNull();
    // The offer survived the question, which is why it had to be protected.
    expect(within(card).getByRole('button', { name: /^confirm:/i })).toBeTruthy();
    expect(await quantityOf('Beans')).toBe(12);
  });

  it('writes when Confirm is pressed, and states what the item now holds', async () => {
    proposesFiveMoreBeans();
    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'i came back from the shop with five cans of beans');
    await user.click(await screen.findByRole('button', { name: /^confirm:/i }));

    expect(await screen.findByText(/Beans: 17 cans/i)).toBeTruthy();
    expect(await quantityOf('Beans')).toBe(17);
  });

  it('leaves the database alone when the proposal is discarded', async () => {
    proposesFiveMoreBeans();
    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'i came back from the shop with five cans of beans');
    await user.click(await screen.findByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('group', { name: 'Beans' })).toBeNull();
    expect(await quantityOf('Beans')).toBe(12);
  });

  /*
   * THE ONE THAT CANNOT BE ALLOWED TO REGRESS.
   *
   * The parser stores an `explicit` write without asking, because an exact item
   * and a spoken number leave nothing to check. Nothing that came through a
   * model has that property, and `tools.ts` marks every proposal `assumed` -
   * but a certainty field is a value, and a value can be wrong. So the sheet is
   * handed a proposal claiming to be explicit, and must still put it on a card
   * and write nothing.
   */
  it('never stores a proposal unasked, whatever its certainty claims', async () => {
    const beans = await beansRow();

    ai.outcome = {
      kind: 'answer',
      text: 'Five more cans of beans.',
      proposals: [
        {
          kind: 'ADJUST',
          item: beans,
          delta: 5,
          after: 17,
          transaction: 'purchase',
          certainty: 'explicit',
          assumptions: [],
        },
      ],
      requests: 1,
    };

    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'five more cans of beans');

    expect(await screen.findByRole('group', { name: 'Beans' })).toBeTruthy();
    expect(await quantityOf('Beans')).toBe(12);
    // And no receipt, because nothing happened for one to be about.
    expect(screen.queryByRole('button', { name: /^undo/i })).toBeNull();
  });

  /*
   * A loop that hit its cap has half an answer and whole proposals. Throwing
   * the proposals away would discard work the user can still say yes to, so
   * they are shown, and the sentence says what to do instead.
   */
  it('keeps the proposals when the question needed too many steps', async () => {
    const beans = await beansRow();

    ai.outcome = {
      kind: 'exhausted',
      proposals: [
        {
          kind: 'ADJUST',
          item: beans,
          delta: 5,
          after: 17,
          transaction: 'purchase',
          certainty: 'assumed',
          assumptions: ['assistant'],
        },
      ],
      requests: 8,
    };

    const { user, view } = await setup(WITH_CLAUDE);
    view(<VoiceSheet open onClose={vi.fn()} />);

    await say(user, 'plan my whole year of shopping');

    expect(await screen.findByText(/still working after 8 tries/i)).toBeTruthy();
    expect(screen.getByText(/Ask something narrower/i)).toBeTruthy();
    expect(await screen.findByRole('group', { name: 'Beans' })).toBeTruthy();
    expect(await quantityOf('Beans')).toBe(12);
  });
});
