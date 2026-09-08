/**
 * The state machine behind the ask sheet, and the switch between two engines.
 *
 *   idle → thinking → (an answer from this device | an answer from Claude)
 *
 * A hook rather than state inside the sheet, because the transitions are the
 * part worth testing and a component that renders them is not.
 *
 * TWO ENGINES, ONE BOX. A question goes to Claude when the assistant is
 * switched on AND a key is stored; otherwise it goes to the twelve parser
 * rules, offline and free, exactly as it always has. `failed` from Claude -
 * no network, a refused key, a rate limit - falls back to the parser rather
 * than dead-ending, because an application that answers is worth more than one
 * that explains why it did not. The exchange records which engine answered and
 * the sheet says so, because the difference matters: one is exact, offline and
 * free, and the other is capable and costs money per question.
 *
 * AND ONE THING THAT IS NEITHER ENGINE. An exchange also records whether the
 * words reaching it were transcribed on the phone or over the network, because
 * the microphone tries the device first and falls back once when it cannot. The
 * sheet marks that beside the engine marker, for the same reason: a person is
 * owed the ability to see which of their presses left the device.
 *
 * WHAT NEITHER ENGINE MAY DO IS WRITE UNASKED. A proposal from Claude is
 * always `assumed` and always goes to a confirmation card, whatever its
 * certainty field says - see `commitProposal`, and the test that pins it. The
 * parser's own narrow case, an item named exactly and a number actually
 * spoken, is unchanged: it is stored at once and offered back for ten seconds.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { parse } from '../../voice/parse';
import { grammarFor } from '../../voice/grammar/registry';
import { execute, type Outcome, type PendingWrite, type VoiceDeps } from '../../services/voice/execute';
import { commit, undo, type Receipt } from '../../services/voice/commit';
import { renderAnswer, type AnswerOptions } from '../../services/voice/answer';
import { converse, type AiFailureReason, type AiOptions } from '../../services/ai/converse';
import type { AiDeps } from '../../services/ai/tools';
import { LOCALE_TAGS } from '../../i18n/translate';
import type { Intent } from '../../voice/intents';
import type { InventoryItemView } from '../../types/domain';

/** Which of the two answered, or would answer next. */
export type Engine = 'claude' | 'device';

/**
 * One change Claude asked for and did not get.
 *
 * `done` is null while the card is on screen and becomes the sentence stating
 * what the item now holds once the user has confirmed it. Kept in the log
 * rather than dropped, so a sheet with three proposals shows which of them
 * were accepted instead of quietly shrinking.
 */
export interface Proposal {
  readonly write: PendingWrite;
  readonly done: string | null;
}

/**
 * What is true of every exchange, whichever engine answered it.
 *
 * `transcribedOnline` is a fact about how the words were captured rather than
 * about how they were answered, which is why it sits beside `said` and not
 * inside either arm: a spoken question and the sentence that comes back from it
 * are one exchange.
 */
interface HeardExchange {
  readonly said: string;
  /**
   * The words came from the network rather than from this phone.
   *
   * True only when the microphone's on-device attempt failed and the retry
   * transcribed it instead. False for everything typed, and false for every
   * listen the phone answered itself, which is most of them. The sheet marks
   * it, because audio must never leave without the person being able to see
   * that it did.
   */
  readonly transcribedOnline: boolean;
}

/** An exchange the twelve rules on this device answered. */
export interface DeviceExchange extends HeardExchange {
  readonly engine: 'device';
  readonly outcome: Outcome;
  /** The sentence that was said, or null for an outcome that is not one. */
  readonly text: string | null;
  /**
   * The way back from a write that was stored without being asked about, for
   * as long as the offer stands. Null on every exchange that wrote nothing, on
   * a write the user confirmed, and once the offer has lapsed or been taken.
   */
  readonly receipt: Receipt | null;
  /** True once Undo was pressed, so the exchange states the reversal. */
  readonly undone: boolean;
  /**
   * Why Claude did not answer this one, when Claude was asked first.
   *
   * Null on a question that never went anywhere. A silent fallback would mean
   * a key typed with one character wrong never gets noticed: the assistant
   * would simply never seem to be on.
   */
  readonly aiFailure: AiFailureReason | null;
}

/** An exchange Claude answered. */
export interface ClaudeExchange extends HeardExchange {
  readonly engine: 'claude';
  readonly text: string;
  readonly proposals: readonly Proposal[];
  /**
   * The loop hit its request cap with Claude still asking for tools.
   *
   * The proposals gathered so far are shown anyway. They were built, they cost
   * nothing to display, and discarding them would throw away work the user can
   * still say yes to - so the sheet shows them and says the question needed
   * too many steps.
   */
  readonly exhausted: boolean;
}

/** One thing asked and what came of it. */
export type Exchange = DeviceExchange | ClaudeExchange;

/** Reads a sentence aloud. Supplied by the sheet, which composes the platform. */
export type Speak = (text: string, tag: string) => Promise<void>;

export interface Voice {
  readonly history: readonly Exchange[];
  readonly busy: boolean;
  /** Set when a query or a write threw, so the failure is visible rather than silent. */
  readonly error: string | null;
  readonly examples: readonly string[];
  /** Where the next question would go. The sheet says so before it is asked. */
  readonly engine: Engine;
  /**
   * One question. `transcribedOnline` is the microphone saying the words were
   * captured over the network; a typed question leaves it out and is false.
   */
  readonly run: (question: string, transcribedOnline?: boolean) => Promise<void>;
  readonly confirm: (index: number) => Promise<void>;
  /** Confirms one of Claude's proposals. Nothing has been written before this. */
  readonly confirmProposal: (index: number, proposal: number) => Promise<void>;
  readonly discardProposal: (index: number, proposal: number) => void;
  /** Puts back a write that was stored without asking. */
  readonly takeBack: (index: number) => Promise<void>;
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
    case 'QUERY_HISTORY':
      return { ...intent, item: name };
    case 'MOVE_ITEM':
      return { ...intent, item: name };
    case 'SET_MINIMUM':
      return { ...intent, item: name };
    case 'SET_TARGET':
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

  switch (write.kind) {
    case 'EXPIRY':
      return { kind: 'QUERY_EXPIRY_OF', item: name };
    // A move changed where the thing is, so the sentence that confirms it has
    // to be about where the thing is. Reading back its quantity would state a
    // number nobody touched and leave the shelf unmentioned.
    case 'MOVE':
      return { kind: 'QUERY_WHERE', item: name, location: null };
    default:
      return { kind: 'QUERY_QUANTITY', item: name };
  }
}

/**
 * How long Undo stays on screen after a write nobody was asked about.
 *
 * Long enough to hear the sentence and disagree with it, short enough that the
 * log does not become a column of stale buttons. It is an offer, not a history:
 * what was written stays written, and the inventory screen edits it as it edits
 * anything else.
 */
const UNDO_WINDOW_MS = 10_000;

export function useVoice(speak: Speak): Voice {
  const { repositories, itemContext, settings, t, invalidate } = useApp();
  const [history, setHistory] = useState<readonly Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every armed Undo window, so a sheet that goes away takes its timers with it.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  const grammar = useMemo(() => grammarFor(settings.language), [settings.language]);
  const tag = LOCALE_TAGS[settings.language];

  const deps = useMemo<VoiceDeps>(
    () => ({
      items: repositories.items,
      locations: repositories.locations,
      // Both read-only here. The categories turn a spoken "alimentos" into the
      // id the item query filters on, and the contacts answer a question with
      // no write path anywhere in this feature.
      categories: repositories.categories,
      contacts: repositories.contacts,
      context: itemContext,
      language: settings.language,
      trackedCategoryIds: settings.preparednessCategoryIds,
      // What the user took off the replenishment list, so a spoken or written
      // answer about what to buy agrees with the screen that offers the same
      // list. Both engines read it from here.
      dismissedItemIds: settings.replenishmentDismissed,
    }),
    [
      repositories.items,
      repositories.locations,
      repositories.categories,
      repositories.contacts,
      itemContext,
      settings.language,
      settings.preparednessCategoryIds,
      settings.replenishmentDismissed,
    ],
  );

  /**
   * The same dependencies plus the one only the tools need: the reference
   * catalog. The categories and the contacts moved into `VoiceDeps` when the
   * parser learned to ask a category what it holds and a contact for its phone
   * number, so both engines now read them from the same place - and the
   * contacts repository comes from start-up rather than being built here,
   * because it is no longer for one caller.
   */
  const aiDeps = useMemo<AiDeps>(
    () => ({ ...deps, catalog: repositories.catalog }),
    [deps, repositories.catalog],
  );

  const aiOptions = useMemo<AiOptions>(
    () => ({ apiKey: settings.anthropicApiKey, model: settings.aiModel }),
    [settings.anthropicApiKey, settings.aiModel],
  );

  /**
   * Where a question goes, decided from settings and nothing else.
   *
   * Both halves are required. The switch alone would send a question nowhere;
   * a key alone would start spending money for somebody who never asked for
   * the assistant.
   */
  const engine: Engine =
    settings.aiEnabled && settings.anthropicApiKey.trim() !== '' ? 'claude' : 'device';

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
   * Where a result lands - appended for something newly asked, or over the top
   * of the exchange that raised the question.
   */
  const place = useCallback((entry: Exchange, index: number | null) => {
    setHistory((past) =>
      index === null
        ? [...past, entry]
        : past.map((existing, i) => (i === index ? entry : existing)),
    );
  }, []);

  /**
   * Offers Undo for a while, and then stops.
   *
   * The timer finds its exchange by receipt identity rather than by index,
   * because `dismiss` can remove an earlier exchange while it is running and
   * every index after that one moves.
   */
  const armUndo = useCallback((receipt: Receipt) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setHistory((past) =>
        past.map((entry) =>
          entry.engine === 'device' && entry.receipt === receipt
            ? { ...entry, receipt: null }
            : entry,
        ),
      );
    }, UNDO_WINDOW_MS);
    timers.current.add(timer);
  }, []);

  /**
   * A write, stored, and the sentence saying what the item now holds.
   *
   * That sentence is read back out of the database rather than assembled from
   * the request, so what the user hears is a statement about what is stored -
   * the only thing worth saying to someone who is not looking at the screen.
   *
   * `undoable` is false for a write the user confirmed on the card. They were
   * shown the change and pressed the button; offering to take it back after
   * that is asking the same question twice.
   */
  const store = useCallback(
    async (
      said: string,
      write: PendingWrite,
      index: number | null,
      undoable: boolean,
      transcribedOnline: boolean,
    ) => {
      const { receipt } = await commit(deps, write);
      // Every open list re-reads; the database stays the only source of truth.
      invalidate();

      const outcome = await execute(deps, receiptIntent(write));
      const text = sentence(outcome);

      // Nothing to say means nothing was found to say it about, which is not a
      // receipt. A confirmed write drops the exchange rather than leaving one
      // that states nothing; an undoable one keeps it, because its button is
      // the whole point of it.
      if (text === null && !undoable) {
        setHistory((past) => (index === null ? past : past.filter((_, i) => i !== index)));
        return;
      }

      place(
        {
          engine: 'device',
          said,
          transcribedOnline,
          outcome,
          text,
          receipt: undoable ? receipt : null,
          undone: false,
          aiFailure: null,
        },
        index,
      );
      if (undoable) armUndo(receipt);
      if (text !== null) await speak(text, tag);
    },
    [armUndo, deps, invalidate, place, sentence, speak, tag],
  );

  /**
   * One parser turn: execute, record, speak - and, where nothing was guessed,
   * write.
   *
   * An explicit write is one the user said in full: an item named exactly, and
   * a number actually given. Asking someone to confirm the sentence they have
   * just typed clearly is what made this tiring on a real phone, so it is
   * stored at once, stated as a fact, and offered back for a few seconds.
   * Everything else was guessed at somewhere and goes to the card.
   */
  const turn = useCallback(
    async (
      said: string,
      intent: Intent,
      index: number | null,
      aiFailure: AiFailureReason | null,
      transcribedOnline: boolean,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const outcome = withExamples(await execute(deps, intent));

        if (outcome.kind === 'pending' && outcome.write.certainty === 'explicit') {
          await store(said, outcome.write, index, true, transcribedOnline);
          return;
        }

        const text = sentence(outcome);
        place(
          {
            engine: 'device',
            said,
            transcribedOnline,
            outcome,
            text,
            receipt: null,
            undone: false,
            aiFailure,
          },
          index,
        );
        // A card is not a fact, and `sentence` returns null for one. The card
        // announces itself by moving focus to a button that carries the whole
        // change; speaking it here would say a change happened that has not.
        if (text !== null) await speak(text, tag);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [deps, place, sentence, speak, store, tag, withExamples],
  );

  const askParser = useCallback(
    async (question: string, aiFailure: AiFailureReason | null, transcribedOnline: boolean) => {
      await turn(
        question,
        parse(grammar, question, { today: itemContext.today }),
        null,
        aiFailure,
        transcribedOnline,
      );
    },
    [grammar, itemContext.today, turn],
  );

  /**
   * One question, put to Claude.
   *
   * `converse` does not throw - every failure comes back classified - but the
   * catch stays, because a repository that throws inside a tool would surface
   * here and a sheet that swallows it would look like an assistant that simply
   * stopped answering.
   */
  const askClaude = useCallback(
    async (question: string, transcribedOnline: boolean) => {
      setBusy(true);
      setError(null);

      try {
        const result = await converse(aiDeps, aiOptions, question);

        // The whole point of keeping the parser: no key, no network, a refused
        // key or too many questions all still get an answer from the twelve
        // rules, which need none of those things.
        if (result.kind === 'failed') {
          await askParser(question, result.reason, transcribedOnline);
          return;
        }

        if (result.kind === 'refused') {
          place(
            {
              engine: 'claude',
              said: question,
              transcribedOnline,
              text: t('ai.refused'),
              proposals: [],
              exhausted: false,
            },
            null,
          );
          return;
        }

        const proposals = result.proposals.map((write) => ({ write, done: null }));
        const text =
          result.kind === 'exhausted'
            ? t('ai.tooManySteps', { tries: result.requests })
            : result.text;

        place(
          {
            engine: 'claude',
            said: question,
            transcribedOnline,
            text,
            proposals,
            exhausted: result.kind === 'exhausted',
          },
          null,
        );

        // Read aloud like any other answer. Nothing here has been written, and
        // the cards below say so, so this states what was found rather than
        // what was done.
        if (text !== '') await speak(text, tag);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [aiDeps, aiOptions, askParser, place, speak, t, tag],
  );

  const run = useCallback(
    async (question: string, transcribedOnline = false) => {
      if (engine === 'claude') await askClaude(question, transcribedOnline);
      else await askParser(question, null, transcribedOnline);
    },
    [askClaude, askParser, engine],
  );

  /** The confirmation card's button: the write the user was asked about. */
  const confirm = useCallback(
    async (index: number) => {
      const entry = history[index];
      if (entry === undefined || entry.engine !== 'device') return;
      if (entry.outcome.kind !== 'pending') return;
      const write = entry.outcome.write;

      setBusy(true);
      setError(null);
      try {
        await store(entry.said, write, index, false, entry.transcribedOnline);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [history, store],
  );

  /**
   * The confirmation card under one of Claude's proposals.
   *
   * The only path from a model's sentence to the database, and it runs the
   * same `commit` the parser's card runs, so the receipt, the history row and
   * undo are all the existing ones. Nothing about the write is trusted here:
   * `certainty` is not read at all, because the branch that stores an explicit
   * write without asking must not be reachable from anything a model produced.
   */
  const confirmProposal = useCallback(
    async (index: number, proposal: number) => {
      const entry = history[index];
      if (entry === undefined || entry.engine !== 'claude') return;
      const target = entry.proposals[proposal];
      if (target === undefined || target.done !== null) return;

      setBusy(true);
      setError(null);
      try {
        await commit(deps, target.write);
        invalidate();

        // Read back out of the database rather than assembled from the write,
        // so the line under the card is a statement about what is stored.
        const outcome = await execute(deps, receiptIntent(target.write));
        const said = sentence(outcome) ?? '';

        setHistory((past) =>
          past.map((existing, i) =>
            i !== index || existing.engine !== 'claude'
              ? existing
              : {
                  ...existing,
                  proposals: existing.proposals.map((each, j) =>
                    j === proposal ? { ...each, done: said } : each,
                  ),
                },
          ),
        );
        if (said !== '') await speak(said, tag);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [deps, history, invalidate, sentence, speak, tag],
  );

  /** Says no to one proposal. Nothing was written, so nothing is undone. */
  const discardProposal = useCallback((index: number, proposal: number) => {
    setHistory((past) =>
      past.map((existing, i) =>
        i !== index || existing.engine !== 'claude'
          ? existing
          : { ...existing, proposals: existing.proposals.filter((_, j) => j !== proposal) },
      ),
    );
  }, []);

  /**
   * The Undo button under a write nobody was asked about.
   *
   * The exchange is rewritten rather than removed. Someone who pressed Undo has
   * to see that it happened, and a log still reading "Beans: 17 cans" after the
   * beans went back to twelve is a lie the interface tells about the database.
   */
  const takeBack = useCallback(
    async (index: number) => {
      const entry = history[index];
      if (entry === undefined || entry.engine !== 'device' || entry.receipt === null) return;
      const { receipt } = entry;

      setBusy(true);
      setError(null);
      try {
        await undo(deps, receipt);
        invalidate();

        const text = t('voice.undone');
        setHistory((past) =>
          past.map((existing, i) =>
            i === index && existing.engine === 'device'
              ? { ...existing, text, receipt: null, undone: true }
              : existing,
          ),
        );
        await speak(text, tag);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [deps, history, invalidate, speak, t, tag],
  );

  /** Picking from "Which one?" re-runs the intent against an exact name. */
  const choose = useCallback(
    async (index: number, item: InventoryItemView) => {
      const entry = history[index];
      if (entry === undefined || entry.engine !== 'device') return;
      if (entry.outcome.kind !== 'choice') return;
      const intent = aimedAt(entry.outcome.intent, item.name);
      if (intent === null) return;
      await turn(entry.said, intent, index, entry.aiFailure, entry.transcribedOnline);
    },
    [history, turn],
  );

  /** The Create button under "I did not find X". */
  const create = useCallback(
    async (index: number) => {
      const entry = history[index];
      if (entry === undefined || entry.engine !== 'device') return;
      if (entry.outcome.kind !== 'notFound') return;
      const intent = creationFrom(entry.outcome.intent);
      if (intent === null) return;
      await turn(entry.said, intent, index, entry.aiFailure, entry.transcribedOnline);
    },
    [history, turn],
  );

  const dismiss = useCallback((index: number) => {
    setHistory((past) => past.filter((_, i) => i !== index));
  }, []);

  return {
    history,
    busy,
    error,
    examples: grammar.examples,
    engine,
    run,
    confirm,
    confirmProposal,
    discardProposal,
    takeBack,
    choose,
    create,
    dismiss,
  };
}
