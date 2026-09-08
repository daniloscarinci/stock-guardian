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
 * THE MISSING-MODEL PANEL IS RARER THAN IT WAS, AND IT SAYS SOMETHING DIFFERENT
 * WHEN IT APPEARS. A listen that fails on the device is now tried once more
 * over the internet, so there are only two ways to reach this panel: the phone
 * had no connection to fall back on, or the user has asked for on-device
 * transcription only. Those are different situations, so the sentence at the
 * top is different for each.
 *
 * The switch is on the panel either way, and the line under it says which of
 * the two this is. Showing it only when it is on would make it vanish under the
 * finger that just turned it off; hiding what state it is in would leave
 * somebody wondering whether turning it ON is the fix, when it is the opposite.
 * So the switch stays and the panel says, in a sentence, what it is currently
 * doing.
 *
 * IT NEVER FLIPS ITSELF. This component renders the switch and writes the
 * setting when - and only when - somebody presses it. There is no retry that
 * quietly changes it, no "we turned this off for you", and no path that reaches
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
      <p>
        {t(
          settings.voiceOfflineOnly ? 'voice.noOfflineModelOfflineOnly' : 'voice.noOfflineModel',
        )}
      </p>

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
        The restriction, offered where it is met rather than named in a
        sentence about a settings screen. It is the same setting and the same
        words as the row in Settings, so a person who finds it twice reads the
        same promise twice. Nothing changes it without a press.
      */}
      <div className={styles.noticeSwitch}>
        <SwitchRow
          label={t('voice.settingOfflineOnly')}
          help={t('voice.settingOfflineOnlyHelp')}
          checked={settings.voiceOfflineOnly}
          onChange={(on) => {
            void updateSettings({ voiceOfflineOnly: on });
          }}
        />
      </div>

      {!settings.voiceOfflineOnly && <p className={styles.hint}>{t('voice.offlineOnlyOff')}</p>}
    </Alert>
  );
}
