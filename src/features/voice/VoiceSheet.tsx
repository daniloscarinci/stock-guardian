/**
 * The ask sheet: a box to type or speak into, pinned at the bottom, with what
 * was asked and what came of it above it.
 *
 * Built on `components/ui/Dialog`, which is the native `<dialog>` element. That
 * is where focus trapping, Escape-to-close, inertness of the page behind and
 * the bottom-sheet behaviour on a phone come from; none of it is reimplemented
 * here.
 *
 * EVERY PIXEL FIGURE BELOW IS MEASURED, NOT DERIVED. They come from a survey of
 * the rendered sheet at a 16px root - the chip wrapping especially, which no
 * reading of this file can give you, because it depends on string length against
 * available width in three languages. Re-measure rather than trust them if the
 * type scale, the chip padding or the examples change.
 *
 * THE COMPOSER IS THE DIALOG'S FOOTER, AND THAT IS WHAT THIS FILE IS ARRANGED
 * AROUND. It used to be the last block of the scrolling body, under a list of
 * example sentences whose height nothing bounded: six whole sentences wrap to
 * three rows at 390px of inner width and to six at 360px, so at 360x640 an empty
 * sheet computed taller than its own cap and Send sat a hundred pixels below the
 * fold before anybody had typed a word. Several things were competing to be
 * looked at first, the layout settled it by document order, and document order
 * had been chosen for reading rather than for acting. The box is the reason anyone opens this, so the box is the
 * thing that cannot move: `Dialog`'s `footer` renders outside the body's scroll
 * box and already carries the gesture-bar inset, and this sheet was the only
 * dialog in the application not using it.
 *
 * The examples became the empty state of the log instead of a block above the
 * control they teach, which is why their height stopped mattering and why there
 * is no clamp on them anywhere.
 *
 * TWO WAYS IN, AND NEITHER IS A FALLBACK. The box is on every platform and
 * always worked; the microphone is on the platforms that have a recognizer, and
 * it was removed once because Android refused every offline request on a phone
 * with no Portuguese pack. It is back, on-device first, and when the device
 * cannot manage it tries once over the internet and says so - see `useListen`,
 * which owns the recognizer and hands over one sentence at a time. Every
 * transcript goes to `run`, the same function the Send button calls, so a spoken
 * question and a typed one take exactly the same path from here on. What travels
 * with it is one flag: whether the words were captured on the phone or over the
 * network. The exchange is marked with it below.
 *
 * ONE PRESS CAN NOW BE A WHOLE CONVERSATION, and this file composes the two
 * halves of that rather than owning either. `useListen` is the microphone;
 * `useVoice` is the loop, because only it knows what the turn it just ran
 * produced. What belongs here is the arrangement: the press that starts a
 * conversation, the stop control - which has to stand outside the region this
 * sheet declares non-interactive, since a loop spends most of its life inside
 * that window - and the sentence explaining a conversation that stopped because
 * nobody could have heard the answer.
 *
 * THE MICROPHONE'S BUTTON AND THE MICROPHONE'S BAD NEWS ARE SPLIT, and this file
 * holds the seam. A button is a way in and belongs beside the other way in; the
 * `no-offline-model` panel is a paragraph, two buttons, a collapsible
 * explanation, a settings switch and a conditional hint, which is up to two
 * hundred pixels of furniture that has no business in a pinned footer. So the
 * failure code lives here, `converse` hands it back at the end of a press, and
 * `MicNotice` renders it at the top of the scroll box where messages go. It
 * comes back as a return value rather than through a callback because one
 * failure is not worth explaining - the `no-match` that ends a conversation -
 * and only the loop knows which turn it was.
 *
 * THE ANSWER IS READ BACK. `createSpeaker` for the setting, `androidAudibility`
 * for everything the phone decides - the switch on its side and the media
 * volume, in one bridge call. Speaking is not listening and asks for nothing;
 * the composition of the two is a few lines below.
 *
 * The component holds no logic of its own. `useVoice` owns the state machine
 * and is tested through this file's typed path, which needs no speech API at
 * all.
 */
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Dialog } from '../../components/ui/Dialog';
import { Alert, Button } from '../../components/ui/primitives';
import { fieldStyles } from '../../components/ui/Field';
import { cx } from '../../components/ui/cx';
import { createSpeaker, type SpeechOutcome } from '../../services/speech/speak';
import { androidAudibility } from '../../services/speech/ringer';
import { CREATABLE_INTENTS } from '../../voice/intents';
import { useVoice, type Exchange, type Voice } from './useVoice';
import { useListen } from './useListen';
import { MicButton } from './MicButton';
import { MicNotice } from './MicNotice';
import { ConfirmCard } from './ConfirmCard';
import { ChoiceList } from './ChoiceList';
import type { SpeechFailure } from '../../services/speech/recognizer';
import type { AiFailureReason } from '../../services/ai/converse';
import type { TranslationKey } from '../../i18n/types';
import styles from './Voice.module.css';

export interface VoiceSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * A reason Claude did not answer, and the sentence for it.
 *
 * A total record, so a new member of `AiFailureReason` is a compile error here
 * rather than a failure that renders as nothing. The reasons are not sentences
 * for the same reason the speech codes were not: `converse` knows what went
 * wrong and this file knows what to show for it.
 */
const AI_FAILURES: Readonly<Record<AiFailureReason, TranslationKey>> = {
  noKey: 'ai.noKey',
  auth: 'ai.authFailed',
  rateLimit: 'ai.rateLimited',
  offline: 'ai.offline',
  api: 'ai.failed',
};

/**
 * How many of the grammar's examples are offered at rest.
 *
 * There are twelve per language, and twelve is a lot to read. These are whole
 * sentences rather than words, so at phone width most of them take a row to
 * themselves and the list is as tall as it is long.
 *
 * What that no longer costs is a control. The list is the last thing in the
 * scroll box and the microphone and the box are pinned in the footer below it,
 * so a twelfth example pushes nothing off the screen - it pushes the log's own
 * older lines up, which is what a scroll box is for. Six is the resting count
 * because six is as much as is worth reading before trying one, and because the
 * grammar orders `examples` with this slice in mind and its own comment says so:
 * six carries six different SHAPES of sentence - one item's quantity, what is
 * going off, what to buy, stock arriving, stock going, and a place being made.
 *
 * The other six are one press away, and all twelve are still read out by HELP,
 * which is a question anybody can ask here.
 */
const EXAMPLE_CHIPS = 6;

/**
 * Why a sentence was not heard, when a conversation needed it to be.
 *
 * Four causes and four different things to do about them, which is the whole
 * reason this is a union rather than a boolean. Two are the phone - the switch
 * on its side, and the media slider, which are different states and have
 * different fixes. One is this application's own setting. And one is an engine
 * that took the sentence and never said what became of it, where the honest
 * thing to report is that nobody knows.
 *
 * A conversation stops on all four alike, because a loop listening for the
 * answer to a question nobody heard is the failure this feature must not have.
 * What differs is the sentence the sheet shows afterwards.
 */
type Silence = 'ringer' | 'media' | 'setting' | 'unknown';

const SILENCES: Readonly<Record<Silence, TranslationKey>> = {
  ringer: 'voice.conversationSilenced',
  media: 'voice.conversationMediaMuted',
  setting: 'voice.conversationMute',
  unknown: 'voice.conversationUnheard',
};

export function VoiceSheet({ open, onClose }: VoiceSheetProps) {
  const { t, settings } = useApp();
  const [typed, setTyped] = useState('');
  const [allExamples, setAllExamples] = useState(false);
  /*
   * The microphone's last failure, held here rather than in `useListen`, because
   * the button and the panel explaining it do not render in the same place: the
   * button is in the pinned footer and the panel is at the top of the scroll
   * box. See the note at the top of this file about why they were split.
   */
  const [micFailure, setMicFailure] = useState<SpeechFailure | null>(null);
  /*
   * Why the last conversation went quiet, or null.
   *
   * A ref AND a piece of state, deliberately. `speak` below writes the ref,
   * because it runs inside a turn and the press that started the conversation is
   * awaiting it several frames later; the state is what renders, and it is set
   * once, at the end, from what the ref holds. Setting state from inside `speak`
   * would put the panel up after any silenced answer, including a typed one -
   * and "the conversation stopped" would be a sentence about something that was
   * never running.
   */
  const silence = useRef<Silence | null>(null);
  const [silenced, setSilenced] = useState<Silence | null>(null);
  const boxRef = useRef<HTMLInputElement>(null);
  const boxId = useId();
  // Names the chip list after the line above it, so a screen reader reaching
  // the list says what the buttons in it are for rather than just counting
  // them.
  const hintsId = useId();
  // And names the list to the disclosure that lengthens it.
  const chipsId = useId();

  const speaker = useMemo(
    () =>
      createSpeaker(
        () => settings.voiceSpeakAnswers,
        () => settings.speakingVoiceUri,
      ),
    [settings.voiceSpeakAnswers, settings.speakingVoiceUri],
  );

  /**
   * The setting and the phone, composed.
   *
   * `createSpeaker` deliberately knows nothing about platforms, and everything
   * that can silence a phone is a platform fact. On Android the phone wins over
   * the setting; in a browser `androidAudibility` resolves `audible`, because a
   * browser cannot read that state and the setting is the only control there is.
   *
   * A SILENCED PHONE IS `silent`, NOT NOTHING. This used to return early with
   * no answer at all, which is the same nothing a failed engine produced, so
   * the state machine below could not tell "the person asked for quiet" from
   * "we do not know whether anybody heard that". The word is the seam's own -
   * `say` answers with it for the setting and for an empty answer - and the
   * phone is answered with it here, because here is where the platform is known.
   *
   * THE GAP PHASE ONE LEFT IS CLOSED HERE, AND IT IS CLOSED IN ONE ROUND TRIP.
   * `say` reports `silent` for the two quiets it decides itself and knows
   * nothing about a phone; the ringer check that used to be on this line knew
   * about the switch and not about the media volume, so a phone with the ringer
   * on and the media slider at zero read every answer out to nobody and reported
   * `spoken`. `androidAudibility` answers both from the one `Ringer.isSilent`
   * call the bridge was already making - not two, which is what composing
   * `androidIsSilent` with `androidMediaMuted` would have cost on every
   * sentence of every turn.
   *
   * TWO QUESTIONS, AND THEY ARE NOT THE SAME QUESTION. One is whether it is
   * SAFE to open a microphone, and `spoken` answers that on its own: the engine
   * holds the media stream for the length of an utterance whether or not the
   * slider is up, so a phone with the volume at zero is no more likely to record
   * itself than any other. The other is whether a conversation is worth
   * continuing, and it is not: the person cannot hear the answers, so they
   * cannot know what was said or that the microphone is open again. This
   * function answers the second, which is the one a conversation turns on, and
   * that is why a muted media stream is `silent` here and would not be if the
   * only worry were the echo.
   *
   * Which is also why a muted phone is not handed the sentence at all. That is
   * the behaviour `previewVoice` in Settings already has - it refuses and says
   * to turn the volume up - and a sheet that quietly read answers into a stream
   * at zero while Settings called the same state a problem would be two parts of
   * one application disagreeing about a phone.
   *
   * Every cause arrives at the loop as the same word, which is all the loop
   * needs: it must not listen. Which cause it was is written to the ref, which
   * is all the sheet needs: it has a sentence for each.
   */
  const speak = useCallback(
    async (text: string, tag: string): Promise<SpeechOutcome> => {
      const audibility = await androidAudibility();
      if (audibility !== 'audible') {
        silence.current = audibility === 'silenced' ? 'ringer' : 'media';
        return 'silent';
      }

      const outcome = await speaker.say(text, tag);
      // `silent` from the seam can only be the setting here: the empty answer it
      // also reports it for never reaches this function, because every caller in
      // `useVoice` guards on there being a sentence to read.
      if (outcome !== 'spoken') silence.current = outcome === 'silent' ? 'setting' : 'unknown';
      return outcome;
    },
    [speaker],
  );

  const microphone = useListen();
  const voice = useVoice(speak, microphone.microphone);
  const { converse, endConversation, run } = voice;

  /**
   * One press, and everything that follows it.
   *
   * The two panels are cleared first, because a message about the last press
   * standing over this one explains the wrong thing. The failure comes back from
   * the loop rather than from a callback, so the decision not to raise "I did not
   * hear anything" when a conversation simply ended is made where the turn count
   * is - see `converse`.
   *
   * The silence panel is shown only where a conversation was asked for. With the
   * setting off there is nothing for an unheard answer to have stopped, and the
   * answer is on the screen either way.
   */
  const press = useCallback(async () => {
    setMicFailure(null);
    setSilenced(null);
    silence.current = null;

    const failure = await converse();

    setMicFailure(failure);
    setSilenced(settings.voiceKeepListening ? silence.current : null);
  }, [converse, settings.voiceKeepListening]);

  // Nothing should still be talking over a sheet the user has closed, and no
  // conversation should still be waiting to open a microphone into one.
  const close = useCallback(() => {
    endConversation();
    speaker.stop();
    onClose();
  }, [endConversation, onClose, speaker]);

  /**
   * Puts the cursor in the typed box.
   *
   * Two callers, and they arrive for two different reasons.
   *
   * The microphone's failure panel lands here because the cursor belongs where
   * the feature still works. A phone with no speech pack has lost its
   * microphone and nothing else, and the point of saying so is to put somebody
   * in front of that fact rather than in front of an apology.
   *
   * An example chip lands here because it has just filled the box, and the
   * next thing anybody does with a filled box is change a word in it.
   */
  const focusBox = useCallback(() => {
    boxRef.current?.focus();
  }, []);

  /**
   * An example, put in the box rather than sent.
   *
   * This is the whole reason the chips are worth having, and filling rather
   * than sending is deliberate. A first-time reader does not want beans added
   * to their inventory; they want to see the SHAPE of a sentence this
   * application understands, and then say their own. "add five cans of beans"
   * in the box, with the cursor in it, is an invitation to change three words
   * and press Send. The same chip wired to `run` would instead perform a write
   * nobody asked for, on somebody's first press, in the one part of this
   * application whose entire design is about not doing that.
   */
  const fillBox = useCallback(
    (example: string) => {
      setTyped(example);
      focusBox();
    },
    [focusBox],
  );

  const submit = () => {
    const value = typed.trim();
    if (value === '') return;
    setTyped('');
    void run(value);
  };

  /*
   * When the examples are worth showing, which is the two moments somebody does
   * not know what to say: before anything has been asked, and straight after a
   * sentence that was not understood.
   *
   * Keyed off the LAST exchange rather than off any of them. An earlier failure
   * that has since been followed by something the grammar understood needs no
   * help offered about it; the answer above is the better teacher by then.
   */
  const last = voice.history.at(-1);
  const notUnderstood =
    last !== undefined && last.engine === 'device' && last.outcome.kind === 'unknown';
  const showExamples = voice.history.length === 0 || notUnderstood;
  const examples = allExamples ? voice.examples : voice.examples.slice(0, EXAMPLE_CHIPS);

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('voice.title')}
      /*
       * The box's instruction, moved up here, AND THIS IS A TRADE RATHER THAN A
       * FREE WIN.
       *
       * What it buys: `Dialog` wires `description` to `aria-describedby` on the
       * dialog element, so "Ask a question, or type a command" is read out as the
       * sheet opens. A `<label>` is only read when focus reaches the thing it
       * labels, and the box is at the far end of the sheet, so somebody who opens
       * this and is not looking at it used to be told the title and nothing else.
       *
       * What it costs, and it is a real cost: the sentence no longer stands
       * visibly beside the box, and the placeholder that took its place is not a
       * label - it disappears on the first keystroke, so from then on nothing on
       * screen names the box. The box keeps a real `<label>` for its accessible
       * name. It is hidden, not removed.
       */
      description={t('voice.typeInstead')}
      closeLabel={t('common.close')}
      footer={
        <div className={styles.composer}>
          {/*
            Said only while Claude is being waited on. The parser answers between
            two frames and a status line for it would be a flicker, not a
            message.

            OUTSIDE the inert row below, deliberately, and this is the one thing
            about that arrangement that is easy to get wrong: this line is the
            only thing that explains why the sheet has gone quiet, and anything
            inside an inert region is taken out of the accessibility tree along
            with the controls.
          */}
          {voice.busy && voice.engine === 'claude' && (
            <p className={styles.working} role="status">
              {t('ai.thinking')}
            </p>
          )}

          {/*
            The microphone's own line, and the way out of it - OUTSIDE the inert
            row below, for the same reason the thinking line above is.

            This used to sit inside `MicButton`, inside the form, and a
            conversation made that untenable. A conversation passes through
            `busy` on every single turn - it goes up while the sentence is being
            worked out and comes down again before the answer is read - so a stop
            control inside the form would blink out of reach once per sentence,
            for as long as each query takes. `inert` does not dim a control, it
            removes it from the accessibility tree, so it would not be dimmed and
            unpressable: it would be gone.

            It is still in the pinned footer, one line above the microphone that
            opened it. It could not share that row anyway - at 350px of inner
            width a status line and a second button leave the box no room at all
            - and it must not replace the box either, since somebody may have
            typed half a sentence before reaching for the microphone.
          */}
          {(microphone.open || voice.conversing) && (
            <div className={styles.listening}>
              <p role="status">
                {microphone.open ? t('voice.listening') : t('voice.conversationNext')}
              </p>
              {(voice.conversing || microphone.cancellable) && (
                <Button onClick={endConversation}>
                  {t(voice.conversing ? 'voice.stopConversation' : 'voice.stopListening')}
                </Button>
              )}
            </div>
          )}

          <form
            className={styles.composerRow}
            /*
             * The box is not the way in while a conversation is running, and
             * saying so is cheaper than making two `run` calls safe to
             * interleave. `busy` on its own would not cover it: most of a
             * conversation is the window `busy` is deliberately down for.
             */
            inert={voice.busy || voice.conversing}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <MicButton
              disabled={microphone.open || voice.conversing}
              onPress={() => {
                void press();
              }}
            />

            {/*
              A real `<label>`, visually hidden - the same `sr-only` utility and
              the same shape as the search boxes on the inventory, catalog and
              contacts screens. The sentence it holds is also the dialog's
              description above, which is what makes hiding it affordable.
            */}
            <label className="sr-only" htmlFor={boxId}>
              {t('voice.typeInstead')}
            </label>
            <input
              ref={boxRef}
              id={boxId}
              type="text"
              className={cx(fieldStyles.control, styles.box)}
              value={typed}
              autoComplete="off"
              placeholder={t('voice.typePlaceholder')}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />

            <Button type="submit" variant="primary">
              {t('voice.send')}
            </Button>
          </form>
        </div>
      }
    >
      {voice.error !== null && (
        <Alert tone="critical" role="alert">
          {voice.error}
        </Alert>
      )}

      {/*
        Why the microphone produced nothing, at the top of the scroll box. It is
        a message, and messages go where the reading happens; the button it is
        about is in the footer, where the other way in is. See `MicButton`.
      */}
      <MicNotice
        failure={micFailure}
        onTypeInstead={() => {
          setMicFailure(null);
          focusBox();
        }}
      />

      {/*
        Why the conversation stopped, when what stopped it was that nobody could
        have heard the answer.

        Beside the microphone's own panel and in the same place, because it is
        the same kind of news: a control did less than was asked of it, and the
        person is owed the reason rather than a sheet that quietly went back to
        one sentence per press. It is the one thing the arming gate has to say
        out loud - the other stops are all visible on the screen already, since a
        card, a list of names and "I did not understand that" explain themselves.
      */}
      {silenced !== null && (
        <Alert tone="info" role="status">
          {t(SILENCES[silenced])}
        </Alert>
      )}

      <div className={styles.conversation} inert={voice.busy}>
        {/*
          A log, announced as it grows. Someone using this feature may well not
          be watching the screen for a new paragraph to appear.
        */}
        <ol className={styles.history} role="list" aria-live="polite">
          {voice.history.map((entry, index) => (
            <li key={index} className={styles.exchange}>
              <VoiceExchange entry={entry} index={index} voice={voice} />
            </li>
          ))}
        </ol>

        {/*
          Something to say, for somebody who has not said anything yet - and for
          somebody whose sentence was not understood, which used to be a separate
          bulleted list of all twelve inside the exchange itself.

          A SIBLING OF THE LOG, NEVER A CHILD OF IT, AND NOW FOR TWO REASONS.
          That `<ol>` is an `aria-live` region and everything inside it is read
          out when it changes. Six example sentences appearing and then vanishing
          as a conversation starts is not news - that was the first reason, and it
          still holds. The second is the one that made this worth rebuilding: the
          twelve examples under "I did not understand that" WERE inside the live
          region, so a person not looking at the screen heard the failure and then
          twelve full sentences read aloud at them. Out here, behind a disclosure,
          they hear the failure and can go and ask - which is a question HELP
          already answers.
        */}
        {showExamples && (
          <div className={styles.hints}>
            <p className={styles.hintsTitle} id={hintsId}>
              {t('voice.examplesTitle')}
            </p>
            <ul className={styles.chips} id={chipsId} role="list" aria-labelledby={hintsId}>
              {examples.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => {
                      fillBox(example);
                    }}
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
            {/*
              The other six, one press away. After the list rather than before
              it, because what it reveals is appended to the end of that same
              list - so the chip immediately before this button is always the
              newest one - and because a button sitting above the row it
              lengthens reads as a heading for it.
            */}
            <Button
              aria-expanded={allExamples}
              aria-controls={chipsId}
              onClick={() => {
                setAllExamples((on) => !on);
              }}
            >
              {t('voice.moreExamples')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Where the words came from and what answered them, on one line.
 *
 * Two markers, not two banners, and now one row rather than two paragraphs that
 * could stack identically styled above the same answer. Both facts are worth
 * knowing and neither is worth a line of its own: one engine is exact, offline
 * and free and the other is capable and costs money per question; and the phone
 * transcribes on its own every single time, so the rare press whose audio left
 * the device is the one worth being able to see in the log. Marking it is what
 * makes the network fallback something offered rather than something done
 * quietly.
 *
 * `engine` is null on an exchange that was taken back, which is the one case
 * that says what was transcribed and not what answered, exactly as it did
 * before this was merged.
 *
 * THE MIDDOT IS NOT READ OUT AND THE COMMA IS NOT SEEN. A separator character
 * announced as "middle dot" between two short phrases is noise, and two phrases
 * run together with no punctuation at all are one confusing phrase. So the
 * middot is `aria-hidden` and a comma sits beside it in the `sr-only` utility,
 * which is out of flow and so costs the row nothing.
 */
function Provenance({
  engine,
  online,
}: {
  readonly engine: 'claude' | 'device' | null;
  readonly online: boolean;
}) {
  const { t } = useApp();
  if (!online && engine === null) return null;

  return (
    <p className={styles.engine}>
      {online && <span>{t('voice.transcribedOnline')}</span>}
      {online && engine !== null && (
        <>
          <span className="sr-only">{', '}</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      {engine !== null && (
        <span>{t(engine === 'claude' ? 'ai.fromClaude' : 'ai.fromParser')}</span>
      )}
    </p>
  );
}

/** One exchange, rendered according to what came of it. */
function VoiceExchange({
  entry,
  index,
  voice,
}: {
  readonly entry: Exchange;
  readonly index: number;
  readonly voice: Voice;
}) {
  const { t } = useApp();

  if (entry.engine === 'claude') {
    return (
      <>
        <p className={styles.said}>{t('voice.heard', { transcript: entry.said })}</p>
        <Provenance engine="claude" online={entry.transcribedOnline} />
        <p className={styles.answer}>{entry.text}</p>

        {entry.proposals.length > 0 && (
          <p className={styles.cardMeta}>
            {t('ai.proposals', { count: entry.proposals.length })}
          </p>
        )}

        {entry.proposals.map((proposal, position) =>
          proposal.done === null ? (
            <ConfirmCard
              key={position}
              write={proposal.write}
              onConfirm={() => {
                void voice.confirmProposal(index, position);
              }}
              onCancel={() => {
                voice.discardProposal(index, position);
              }}
            />
          ) : (
            <p key={position} className={styles.answer}>
              {proposal.done}
            </p>
          ),
        )}
      </>
    );
  }

  const { outcome } = entry;

  /*
   * A write that was taken back states the reversal and nothing else.
   *
   * The outcome underneath it is the receipt for a change that no longer
   * stands. Rendering it would leave the log saying the beans are at seventeen
   * after they have gone back to twelve, which is the interface lying about the
   * database.
   */
  if (entry.undone) {
    return (
      <>
        <p className={styles.said}>{t('voice.heard', { transcript: entry.said })}</p>
        <Provenance engine={null} online={entry.transcribedOnline} />
        <p className={styles.answer}>{entry.text}</p>
      </>
    );
  }

  return (
    <>
      <p className={styles.said}>{t('voice.heard', { transcript: entry.said })}</p>
      <Provenance engine="device" online={entry.transcribedOnline} />

      {/*
        Claude was asked and could not answer, so the twenty-two rules did. Said
        rather than swallowed: a key with one character wrong would otherwise
        look exactly like an assistant nobody had switched on. Under the line
        that names the engine rather than above it, because it is the reason that
        line says "on this device".
      */}
      {entry.aiFailure !== null && (
        <p className={styles.hint}>
          {t(AI_FAILURES[entry.aiFailure])} {t('ai.thenOffline')}
        </p>
      )}

      {outcome.kind === 'answer' && <p className={styles.answer}>{entry.text}</p>}

      {/*
        A write that was stored without asking, offered back for as long as the
        window stands. Deliberately not focused: the change has already
        happened, nothing is waiting on the user, and taking the cursor out of
        the typed box after every sentence would be its own annoyance.
      */}
      {entry.receipt !== null && (
        <div className={styles.actions}>
          <Button
            aria-label={t('voice.undoAction', { detail: entry.text ?? entry.said })}
            /*
             * Ends the conversation before it takes anything back, and that
             * ordering is the point rather than tidiness.
             *
             * Undoing SPEAKS - "Desfeito. Your stock is back to what it was."
             * A conversation is listening in the gaps between its own turns, so
             * pressing this while one runs would hand a sentence to the speaker
             * with a recogniser already open, and the phone would transcribe
             * itself. That is the one thing the arming gate exists to prevent,
             * and the gate cannot see a press.
             *
             * Stopping first rather than going inert while a conversation runs:
             * inert would have closed the hole by taking the button away, and
             * the ten seconds this button exists for do not pause while
             * somebody works out how to reach it.
             */
            onClick={() => {
              voice.endConversation();
              void voice.takeBack(index);
            }}
          >
            {t('voice.undo')}
          </Button>
        </div>
      )}

      {outcome.kind === 'pending' && (
        <ConfirmCard
          write={outcome.write}
          onConfirm={() => {
            void voice.confirm(index);
          }}
          onCancel={() => {
            voice.dismiss(index);
          }}
        />
      )}

      {outcome.kind === 'choice' && (
        <ChoiceList
          items={outcome.items}
          total={outcome.total}
          onChoose={(item) => {
            void voice.choose(index, item);
          }}
        />
      )}

      {outcome.kind === 'notFound' && (
        <>
          <p className={styles.answer}>{t('voice.notFound', { phrase: outcome.phrase })}</p>
          {/*
            Offered only for a write whose missing item is worth creating.
            "Where is the rice?" finding no rice is an answer, not an invitation
            to invent one - and neither is a move, where making the item would
            leave it sitting on no shelf with the move still not made, or a
            minimum set on stock that does not exist. `CREATABLE_INTENTS` says
            which writes qualify and why.
          */}
          {CREATABLE_INTENTS.includes(outcome.intent.kind) && (
            <div className={styles.actions}>
              <Button
                variant="primary"
                onClick={() => {
                  void voice.create(index);
                }}
              >
                {t('voice.createInstead')}
              </Button>
            </div>
          )}
        </>
      )}

      {/*
        The failure itself, and nothing else. The examples to try are chips
        below the log rather than a bulleted list in here: this is an `aria-live`
        region, and twelve sentences read out after "I did not understand that"
        is the announcement burying the message.
      */}
      {outcome.kind === 'unknown' && <p className={styles.answer}>{t('voice.notUnderstood')}</p>}
    </>
  );
}
