/**
 * The voice sheet: what was said, what came of it, and a box to type in.
 *
 * Built on `components/ui/Dialog`, which is the native `<dialog>` element. That
 * is where focus trapping, Escape-to-close, inertness of the page behind and
 * the bottom-sheet behaviour on a phone come from; none of it is reimplemented
 * here.
 *
 * The typed box is not a fallback. It is present on every platform, so a device
 * that cannot transcribe speech loses the microphone in the header and keeps
 * the entire feature - which is why the sheet, not the microphone, is the thing
 * this feature is made of.
 *
 * The component holds no logic. `useVoice` owns the state machine and is tested
 * through this file's typed path, which needs no browser speech API.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Dialog } from '../../components/ui/Dialog';
import { Alert, Button } from '../../components/ui/primitives';
import { TextField } from '../../components/ui/Field';
import { createSpeaker } from '../../services/speech/speak';
import { androidIsSilent } from '../../services/speech/capacitor';
import type { SpeechFailure } from '../../services/speech/recognizer';
import { WRITING_INTENTS } from '../../voice/intents';
import { useVoice, type Exchange, type Voice } from './useVoice';
import { ConfirmCard } from './ConfirmCard';
import { ChoiceList } from './ChoiceList';
import { MicNotice } from './MicNotice';
import styles from './Voice.module.css';

export interface VoiceSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * A transcript from the microphone, run once and then cleared by the owner.
   * The sheet does not listen; the button does, and hands the words over.
   */
  readonly heard?: string | null | undefined;
  readonly onHeardConsumed?: (() => void) | undefined;
  /**
   * Why the microphone produced nothing, or null when it produced something.
   *
   * A reason rather than a sentence: what to show for one is a question about
   * this interface, and the recognizer has no business answering it.
   */
  readonly failure?: SpeechFailure | null | undefined;
  /** Clears that reason - the panel's own "type the command instead". */
  readonly onFailureDismissed?: (() => void) | undefined;
  readonly listening?: boolean | undefined;
}

export function VoiceSheet({
  open,
  onClose,
  heard = null,
  onHeardConsumed,
  failure = null,
  onFailureDismissed,
  listening = false,
}: VoiceSheetProps) {
  const { t, settings } = useApp();
  const [typed, setTyped] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  const speaker = useMemo(
    () => createSpeaker(() => settings.voiceSpeakAnswers),
    [settings.voiceSpeakAnswers],
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

  // A transcript arrives as a prop because the microphone lives in the header
  // button, which owns the recognizer. Consuming it clears it, so a re-render
  // cannot run the same sentence twice.
  useEffect(() => {
    if (heard === null || heard === '') return;
    onHeardConsumed?.();
    void run(heard);
  }, [heard, onHeardConsumed, run]);

  /**
   * The failure panel's way out.
   *
   * The notice goes and the cursor lands where the feature still works. A phone
   * with no speech pack has lost its microphone and nothing else, and the point
   * of the button is to put someone in front of that fact rather than in front
   * of an apology.
   */
  const typeInstead = useCallback(() => {
    onFailureDismissed?.();
    formRef.current?.querySelector('input')?.focus();
  }, [onFailureDismissed]);

  // Nothing should still be talking over a sheet the user has closed.
  const close = useCallback(() => {
    speaker.stop();
    onClose();
  }, [onClose, speaker]);

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
      <MicNotice failure={failure} onTypeInstead={typeInstead} />

      {voice.error !== null && (
        <Alert tone="critical" role="alert">
          {voice.error}
        </Alert>
      )}

      {/*
        A log, announced as it grows. Someone using this feature is by
        definition not watching the screen for a new paragraph to appear.
      */}
      <ol className={styles.history} role="list" aria-live="polite">
        {voice.history.map((entry, index) => (
          <li key={index} className={styles.exchange}>
            <VoiceExchange entry={entry} index={index} voice={voice} />
          </li>
        ))}
      </ol>

      {listening && <p role="status">{t('voice.listening')}</p>}

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
        <p className={styles.answer}>{entry.text}</p>
      </>
    );
  }

  return (
    <>
      <p className={styles.said}>{t('voice.heard', { transcript: entry.said })}</p>

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
            Offered only for something that was going to be written anyway.
            "Where is the rice?" finding no rice is an answer, not an invitation
            to invent one.
          */}
          {WRITING_INTENTS.includes(outcome.intent.kind) && (
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
