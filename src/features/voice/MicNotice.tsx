/**
 * Why the microphone produced nothing.
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
 * The missing-model case gets a panel rather than a sentence, because it is the
 * only failure with something the user can actually do about it: the install
 * path, and the typed box that works regardless. The panel POINTS at the online
 * setting and does not touch it. Nothing here switches that on; only the person
 * does, in Settings, under a label that names Google.
 */
import { useEffect, useId, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Alert, Button } from '../../components/ui/primitives';
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
  const { t } = useApp();
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
        A pointer, not a switch. It says where the setting is and what it costs,
        and this component never writes it - the one control in the application
        that can send audio off the device is turned on by its owner or not at
        all.
      */}
      <p className={styles.hint}>{t('voice.allowOnlineHint')}</p>
    </Alert>
  );
}
