// @vitest-environment happy-dom
/**
 * The phrasebook, rendered inside the real application context.
 *
 * The harness is the one `VoiceSheet.test.tsx` uses: the in-memory SQLite
 * driver, migrated and seeded, behind the provider the application itself
 * mounts. This screen reads nothing but the chosen language out of it, and that
 * is worth proving rather than assuming - a reference nobody can reach is not a
 * reference.
 *
 * What `phrases.test.ts` guarantees is that every phrase in the data resolves.
 * What this file guarantees is that the data is what reaches the page: it walks
 * the same list and asserts each string is actually on screen, so the two
 * cannot drift apart into a screen showing phrases nobody checked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
import { DEFAULT_SETTINGS, LANGUAGES, type Settings } from '../../domain/settings';
import type { DatabaseDiagnostics } from '../../database/worker/protocol';
import { PhrasebookScreen } from './PhrasebookScreen';
import {
  LANGUAGE_ENDONYM,
  PHRASEBOOK_CHROME,
  PHRASEBOOK_ENTRIES,
  PHRASEBOOK_NOTES,
} from './phrases';

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

/** The provider the application itself uses, over a database made for this test. */
function view(overrides: Partial<Settings> = {}) {
  const startup: AppContext = {
    db,
    repositories: {
      items: createItemsRepository(db),
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

  return render(
    <AppProvider startup={startup}>
      <PhrasebookScreen />
    </AppProvider>,
  );
}

/** Every language heading on the page, in the order the page renders them. */
const languageHeadings = (): readonly string[] =>
  screen
    .getAllByText(
      new RegExp(`^(${LANGUAGES.map((language) => LANGUAGE_ENDONYM[language]).join('|')})$`),
    )
    .map((element) => element.textContent);

beforeEach(async () => {
  db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
});

afterEach(async () => {
  cleanup();
  await db.close().catch(() => undefined);
});

describe('PhrasebookScreen', () => {
  it('is a page of the application, titled in the chosen language', () => {
    view({ language: 'pt-BR' });

    expect(screen.getByRole('heading', { level: 1, name: 'Guia de frases' })).toBeTruthy();
    expect(screen.getByText(PHRASEBOOK_CHROME.subtitle['pt-BR'])).toBeTruthy();
  });

  /**
   * Asking and changing are different in a way that matters: one is answered
   * and forgotten, the other reaches the database. Both headings, and both
   * explanations of what happens, are on the page.
   */
  it('keeps asking and changing apart, and says how they differ', () => {
    view();

    expect(screen.getByRole('heading', { name: 'Asking' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Changing' })).toBeTruthy();
    expect(screen.getByText(PHRASEBOOK_CHROME.askingHint.en)).toBeTruthy();
    expect(screen.getByText(PHRASEBOOK_CHROME.changingHint.en)).toBeTruthy();

    const sections = new Set(PHRASEBOOK_ENTRIES.map((entry) => entry.section));
    expect(sections.size).toBe(2);
  });

  it('shows every phrase the parser test checked, in all three languages', () => {
    view();

    for (const entry of PHRASEBOOK_ENTRIES) {
      for (const language of LANGUAGES) {
        for (const phrase of entry.phrases[language]) {
          expect(
            screen.getAllByText(phrase.text).length,
            `${language}: ${phrase.text}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('shows the notes about numbers and dates, with their examples', () => {
    view();

    for (const note of PHRASEBOOK_NOTES) {
      expect(screen.getByRole('heading', { name: note.title.en })).toBeTruthy();
      expect(screen.getByText(note.body.en)).toBeTruthy();
      for (const language of LANGUAGES) {
        for (const example of note.examples[language]) {
          expect(screen.getAllByText(example).length).toBeGreaterThan(0);
        }
      }
    }
  });

  /**
   * The narrow-screen decision, asserted.
   *
   * Below 60rem the three columns become one stack, which is only readable if
   * two things hold: every block names its own language rather than relying on
   * the column it sits in, and the reader's own language is the block on top.
   * Both are structural, so both can be checked with the stylesheet absent.
   */
  describe('stacked on a narrow screen', () => {
    it('names the language of every block, for all of them', () => {
      view();

      const blocks = PHRASEBOOK_ENTRIES.length + PHRASEBOOK_NOTES.length;
      expect(languageHeadings().length).toBe(blocks * LANGUAGES.length);
    });

    for (const language of LANGUAGES) {
      it(`puts ${language} on top of every block when it is the interface language`, () => {
        view({ language });

        const headings = languageHeadings();
        const leaders = headings.filter((_, index) => index % LANGUAGES.length === 0);
        expect(new Set(leaders)).toEqual(new Set([LANGUAGE_ENDONYM[language]]));
      });
    }

    it('still shows the other two languages under it', () => {
      view({ language: 'es' });

      expect(new Set(languageHeadings())).toEqual(
        new Set(LANGUAGES.map((language) => LANGUAGE_ENDONYM[language])),
      );
      expect(screen.getAllByText('Sobrou arroz?').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Any rice left?').length).toBeGreaterThan(0);
      expect(screen.getAllByText('¿Queda arroz?').length).toBeGreaterThan(0);
    });
  });
});
