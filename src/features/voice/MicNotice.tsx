/**
 * Why the microphone produced nothing, and the one thing that can be done
 * about it.
 *
 * The bug this exists to end was reported from a real phone as "the mobile
 * seems to be blocking the mic". It was not blocking anything: the Android
 * plugin answered every unsuccessful listen with "cancelled", and a deliberate
 * cancellation is the one failure this interface answers with silence. So a
 * device with no offline speech pack pressed the button and got nothing at all
 * - no sentence, no banner, no way to find out.
 *
 * `speechFailureReason` now names the reason, and every reason but one is said
 * out loud here. Only `cancelled` stays silent, because a banner after "never
 * mind" teaches people to ignore banners.
 *
 * THE MISSING-MODEL CASE CARRIES THE SWITCH, AND THAT IS THE SECOND FIX. It
 * used to carry a sentence pointing at Settings, which is the failure repeating
 * itself one level up: somebody who has just been told a word they do not know
 * ("offline speech pack") is not going to go looking through a settings screen
 * for a row they have never seen. The switch is here, on the panel, next to the
 * explanation, labelled with what it does and who receives the audio.
 *
 * IT NEVER FLIPS ITSELF. This component renders the switch and writes the
 * setting when - and only when - somebody presses it. There is no retry that
 * quietly enables it, no "we turned this on for you", and no path that reaches
 * `updateSettings` without a press. That is the whole difference between
 * offering a choice and making one on a person's behalf.
 */
import { useEffect, useId, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Alert, Button } from '../../components/ui/primitives';
import { SwitchRow } from '../../components/ui/Field';
import type { SpeechFailure } from '../../services/speech/recognizer';
import type { TranslationKey } from '../../i18n/types';
import styles from './Voice.module.css';

/**
 * A reason, and the sentence for it.
 *
 * A total record over the reasons that get a plain sentence, so adding a member
 * to `SpeechFailure` is a compile error here rather than another failure that
 * renders as nothing.
 */
const MESSAGES: Readonly<
  Record<Exclude<SpeechFailure, 'cancelled' | 'no-offline-model'>, TranslationKey>
> = {
  'no-recognizer': 'voice.unavailable',
  network: 'voice.networkFailed',
  'no-match': 'voice.nothingHeard',
  busy: 'voice.busy',
  failed: 'voice.listenFailed',
};

export function MicNotice({
  failure,
  onTypeInstead,
}: {
  readonly failure: SpeechFailure | null;
  /** Dismisses the panel and puts the cursor in the typed box. */
  readonly onTypeInstead: () => void;
}) {
  const { t, settings, updateSettings } = useApp();
  const stepsId = useId();
  const [showSteps, setShowSteps] = useState(false);

  // A new failure starts with the steps folded away again. Leaving them open
  // from a previous press would show install instructions under a sentence
  // about a busy microphone.
  useEffect(() => {
    setShowSteps(false);
  }, [failure]);

  if (failure === null) return null;
  // The deliberate one. Nothing is shown for "never mind".
  if (failure === 'cancelled') return null;

  if (failure !== 'no-offline-model') {
    return (
      <Alert tone="info" role="status">
        {t(MESSAGES[failure])}
      </Alert>
    );
  }

  return (
    <Alert tone="warning" role="status">
      <p>{t('voice.noOfflineModel')}</p>

      <div className={styles.noticeActions}>
        <Button
          aria-expanded={showSteps}
          aria-controls={stepsId}
          onClick={() => {
            setShowSteps((open) => !open);
          }}
        >
          {t('voice.installHow')}
        </Button>
        <Button variant="primary" onClick={onTypeInstead}>
          {t('voice.typeCommandInstead')}
        </Button>
      </div>

      <p className={styles.steps} id={stepsId} hidden={!showSteps}>
        {t('voice.installSteps')}
      </p>

      {/*
        The other way out, offered where the problem was met rather than named
        in a sentence about a settings screen. It is the same setting and the
        same words as the row in Settings, so a person who finds it twice reads
        the same promise twice.
      */}
      <div className={styles.noticeSwitch}>
        <SwitchRow
          label={t('voice.settingAllowOnline')}
          help={t('voice.settingAllowOnlineHelp')}
          checked={settings.voiceAllowOnline}
          onChange={(on) => {
            void updateSettings({ voiceAllowOnline: on });
          }}
        />
      </div>

      {settings.voiceAllowOnline && <p className={styles.hint}>{t('voice.allowOnlineOn')}</p>}
    </Alert>
  );
}
