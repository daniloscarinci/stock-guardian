/**
 * The property the phrasebook screen is worth having at all.
 *
 * Every string the screen displays is put through the real grammar for the
 * language it is displayed under, and must produce the intent it is displayed
 * as. Not "not UNKNOWN": the kind, and every slot the entry troubled to claim.
 * A reference that lists a command the application does not understand is worse
 * than no reference, and this is what stops that happening quietly - tighten a
 * rule, and the phrase that stops working fails here rather than in somebody's
 * kitchen.
 *
 * The strings are parsed exactly as written, accents, capitals, question marks
 * and "¿" included. `parse` folds all of that away before a rule sees it, and
 * this file is where that claim is checked rather than assumed.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../../voice/parse';
import { grammarFor } from '../../voice/grammar/registry';
import { LANGUAGES, type Language } from '../../domain/settings';
import { isValidCalendarDate } from '../../domain/dates';
import type { Intent } from '../../voice/intents';
import {
  LANGUAGE_ENDONYM,
  PHRASEBOOK_CHROME,
  PHRASEBOOK_ENTRIES,
  PHRASEBOOK_NOTES,
  phrasebookLanguages,
  type Trilingual,
} from './phrases';

/** Fixed, so "dia 12" and "em março" mean the same thing every day. */
const CTX = { today: '2026-09-07' };

const say = (language: Language, text: string): Intent =>
  parse(grammarFor(language), text, CTX);

describe('every phrase on the screen resolves to the intent it claims', () => {
  for (const entry of PHRASEBOOK_ENTRIES) {
    for (const language of LANGUAGES) {
      for (const phrase of entry.phrases[language]) {
        it(`${language}: "${phrase.text}" is ${phrase.expect.kind}`, () => {
          const intent = say(language, phrase.text);
          expect(intent.kind).toBe(phrase.expect.kind);
          expect(intent).toMatchObject(phrase.expect);
        });
      }
    }
  }
});

/**
 * The dates the expiry phrases produce are left out of the entries themselves,
 * because they move with the day the phrase is said. They are still worth
 * pinning: a rule that matched but built a nonsense day would pass every
 * assertion above.
 */
describe('the expiry phrases produce a real day', () => {
  for (const entry of PHRASEBOOK_ENTRIES) {
    for (const language of LANGUAGES) {
      for (const phrase of entry.phrases[language]) {
        if (phrase.expect.kind !== 'SET_EXPIRY') continue;
        it(`${language}: "${phrase.text}" lands on a date`, () => {
          const intent = say(language, phrase.text);
          if (intent.kind !== 'SET_EXPIRY') throw new Error(`got ${intent.kind}`);
          expect(isValidCalendarDate(intent.expiresOn)).toBe(true);
          expect(intent.expiresOn >= CTX.today).toBe(true);
        });
      }
    }
  }
});

describe('the notes are checked the same way the phrases are', () => {
  for (const note of PHRASEBOOK_NOTES) {
    for (const language of LANGUAGES) {
      for (const example of note.examples[language]) {
        const sentence = note.probe[language].replace('{}', example);
        it(`${language}: "${example}" is read in "${sentence}"`, () => {
          expect(say(language, sentence).kind).toBe(note.probeKind);
        });
      }
    }
  }

  /**
   * The dates note makes a claim of its own - a month with no day means the
   * last day of it - so the claim is asserted rather than described. March is
   * behind September, so the year rolls forward too.
   */
  const bareMonth: ReadonlyArray<readonly [Language, string]> = [
    ['pt-BR', 'O leite vence em março'],
    ['en', 'The milk expires in march'],
    ['es', 'La leche vence en marzo'],
  ];
  for (const [language, sentence] of bareMonth) {
    it(`${language}: a bare month means its last day`, () => {
      expect(say(language, sentence)).toMatchObject({
        kind: 'SET_EXPIRY',
        expiresOn: '2027-03-31',
        dateAssumed: true,
      });
    });
  }

  it('every number example is read as a number rather than as part of the item', () => {
    const note = PHRASEBOOK_NOTES.find((entry) => entry.id === 'numbers');
    expect(note).toBeDefined();
    if (note === undefined) return;

    for (const language of LANGUAGES) {
      for (const example of note.examples[language]) {
        const intent = say(language, note.probe[language].replace('{}', example));
        if (intent.kind !== 'ADJUST_QUANTITY') throw new Error(`${example}: ${intent.kind}`);
        expect(intent.amount).toBeGreaterThan(0);
        expect(intent.amountAssumed).toBe(false);
      }
    }
  });
});

describe('the phrasebook is whole', () => {
  it('carries both halves of what the application can be told', () => {
    const sections = new Set(PHRASEBOOK_ENTRIES.map((entry) => entry.section));
    expect(sections).toEqual(new Set(['asking', 'changing']));
  });

  it('says everything in all three languages', () => {
    for (const entry of PHRASEBOOK_ENTRIES) {
      for (const language of LANGUAGES) {
        expect(entry.phrases[language].length).toBeGreaterThan(0);
        expect(entry.label[language].length).toBeGreaterThan(0);
      }
    }
    for (const note of PHRASEBOOK_NOTES) {
      for (const language of LANGUAGES) {
        expect(note.examples[language].length).toBeGreaterThan(0);
        expect(note.body[language].length).toBeGreaterThan(0);
      }
    }
    const chrome: readonly Trilingual[] = [
      PHRASEBOOK_CHROME.title,
      PHRASEBOOK_CHROME.subtitle,
      PHRASEBOOK_CHROME.asking,
      PHRASEBOOK_CHROME.askingHint,
      PHRASEBOOK_CHROME.changing,
      PHRASEBOOK_CHROME.changingHint,
    ];
    for (const text of chrome) {
      for (const language of LANGUAGES) {
        expect(text[language].length).toBeGreaterThan(0);
      }
    }
    for (const language of LANGUAGES) {
      expect(LANGUAGE_ENDONYM[language].length).toBeGreaterThan(0);
    }
  });

  it('has no two entries under the same id', () => {
    const ids = PHRASEBOOK_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * The narrow-screen decision, stated as a property.
 *
 * Below 60rem the three columns become one stack, so the order they are
 * rendered in is the order they are read in. The reader's own language must
 * come first, and all three must still be there.
 */
describe('the reader’s own language leads', () => {
  for (const language of LANGUAGES) {
    it(`${language} first, then the other two`, () => {
      const order = phrasebookLanguages(language);
      expect(order[0]).toBe(language);
      expect(new Set(order)).toEqual(new Set(LANGUAGES));
      expect(order.length).toBe(LANGUAGES.length);
    });
  }

  it('keeps the same order behind the leader every time', () => {
    expect(phrasebookLanguages('en')).toEqual(['en', 'pt-BR', 'es']);
    expect(phrasebookLanguages('es')).toEqual(['es', 'pt-BR', 'en']);
    expect(phrasebookLanguages('pt-BR')).toEqual(['pt-BR', 'en', 'es']);
  });
});
