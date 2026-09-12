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
 * cannot manage it tries once over the internet and says so - see `MicButton`,
 * which owns the listening and hands over one sentence at a time. A transcript
 * goes to `run`, the same function the Send button calls, so a spoken question
 * and a typed one take exactly the same path from here on. What travels with it
 * is one flag: whether the words were captured on the phone or over the
 * network. The exchange is marked with it below.
 *
 * THE MICROPHONE'S BUTTON AND THE MICROPHONE'S BAD NEWS ARE SPLIT, and this file
 * holds the seam. A button is a way in and belongs beside the other way in; the
 * `no-offline-model` panel is a paragraph, two buttons, a collapsible
 * explanation, a settings switch and a conditional hint, which is up to two
 * hundred pixels of furniture that has no business in a pinned footer. So the
 * failure code lives here, `MicButton` reports it, and `MicNotice` renders it at
 * the top of the scroll box where messages go.
 *
 * THE ANSWER IS READ BACK. `createSpeaker` for the setting, `androidIsSilent`
 * for the switch on the side of the phone. Speaking is not listening and asks
 * for nothing; the composition of the two is a few lines below.
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
import { createSpeaker } from '../../services/speech/speak';
import { androidIsSilent } from '../../services/speech/ringer';
import { CREATABLE_INTENTS } from '../../voice/intents';
import { useVoice, type Exchange, type Voice } from './useVoice';
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

export function VoiceSheet({ open, onClose }: VoiceSheetProps) {
  const { t, settings } = useApp();
  const [typed, setTyped] = useState('');
  const [allExamples, setAllExamples] = useState(false);
  /*
   * The microphone's last failure, held here rather than in `MicButton`, because
   * the button and the panel explaining it no longer render in the same place:
   * the button is in the pinned footer and the panel is at the top of the scroll
   * box. See the note at the top of this file about why they were split.
   */
  const [micFailure, setMicFailure] = useState<SpeechFailure | null>(null);
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
   * `createSpeaker` deliberately knows nothing about platforms, and Android's
   * ringer switch is a platform fact. On Android the switch wins over the
   * setting; in a browser `androidIsSilent` resolves false, because a browser
   * cannot read that state and the setting is the only control there is.
   */
  const speak = useCallback(
    async (text: string, tag: string) => {
      if (await androidIsSilent()) return;
      await speaker.say(text, tag);
    },
    [speaker],
  );

  const voice = useVoice(speak);
  const { run } = voice;

  // Nothing should still be talking over a sheet the user has closed.
  const close = useCallback(() => {
    speaker.stop();
    onClose();
  }, [onClose, speaker]);

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

          <form
            className={styles.composerRow}
            inert={voice.busy}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <MicButton
              onHeard={(transcript, online) => {
                void run(transcript, online);
              }}
              onFailure={setMicFailure}
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
              busy={voice.busy}
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
            onClick={() => {
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
          busy={voice.busy}
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
          busy={voice.busy}
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
