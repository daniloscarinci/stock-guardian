/**
 * The ask sheet: what was asked, what came of it, a microphone and a box to
 * type in - and, on an empty sheet, a few sentences to start from.
 *
 * Built on `components/ui/Dialog`, which is the native `<dialog>` element. That
 * is where focus trapping, Escape-to-close, inertness of the page behind and
 * the bottom-sheet behaviour on a phone come from; none of it is reimplemented
 * here.
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
import { TextField } from '../../components/ui/Field';
import { createSpeaker } from '../../services/speech/speak';
import { androidIsSilent } from '../../services/speech/ringer';
import { CREATABLE_INTENTS } from '../../voice/intents';
import { useVoice, type Exchange, type Voice } from './useVoice';
import { MicButton } from './MicButton';
import { ConfirmCard } from './ConfirmCard';
import { ChoiceList } from './ChoiceList';
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
 * How many of the grammar's examples are offered as chips on an empty sheet.
 *
 * There are twelve per language, and twelve is a lot of sheet. These are whole
 * sentences rather than words, so at phone width most of them take a row to
 * themselves and the list is as tall as it is long - and every row of it stands
 * above the microphone and the box, which are the two things anybody actually
 * came here for. A hint that buries the controls it is hinting about has cost
 * more than it gave.
 *
 * So the sheet shows an opening run and the grammar chooses what that run is:
 * `examples` is ordered with this slice in mind and its own comment says so.
 * Six is small enough to leave the controls in reach and still wide enough to
 * carry six different SHAPES of sentence - one item's quantity, what is going
 * off, what to buy, stock arriving, stock going, and a place being made.
 *
 * Nothing is hidden by this. The full twelve are still read out by HELP, which
 * is a question anybody can ask here, and by any sentence that was not
 * understood.
 */
const EXAMPLE_CHIPS = 6;

export function VoiceSheet({ open, onClose }: VoiceSheetProps) {
  const { t, settings } = useApp();
  const [typed, setTyped] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  // Names the chip list after the line above it, so a screen reader reaching
  // the list says what the six buttons in it are for rather than just counting
  // them.
  const hintsId = useId();

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
    formRef.current?.querySelector('input')?.focus();
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

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('voice.title')}
      closeLabel={t('common.close')}
    >
      {voice.error !== null && (
        <Alert tone="critical" role="alert">
          {voice.error}
        </Alert>
      )}

      {/*
        Something to say, for somebody who has not said anything yet.

        The hard part of a box you can say anything into is knowing what to
        say, and these sentences already existed - nine per language, now
        twelve, translated, and every one of them a phrase the grammar really
        accepts. Until now they were reachable only by asking for help outright
        or by failing to be understood, which is to say: the answer was only
        offered to people who had already hit the wall.

        They go once there is a history. By then the log itself is the better
        teacher - it says what this application understood and what it did
        about it - and the chips would be six buttons standing between the
        reader and their own conversation.

        OUTSIDE the log below, deliberately. That `<ol>` is an `aria-live`
        region, and anything placed inside it is read out when it changes; six
        example sentences appearing and then disappearing is not news.
      */}
      {voice.history.length === 0 && (
        <div className={styles.hints}>
          <p className={styles.hintsTitle} id={hintsId}>
            {t('voice.examplesTitle')}
          </p>
          <ul className={styles.chips} role="list" aria-labelledby={hintsId}>
            {voice.examples.slice(0, EXAMPLE_CHIPS).map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className={styles.chip}
                  disabled={voice.busy}
                  onClick={() => {
                    fillBox(example);
                  }}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        A log, announced as it grows. Someone using this feature may well not be
        watching the screen for a new paragraph to appear.
      */}
      <ol className={styles.history} role="list" aria-live="polite">
        {voice.history.map((entry, index) => (
          <li key={index} className={styles.exchange}>
            <VoiceExchange entry={entry} index={index} voice={voice} />
          </li>
        ))}
      </ol>

      {/*
        Said only while Claude is being waited on. The parser answers between
        two frames and a status line for it would be a flicker, not a message.
      */}
      {voice.busy && voice.engine === 'claude' && <p role="status">{t('ai.thinking')}</p>}

      {/*
        The microphone is here rather than in the header, so that nothing
        explains a speech failure to somebody who only came to type. See
        `MicButton`.
      */}
      <MicButton
        onHeard={(transcript, online) => {
          void run(transcript, online);
        }}
        onTypeInstead={focusBox}
        busy={voice.busy}
      />

      <form
        ref={formRef}
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className={styles.formField}>
          <TextField
            label={t('voice.typeInstead')}
            value={typed}
            autoComplete="off"
            disabled={voice.busy}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="primary" disabled={voice.busy}>
          {t('voice.send')}
        </Button>
      </form>
    </Dialog>
  );
}

/**
 * Which engine answered, said quietly on every exchange.
 *
 * A marker rather than a banner. The difference is worth knowing - one is
 * exact, offline and free, the other is capable and costs money per question -
 * and it is not worth a paragraph on every line.
 */
function Answered({ engine }: { readonly engine: 'claude' | 'device' }) {
  const { t } = useApp();
  return (
    <p className={styles.engine}>{t(engine === 'claude' ? 'ai.fromClaude' : 'ai.fromParser')}</p>
  );
}

/**
 * That the words came over the network, said in the same quiet place.
 *
 * Rendered only on the exchanges it is true of, which are the ones where the
 * phone could not transcribe on its own. The microphone tries the device first
 * every single time, so most exchanges never show this - and that is the point
 * of showing it at all. A person can look at the log and tell which presses
 * left the phone. Marking it is what makes the fallback something offered
 * rather than something done quietly.
 */
function Transcription({ online }: { readonly online: boolean }) {
  const { t } = useApp();
  if (!online) return null;
  return <p className={styles.engine}>{t('voice.transcribedOnline')}</p>;
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
        <Transcription online={entry.transcribedOnline} />
        <Answered engine="claude" />
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
        <Transcription online={entry.transcribedOnline} />
        <p className={styles.answer}>{entry.text}</p>
      </>
    );
  }

  return (
    <>
      <p className={styles.said}>{t('voice.heard', { transcript: entry.said })}</p>
      <Transcription online={entry.transcribedOnline} />

      {/*
        Claude was asked and could not answer, so the twenty-two rules did. Said
        rather than swallowed: a key with one character wrong would otherwise
        look exactly like an assistant nobody had switched on.
      */}
      {entry.aiFailure !== null && (
        <p className={styles.hint}>
          {t(AI_FAILURES[entry.aiFailure])} {t('ai.thenOffline')}
        </p>
      )}

      <Answered engine="device" />

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
            disabled={voice.busy}
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
                disabled={voice.busy}
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

      {outcome.kind === 'unknown' && (
        <>
          <p className={styles.answer}>{t('voice.notUnderstood')}</p>
          <p className={styles.said}>{t('voice.examplesTitle')}</p>
          <ul className={styles.examples} role="list">
            {outcome.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
