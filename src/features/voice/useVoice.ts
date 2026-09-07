/**
 * The voice state machine.
 *
 *   idle → listening → thinking → (answer | pending | choice | notFound | unknown)
 *
 * A hook rather than state inside the sheet, because the transitions are the
 * part worth testing and a component that renders them is not.
 *
 * Two things happen here that cannot happen in the layers below:
 *
 *   The grammar's examples are filled in. `execute` deliberately owns no
 *   grammar, so it returns HELP and UNKNOWN with an empty example list and
 *   leaves the caller - the only place that knows the user's language - to
 *   supply them.
 *
 *   `invalidate()` is called after a write, so every open list re-reads. The
 *   database is the single source of truth in this application and nothing
 *   caches a value that also lives in a table.
 */
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { parse } from '../../voice/parse';
import { grammarFor } from '../../voice/grammar/registry';
import { execute, type Outcome, type PendingWrite, type VoiceDeps } from '../../services/voice/execute';
import { commit } from '../../services/voice/commit';
import { renderAnswer, type AnswerOptions } from '../../services/voice/answer';
import { LOCALE_TAGS } from '../../i18n/translate';
import type { Intent } from '../../voice/intents';
import type { InventoryItemView } from '../../types/domain';

/** One thing said and what came of it. */
export interface Exchange {
  readonly said: string;
  readonly outcome: Outcome;
  /** The sentence that was spoken, or null for an outcome that is not one. */
  readonly text: string | null;
}

/** Reads a sentence aloud. Supplied by the sheet, which composes the platform. */
export type Speak = (text: string, tag: string) => Promise<void>;

export interface Voice {
  readonly history: readonly Exchange[];
  readonly busy: boolean;
  /** Set when a query or a write threw, so the failure is visible rather than silent. */
  readonly error: string | null;
  readonly examples: readonly string[];
  readonly run: (transcript: string) => Promise<void>;
  readonly confirm: (index: number) => Promise<void>;
  readonly choose: (index: number, item: InventoryItemView) => Promise<void>;
  readonly create: (index: number) => Promise<void>;
  readonly dismiss: (index: number) => void;
}

/**
 * The same intent, aimed at one exact name.
 *
 * Written as a switch rather than a spread over `Intent`, so the compiler
 * checks each member individually and a new intent with an `item` slot has to
 * be listed here on purpose. CREATE_ITEM is absent because it never raises a
 * choice: its phrase names a new thing, and only its location can fail to
 * resolve.
 */
function aimedAt(intent: Intent, name: string): Intent | null {
  switch (intent.kind) {
    case 'QUERY_QUANTITY':
      return { ...intent, item: name };
    case 'QUERY_EXPIRY_OF':
      return { ...intent, item: name };
    case 'QUERY_WHERE':
      return { ...intent, item: name, location: null };
    case 'ADJUST_QUANTITY':
      return { ...intent, item: name };
    case 'SET_QUANTITY':
      return { ...intent, item: name };
    case 'SET_EXPIRY':
      return { ...intent, item: name };
    default:
      return null;
  }
}

/**
 * The intent that would create what a writing intent could not find.
 *
 * "add five cans of beans" against an empty pantry is not a mistake, it is the
 * first can of beans. The amount survives only where it describes stock the
 * user now has: a removal from nothing creates the item, not a negative one.
 */
function creationFrom(intent: Intent): Intent | null {
  switch (intent.kind) {
    case 'ADJUST_QUANTITY':
      return {
        kind: 'CREATE_ITEM',
        name: intent.item,
        amount: intent.direction === 'up' ? intent.amount : null,
        unit: intent.unit,
        location: null,
        expiresOn: null,
      };
    case 'SET_QUANTITY':
      return {
        kind: 'CREATE_ITEM',
        name: intent.item,
        amount: intent.amount,
        unit: intent.unit,
        location: null,
        expiresOn: null,
      };
    case 'SET_EXPIRY':
      return {
        kind: 'CREATE_ITEM',
        name: intent.item,
        amount: null,
        unit: null,
        location: null,
        expiresOn: intent.expiresOn,
      };
    // The item was fine; the shelf was not. Create it unplaced rather than
    // refusing twice over the same unknown location.
    case 'CREATE_ITEM':
      return { ...intent, location: null };
    default:
      return null;
  }
}

/** What to ask the database once a write has landed, so the receipt is a fact. */
function receiptIntent(write: PendingWrite): Intent {
  const name = write.kind === 'CREATE' ? write.name : write.item.name;
  return write.kind === 'EXPIRY'
    ? { kind: 'QUERY_EXPIRY_OF', item: name }
    : { kind: 'QUERY_QUANTITY', item: name };
}

export function useVoice(speak: Speak): Voice {
  const { repositories, itemContext, settings, t, invalidate } = useApp();
  const [history, setHistory] = useState<readonly Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grammar = useMemo(() => grammarFor(settings.language), [settings.language]);
  const tag = LOCALE_TAGS[settings.language];

  const deps = useMemo<VoiceDeps>(
    () => ({
      items: repositories.items,
      locations: repositories.locations,
      context: itemContext,
      language: settings.language,
    }),
    [repositories.items, repositories.locations, itemContext, settings.language],
  );

  const options = useMemo<AnswerOptions>(
    () => ({ language: settings.language, dateFormat: settings.dateFormat }),
    [settings.language, settings.dateFormat],
  );

  /** `execute` returns HELP and UNKNOWN empty-handed; the grammar lives here. */
  const withExamples = useCallback(
    (outcome: Outcome): Outcome => {
      if (outcome.kind === 'unknown') return { ...outcome, examples: grammar.examples };
      if (outcome.kind === 'answer' && outcome.answer.kind === 'HELP') {
        return { kind: 'answer', answer: { kind: 'HELP', examples: grammar.examples } };
      }
      return outcome;
    },
    [grammar.examples],
  );

  const sentence = useCallback(
    (outcome: Outcome): string | null =>
      outcome.kind === 'answer' ? renderAnswer(t, outcome.answer, options) : null,
    [t, options],
  );

  /**
   * One turn: execute, record, speak.
   *
   * `place` decides where the result lands - appended for something newly said,
   * or over the top of the exchange that raised the question.
   */
  const turn = useCallback(
    async (said: string, intent: Intent, index: number | null) => {
      setBusy(true);
      setError(null);
      try {
        const outcome = withExamples(await execute(deps, intent));
        const text = sentence(outcome);
        const entry: Exchange = { said, outcome, text };
        setHistory((past) =>
          index === null
            ? [...past, entry]
            : past.map((existing, i) => (i === index ? entry : existing)),
        );
        if (text !== null) await speak(text, tag);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [deps, sentence, speak, tag, withExamples],
  );

  const run = useCallback(
    async (transcript: string) => {
      await turn(transcript, parse(grammar, transcript, { today: itemContext.today }), null);
    },
    [grammar, itemContext.today, turn],
  );

  /**
   * The confirmation card's button, and the only path in this feature that writes.
   *
   * The receipt is read back out of the database rather than assembled from the
   * request. What the user hears is then a statement about what is stored, which
   * is the only thing worth saying to someone who is not looking at the screen.
   */
  const confirm = useCallback(
    async (index: number) => {
      const entry = history[index];
      if (entry === undefined || entry.outcome.kind !== 'pending') return;
      const write = entry.outcome.write;

      setBusy(true);
      setError(null);
      try {
        await commit(deps, write);
        // Every open list re-reads; the database stays the only source of truth.
        invalidate();

        const outcome = await execute(deps, receiptIntent(write));
        const text = sentence(outcome);
        setHistory((past) =>
          text === null
            ? past.filter((_, i) => i !== index)
            : past.map((existing, i) => (i === index ? { ...existing, outcome, text } : existing)),
        );
        if (text !== null) await speak(text, tag);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [deps, history, invalidate, sentence, speak, tag],
  );

  /** Picking from "Which one?" re-runs the intent against an exact name. */
  const choose = useCallback(
    async (index: number, item: InventoryItemView) => {
      const entry = history[index];
      if (entry === undefined || entry.outcome.kind !== 'choice') return;
      const intent = aimedAt(entry.outcome.intent, item.name);
      if (intent === null) return;
      await turn(entry.said, intent, index);
    },
    [history, turn],
  );

  /** The Create button under "I did not find X". */
  const create = useCallback(
    async (index: number) => {
      const entry = history[index];
      if (entry === undefined || entry.outcome.kind !== 'notFound') return;
      const intent = creationFrom(entry.outcome.intent);
      if (intent === null) return;
      await turn(entry.said, intent, index);
    },
    [history, turn],
  );

  const dismiss = useCallback((index: number) => {
    setHistory((past) => past.filter((_, i) => i !== index));
  }, []);

  return { history, busy, error, examples: grammar.examples, run, confirm, choose, create, dismiss };
}
