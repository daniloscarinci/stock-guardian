/**
 * The state machine behind the ask sheet, and the switch between two engines.
 *
 *   idle → thinking → (an answer from this device | an answer from Claude)
 *
 * A hook rather than state inside the sheet, because the transitions are the
 * part worth testing and a component that renders them is not.
 *
 * TWO ENGINES, ONE BOX. A question goes to Claude when the assistant is
 * switched on AND a key is stored; otherwise it goes to the parser's own
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
 * AND THE CONVERSATION LOOP LIVES HERE, WHICH IS THE NEWEST THING IN THIS FILE.
 * `Settings → Ask → Keep listening after each answer` turns one press into a
 * conversation: question, spoken answer, listening, next sentence, ending when
 * somebody stops talking. It is here rather than in the sheet or in the button
 * because it has to know what the turn it just ran produced, and the only place
 * that fact exists in time is the value `run` hands back - `history` is state,
 * and the closure awaiting a turn holds the array from before the turn ran. See
 * `converse` below for every way it stops, and `TurnResult` for what a turn is
 * allowed to say about itself.
 *
 * IT ADDS NO WRITE PATH. Everything a conversation can commit, one press already
 * commits today: an item named exactly with a number actually spoken is stored
 * at once and offered back for ten seconds, and everything else goes to a card -
 * which stops the loop. The set of things reaching `commit` is unchanged.
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
import { converse as askAssistant, type AiFailureReason, type AiOptions } from '../../services/ai/converse';
import type { AiDeps } from '../../services/ai/tools';
import { LOCALE_TAGS } from '../../i18n/translate';
import { CREATABLE_INTENTS, type Intent } from '../../voice/intents';
import type { InventoryItemView } from '../../types/domain';
import type { SpeechOutcome } from '../../services/speech/speak';
import type { SpeechFailure } from '../../services/speech/recognizer';
import type { Microphone } from './useListen';

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

/** An exchange the rules on this device answered. */
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

/**
 * Reads a sentence aloud, and resolves when it has been heard.
 *
 * Supplied by the sheet, which composes the platform: the seam decides the
 * setting and the empty answer, the sheet decides everything the phone decides -
 * the switch on its side and the media volume - and the three outcomes come back
 * through here whichever of them decided.
 *
 * `spoken` IS THE ARMING GATE, AND IT IS THE WHOLE REASON THE TYPE EXISTS. A
 * conversation may not open a microphone until it knows the phone has stopped
 * talking: there is no echo cancellation here and nothing coordinates audio
 * focus, so a microphone opened while the phone is still reading an answer
 * records the answer. `spoken` is the only one of the three that says the
 * sentence was heard. `silent` says the device deliberately made no sound and
 * `unknown` says nobody can tell - and a loop that re-listened on either would
 * be listening for the answer to a question nobody heard.
 */
export type Speak = (text: string, tag: string) => Promise<SpeechOutcome>;

/**
 * What one turn left behind, for whatever has to decide what happens next.
 *
 * Three words rather than the `void` this used to be, because a conversation
 * cannot read them off `history`: that is React state, and the closure awaiting
 * a turn holds the array from before the turn ran. The value has to come back
 * from the call.
 *
 * It is deliberately this small. Everything the sheet needs in order to DRAW an
 * exchange is already in `history` and none of it is here; the only question
 * this answers is the one a loop has to ask - may the microphone open again, and
 * if not, what stopped it.
 */
export type TurnResult =
  /**
   * A sentence was read out, the platform reported the end of it, and nothing
   * on screen is waiting for a press. The only one of the three that re-arms.
   */
  | 'answered'
  /**
   * Something wants a finger: a confirmation card, a list of names to choose
   * between, or an offer to create what was not found.
   *
   * This is the stop condition that matters most, and it is about consent rather
   * than about tidiness. There is no spoken yes or no in this release, so
   * listening again while a card stands would let the next sentence be parsed as
   * though the question were not on the screen.
   */
  | 'waiting'
  /**
   * Nothing came of it that anybody heard: the turn threw, or it produced an
   * outcome that has no sentence, or the answer was silenced, or the platform
   * never said whether it was read out.
   */
  | 'unheard';

/**
 * How many utterances one press may become.
 *
 * TWELVE, AND THE NUMBER IS AN ARGUMENT RATHER THAN A ROUND FIGURE. The case
 * this feature exists for is a stock-take: ten boxes, ten sentences, which used
 * to be ten presses. Twelve covers that with two spare for the ones that come
 * back wrong, and it bounds the two costs a runaway loop has. Every turn is a
 * fresh bind of Android's recognition service - `Session.finish` destroys the
 * recognizer on every settle, deliberately, so that the microphone is released
 * on every path - and some devices are reported to degrade over a long run of
 * them. And where the assistant is answering, every turn is a paid request, so
 * a misheard air conditioner spends money twelve times and then stops.
 *
 * It counts every utterance including the press that started it, so a
 * conversation opens the microphone unasked at most eleven times.
 */
const MAX_CONVERSATION_TURNS = 12;

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
  readonly run: (question: string, transcribedOnline?: boolean) => Promise<TurnResult>;
  /**
   * True while a conversation is running, between turns as well as during them.
   *
   * The stop control renders from this rather than from the microphone being
   * open, because most of a conversation is spent NOT listening: the answer is
   * being read out, and that is exactly the window somebody would want out of.
   */
  readonly conversing: boolean;
  /**
   * One press of the microphone, and everything that follows from it.
   *
   * Listens, answers, and - where the setting asks for it and the turn allows
   * it - listens again. Resolves with the failure worth explaining, or null when
   * there is nothing to explain, which the sheet hands straight to `MicNotice`.
   */
  readonly converse: () => Promise<SpeechFailure | null>;
  /** The stop control: the listen in flight, and any turn that would follow it. */
  readonly endConversation: () => void;
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
 * choice: its phrase names a new thing, so there is nothing for it to be one
 * of.
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
 *
 * The location is dropped from every one of these because none of them carries
 * one - the rules that build them have no place slot at all. CREATE_ITEM does
 * carry one and used to be listed here, to turn its own refusal over an
 * unknown shelf into a creation with no shelf; it is gone because that refusal
 * is gone. `execute` proposes making the place instead, so a CREATE_ITEM never
 * reaches a notFound and there is nothing here for it to be rescued from.
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
    default:
      return null;
  }
}

/** What to ask the database once a write has landed, so the receipt is a fact. */
function receiptIntent(write: PendingWrite): Intent {
  switch (write.kind) {
    case 'EXPIRY':
      return { kind: 'QUERY_EXPIRY_OF', item: write.item.name };
    // A move changed where the thing is, so the sentence that confirms it has
    // to be about where the thing is. Reading back its quantity would state a
    // number nobody touched and leave the shelf unmentioned.
    case 'MOVE':
      return { kind: 'QUERY_WHERE', item: write.item.name, location: null };
    /*
     * The one write with no item to ask after, so the question is put to the
     * PLACE - the same "o que tem no porao" anybody could say out loud.
     *
     * What comes back is "there is nothing in Porão", which is thin and is
     * true: the shelf was made a moment ago and nothing has been put on it.
     * Saying it at all is the receipt. `execute` answers a place it cannot
     * find with notFound, which `sentence` renders as nothing, so hearing this
     * sentence is itself the proof that the row is there.
     */
    case 'NEW_LOCATION':
      return { kind: 'QUERY_WHERE', item: null, location: write.name };
    /*
     * The same again for a heading, and QUERY_CATEGORY rather than
     * QUERY_WHERE: the second of those tries the PLACE first and answers with
     * the category only when no place fits, so a household with a shelf whose
     * name shares a word would hear about the shelf. "What is in tools" is
     * also the question somebody could have asked out loud.
     *
     * "Nothing is filed under tools" is thin and true - the heading was made a
     * moment ago and nothing carries it yet. Saying it at all is the receipt:
     * `execute` answers a category it cannot find with notFound, which
     * `sentence` renders as nothing, so hearing this sentence is itself the
     * proof that the row is there.
     */
    case 'NEW_CATEGORY':
      return { kind: 'QUERY_CATEGORY', category: write.name };
    /*
     * And QUERY_CONTACT for a person - which is the best receipt in this
     * feature rather than the thinnest.
     *
     * The other two read back an empty room: a place made a moment ago holds
     * nothing, a heading has nothing filed under it, and saying so is only
     * proof that the row is there. A contact has a NUMBER in it, and
     * `renderAnswer`'s CONTACT branch reads that number out - with the
     * relationship, where the row has one. So the sentence that follows a
     * confirmed contact is the number itself, said aloud.
     *
     * That is the only check there is on digits that were heard rather than
     * typed. The card shows them and asks; this says them back out of the
     * DATABASE afterwards, which is a different fact - what was stored, not
     * what was understood.
     *
     * `write.name` is what the row was created with, so the search that finds
     * it is looking for a string that is certainly in it.
     */
    case 'NEW_CONTACT':
      return { kind: 'QUERY_CONTACT', query: write.name };
    case 'CREATE':
      return { kind: 'QUERY_QUANTITY', item: write.name };
    /*
     * ADJUST, MINIMUM and TARGET: three writes about a number on an item, and
     * the item's quantity is the fact worth stating after any of them.
     *
     * A `default` rather than three cases, and it stays safe as the union
     * grows: it reads `write.item`, which every member that belongs here has
     * and no member that does not. That is what caught NEW_CONTACT - a write
     * with no item on it is a compile error here until somebody decides what
     * question to ask after it, rather than a wrong question asked quietly.
     */
    default:
      return { kind: 'QUERY_QUANTITY', item: write.item.name };
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

/**
 * A sentence's fate, as a turn result.
 *
 * `spoken` and nothing else re-arms. `silent` is a device that deliberately
 * made no sound - the setting, the ringer switch, the media volume at zero -
 * and `unknown` is a watchdog expiring with the platform still saying nothing,
 * which means the phone may well still be talking. Listening over either is
 * the failure mode this whole gate exists to prevent.
 */
const heard = (outcome: SpeechOutcome): TurnResult =>
  outcome === 'spoken' ? 'answered' : 'unheard';

/**
 * Whether an outcome with no sentence to read is waiting for a press.
 *
 * `pending` is a confirmation card and `choice` is a list of names, so both
 * are. A `notFound` is only one where the intent is worth creating - the sheet
 * draws the Create button off exactly this list - and "where is the rice?"
 * finding no rice offers nothing to press. `unknown` offers nothing either:
 * the chips below the log are teaching material rather than an answer to this
 * sentence.
 *
 * Neither of the last two re-arms all the same, because neither says anything
 * out loud. Somebody who heard nothing has no way to know the microphone is
 * still open, and a loop that listens into that silence is recording a room.
 */
const needsPress = (outcome: Outcome): boolean =>
  outcome.kind === 'pending' ||
  outcome.kind === 'choice' ||
  (outcome.kind === 'notFound' && CREATABLE_INTENTS.includes(outcome.intent.kind));

export function useVoice(speak: Speak, microphone: Microphone): Voice {
  const { repositories, itemContext, settings, t, invalidate } = useApp();
  const [history, setHistory] = useState<readonly Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversing, setConversing] = useState(false);

  /*
   * Whether a conversation is running, and whether it has been told to stop.
   *
   * Refs and not state, because the loop reads them between two awaits and state
   * read from a closure is the value from the render the closure was made in.
   * `conversing` above is the same fact for anything that RENDERS from it; these
   * two are the same fact for the loop itself, which is the only place that can
   * act on them in time.
   */
  const running = useRef(false);
  const ended = useRef(false);

  // Every armed Undo window, so a sheet that goes away takes its timers with it.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      // A conversation outlives nothing. Unmounting sets the flag the loop
      // checks after every await, so a listen that settles into a sheet which is
      // no longer on screen runs no further turn.
      ended.current = true;
    },
    [],
  );

  const grammar = useMemo(() => grammarFor(settings.language), [settings.language]);
  const tag = LOCALE_TAGS[settings.language];

  const deps = useMemo<VoiceDeps>(
    () => ({
      items: repositories.items,
      locations: repositories.locations,
      // The categories turn a spoken "alimentos" into the id the item query
      // filters on, and both of these are now written as well as read: a
      // sentence can make a category and a sentence can make a contact, each
      // through the confirmation card and `commit` like every other write.
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

  /**
   * `execute` returns HELP and UNKNOWN empty-handed; the grammar lives here.
   *
   * ONLY THE HELP HALF IS STILL READ. `answer.ts` turns a HELP answer into a
   * sentence carrying the whole list, so that one matters. Nothing renders the
   * examples attached to an UNKNOWN any more - the sheet shows its own chips for
   * that, off `voice.examples`, because they are buttons rather than a sentence
   * and have to sit outside the live region. The field stays on the outcome
   * because `Outcome` requires it, and taking it off means changing a type in
   * `execute.ts` for a payload that costs one array reference. Left here and
   * named, rather than removed in a change about layout.
   */
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
   * Which turn owns `busy`, so that an older one cannot lift it.
   *
   * THIS IS A REAL BUG AND NOT A PRECAUTION, AND THE LOOP IS WHAT MADE IT
   * ROUTINE. `announce` below lifts `busy` BEFORE awaiting the utterance, which
   * is deliberate and is the whole of the paragraph under it. The consequence is
   * that the sheet is interactive while a sentence plays, so a second turn can
   * begin while the first is still speaking - and every one of the five
   * `finally` blocks below runs after its own utterance, which is to say after
   * the newer turn has already raised `busy`. The older turn would then drop
   * `inert` and the thinking line for the whole of the newer one.
   *
   * Before the speaking change that window was sub-millisecond and nobody could
   * reach it. After it, it is the length of an answer.
   *
   * NOT REACHED BY THE CONVERSATION, WHICH IS WORTH SAYING BECAUSE IT IS THE
   * FIRST PLACE ANYBODY WILL LOOK. The loop awaits `run` to the end of the
   * utterance before it listens again, so it never overlaps its own turns. What
   * reaches this is a second question typed by hand while the first answer is
   * still being read - which is why the test that pins it drives Claude rather
   * than the loop.
   *
   * A TOKEN RATHER THAN TAKING `setBusy(false)` OUT OF THE `finally` BLOCKS,
   * which was the other way to fix it. Those blocks are the only thing that
   * lifts `busy` on the paths that never reach a sentence - a card, a choice, a
   * throw - so removing them would mean every one of those paths growing its own
   * lift, in five places, with nothing to catch the sixth. The counter says the
   * one true thing instead: only the newest turn may say the sheet is free.
   */
  const turnId = useRef(0);

  /** Raises `busy`, clears the last error, and claims the sheet for this turn. */
  const beginTurn = useCallback((): number => {
    setBusy(true);
    setError(null);
    turnId.current += 1;
    return turnId.current;
  }, []);

  /** Gives the sheet back, unless a newer turn has taken it in the meantime. */
  const endTurn = useCallback((token: number) => {
    if (turnId.current === token) setBusy(false);
  }, []);

  /**
   * Lifts `busy`, and only then reads the answer out.
   *
   * THE ORDER IS THE WHOLE POINT, and it changed when `speak` did. It used to
   * resolve the instant a sentence had been handed to a platform, so `busy`
   * came down a few milliseconds after the answer appeared and the `inert`
   * window was the length of the query. It now resolves when the sentence has
   * been HEARD - which is what makes a spoken conversation possible at all -
   * and leaving `setBusy(false)` in the `finally` would have quietly extended
   * every inert window by the length of the utterance. On a phone that is
   * seconds of a sheet that cannot be typed into or scrolled, for an answer
   * that is already on the screen in front of the person waiting.
   *
   * Speaking is not working. The `finally` blocks still lift `busy` and still
   * have to: this only runs on the paths that reach a sentence, and the ones
   * that throw first never get here. Both go through `endTurn`, so the second
   * lift is a no-op when this turn is still the newest and is refused when it is
   * not - see the counter above, which is what makes that sentence true.
   *
   * IT HANDS THE OUTCOME BACK NOW. A conversation may only re-open the
   * microphone for a sentence that was actually heard, and this is the one place
   * that knows.
   */
  const announce = useCallback(
    async (text: string, token: number): Promise<SpeechOutcome> => {
      endTurn(token);
      return speak(text, tag);
    },
    [endTurn, speak, tag],
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
      /** The turn that raised `busy`, so only it may put the sheet back. */
      token: number,
    ): Promise<TurnResult> => {
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
        return 'unheard';
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
      /*
       * The Undo button is not a press this waits for, and that is deliberate.
       * The change has already happened, nothing is blocked on the user, and the
       * offer lapses on its own after ten seconds - which is why an explicit
       * write is the one write a conversation can carry straight through. It is
       * also why this phase adds no new write path: everything the loop can
       * commit, one press already commits today.
       */
      return text === null ? 'unheard' : heard(await announce(text, token));
    },
    [announce, armUndo, deps, invalidate, place, sentence],
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
    ): Promise<TurnResult> => {
      const token = beginTurn();
      try {
        const outcome = withExamples(await execute(deps, intent));

        if (outcome.kind === 'pending' && outcome.write.certainty === 'explicit') {
          return await store(said, outcome.write, index, true, transcribedOnline, token);
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
        if (text !== null) return heard(await announce(text, token));
        return needsPress(outcome) ? 'waiting' : 'unheard';
      } catch (cause) {
        // A thrown query or write is the sheet's alert and a conversation's
        // last turn. Nothing was said, so there is nothing to listen after.
        setError(cause instanceof Error ? cause.message : String(cause));
        return 'unheard';
      } finally {
        endTurn(token);
      }
    },
    [announce, beginTurn, deps, endTurn, place, sentence, store, withExamples],
  );

  const askParser = useCallback(
    async (
      question: string,
      aiFailure: AiFailureReason | null,
      transcribedOnline: boolean,
    ): Promise<TurnResult> =>
      turn(
        question,
        parse(grammar, question, { today: itemContext.today }),
        null,
        aiFailure,
        transcribedOnline,
      ),
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
    async (question: string, transcribedOnline: boolean): Promise<TurnResult> => {
      const token = beginTurn();

      try {
        const result = await askAssistant(aiDeps, aiOptions, question);

        // The whole point of keeping the parser: no key, no network, a refused
        // key or too many questions all still get an answer from the rules on
        // this device, which need none of those things.
        if (result.kind === 'failed') {
          return await askParser(question, result.reason, transcribedOnline);
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
          // Shown and not spoken, so nobody who is not looking at the sheet
          // knows it arrived. A conversation ends here.
          return 'unheard';
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
        const said = text === '' ? 'silent' : await announce(text, token);

        /*
         * A PROPOSAL IS A CARD, AND A CARD ENDS A CONVERSATION. The sentence is
         * still read out first - it was found, it is worth hearing - and then
         * the loop stops, because underneath it are one or more changes nobody
         * has agreed to and there is no spoken way to agree to them yet.
         *
         * The honest consequence, stated rather than hidden: a conversation with
         * the assistant that produces a proposal is one turn long. Only the
         * questions Claude answers without asking for a write keep going.
         */
        return proposals.length > 0 ? 'waiting' : heard(said);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return 'unheard';
      } finally {
        endTurn(token);
      }
    },
    [aiDeps, aiOptions, announce, askParser, beginTurn, endTurn, place, t],
  );

  const run = useCallback(
    async (question: string, transcribedOnline = false): Promise<TurnResult> =>
      engine === 'claude'
        ? askClaude(question, transcribedOnline)
        : askParser(question, null, transcribedOnline),
    [askClaude, askParser, engine],
  );

  /**
   * One press of the microphone, and every turn that follows from it.
   *
   * THE LOOP IS HERE AND NOT IN THE SHEET OR THE BUTTON, for one reason: it has
   * to know what the turn it just ran produced, and the only place that fact
   * exists in time is the value `run` hands back. `history` is state, so a
   * closure awaiting a turn is holding the array from before that turn ran.
   *
   * IT STOPS ON EVERY ONE OF THESE, and the list is the design rather than a
   * detail:
   *
   *   `no-match`, which is how a conversation is MEANT to end. Android maps both
   *   ERROR_NO_MATCH and ERROR_SPEECH_TIMEOUT to it, so "nobody spoke" arrives as
   *   a distinct code and stopping talking is the natural way out. It is also the
   *   one failure this does not report: `MicNotice` renders "I did not hear
   *   anything" for it, which is right for a single press and would turn the
   *   ordinary end of every conversation into an error panel. The FIRST turn
   *   still reports it, because a press that heard nothing at all is exactly the
   *   press that message was written for.
   *
   *   `cancelled`, which is the stop control, and `busy`, which is a recognizer
   *   already holding the microphone. Neither is worth asking again after: the
   *   first was deliberate and the second would land on the same CODE_BUSY.
   *
   *   Any other failure, an outcome that wants a press, a turn that threw, and
   *   any answer that was not heard - see `TurnResult`.
   *
   *   The stop control and the sheet going away, through `ended` above.
   *
   *   And the cap, which is the only stop that is a number rather than an event.
   *
   * WHAT IT DOES NOT DO IS HOLD A RECOGNIZER OPEN BETWEEN TURNS. Every turn binds
   * a fresh one and releases it, which is what keeps "the microphone is released
   * on every path" true; the answer being read out is the gap between them.
   */
  const converse = useCallback(async (): Promise<SpeechFailure | null> => {
    // One conversation at a time. A second press during one would be a second
    // listen, which is the CODE_BUSY this whole arrangement exists to avoid.
    if (running.current) return null;
    running.current = true;
    ended.current = false;
    /*
     * Read once, at the start, and not again. A conversation runs under the
     * rules it began with: somebody who changes the setting from another screen
     * mid-sentence is asking about the next press, and the way out of this one
     * is the stop control.
     */
    const keepListening = settings.voiceKeepListening;
    setConversing(keepListening);

    try {
      for (let spoken = 0; spoken < MAX_CONVERSATION_TURNS; spoken++) {
        const result = await microphone.listen();
        if (ended.current) return null;

        if (result.kind === 'failed') {
          const closing = spoken > 0 && result.reason === 'no-match';
          return closing ? null : result.reason;
        }

        const turnResult = await run(result.text, result.online);
        if (ended.current || !keepListening || turnResult !== 'answered') return null;
      }
      return null;
    } finally {
      running.current = false;
      setConversing(false);
    }
  }, [microphone, run, settings.voiceKeepListening]);

  const endConversation = useCallback(() => {
    ended.current = true;
    /*
     * Both halves, and they do different jobs. The flag stops the turn that
     * would have come next, which is the only thing that can be stopped while an
     * answer is being read out. Cancelling releases the microphone if one is
     * open, and the listen in flight then comes back as `cancelled` - the same
     * one path out of a listen, however it was reached.
     *
     * The sentence being read is deliberately left to finish. The control is
     * about listening, it says so, and cutting a phone off mid-word to honour a
     * press about the microphone would be answering a different question.
     */
    void microphone.stop();
  }, [microphone]);

  /** The confirmation card's button: the write the user was asked about. */
  const confirm = useCallback(
    async (index: number) => {
      const entry = history[index];
      if (entry === undefined || entry.engine !== 'device') return;
      if (entry.outcome.kind !== 'pending') return;
      const write = entry.outcome.write;

      const token = beginTurn();
      try {
        await store(entry.said, write, index, false, entry.transcribedOnline, token);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        endTurn(token);
      }
    },
    [beginTurn, endTurn, history, store],
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

      const token = beginTurn();
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
        if (said !== '') await announce(said, token);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        endTurn(token);
      }
    },
    [announce, beginTurn, deps, endTurn, history, invalidate, sentence],
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

      const token = beginTurn();
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
        await announce(text, token);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        endTurn(token);
      }
    },
    [announce, beginTurn, deps, endTurn, history, invalidate, t],
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
    conversing,
    converse,
    endConversation,
    confirm,
    confirmProposal,
    discardProposal,
    takeBack,
    choose,
    create,
    dismiss,
  };
}
