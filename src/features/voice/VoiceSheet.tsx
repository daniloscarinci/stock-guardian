/**
 * The ask sheet: what was asked, what came of it, and a box to type in.
 *
 * Built on `components/ui/Dialog`, which is the native `<dialog>` element. That
 * is where focus trapping, Escape-to-close, inertness of the page behind and
 * the bottom-sheet behaviour on a phone come from; none of it is reimplemented
 * here.
 *
 * THE MICROPHONE IS GONE AND THE SPEAKER IS NOT. Android's recognizer refuses
 * EXTRA_PREFER_OFFLINE with no offline Portuguese pack installed - the phone
 * this was built for - so listening was dropped rather than left to fail in
 * silence. Reading an answer aloud works, is tested, and is the half that is
 * useful with your hands full, so it stays: `createSpeaker` for the setting,
 * `androidIsSilent` for the switch on the side of the phone.
 *
 * The typed box was never a fallback. It is the whole feature, on every
 * platform, and it now has two engines behind it - see `useVoice`.
 *
 * The component holds no logic. `useVoice` owns the state machine and is tested
 * through this file's typed path.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Dialog } from '../../components/ui/Dialog';
import { Alert, Button } from '../../components/ui/primitives';
import { TextField } from '../../components/ui/Field';
import { createSpeaker } from '../../services/speech/speak';
import { androidIsSilent } from '../../services/speech/ringer';
import { CREATABLE_INTENTS } from '../../voice/intents';
import { useVoice, type Exchange, type Voice } from './useVoice';
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

export function VoiceSheet({ open, onClose }: VoiceSheetProps) {
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
      {voice.error !== null && (
        <Alert tone="critical" role="alert">
          {voice.error}
        </Alert>
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
        <p className={styles.answer}>{entry.text}</p>
      </>
    );
  }

  return (
    <>
      <p className={styles.said}>{t('voice.heard', { transcript: entry.said })}</p>

      {/*
        Claude was asked and could not answer, so the twelve rules did. Said
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
            to invent one - and neither is a move whose CELLAR was not found, or
            a minimum set on stock that does not exist. `CREATABLE_INTENTS` says
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
