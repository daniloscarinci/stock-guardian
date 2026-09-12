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
 * IT RENDERS AT THE TOP OF THE SCROLL BOX, NOT UNDER THE BUTTON IT IS ABOUT.
 * `MicButton` used to render this above itself and the two moved as one unit;
 * they are split now because the button belongs in the composer row Dialog pins
 * to the bottom edge and this does not. The panel below runs to a paragraph, two
 * buttons, a collapsible explanation, a settings switch and a conditional hint,
 * which is up to two hundred pixels that would be taken straight off the log and
 * held there until it was dismissed. A button is a control and a control belongs
 * beside the other way in; this is a message, and messages belong where the
 * reading happens. `VoiceSheet` holds the failure code and places both.
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
 *
 * THE MICROPHONE PERMISSION IS A THIRD PANEL, AND IT IS NEW. This application
 * did not use to hold `RECORD_AUDIO` at all: speech arrived through Android's
 * own recognizer screen, so there was nothing to refuse. That design could not
 * work on the phone this is built for, the permission is now asked for on the
 * first press, and a refusal has to be somebody's to explain.
 *
 * A refusal is not a fault, so it is said plainly and once. `permission-denied`
 * is a sentence: the system will ask again on the next press, so the way
 * forward is the microphone itself. `permission-blocked` is the panel below,
 * because Android will NOT ask again - a press would raise no dialog at all -
 * and the only way back is this application's own page in Settings. Offering a
 * button that opens it is the difference between a dead control and a control
 * with an answer under it.
 */
import { useEffect, useId, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Alert, Button } from '../../components/ui/primitives';
import { SwitchRow } from '../../components/ui/Field';
import { openAppSettings, type SpeechFailure } from '../../services/speech/recognizer';
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
  Record<
    Exclude<SpeechFailure, 'cancelled' | 'no-offline-model' | 'permission-blocked'>,
    TranslationKey
  >
> = {
  'no-recognizer': 'voice.unavailable',
  network: 'voice.networkFailed',
  'no-match': 'voice.nothingHeard',
  busy: 'voice.busy',
  'permission-denied': 'voice.permissionDenied',
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

  /*
   * Refused for good. Nothing here re-asks: a request would return instantly
   * with no dialog shown, which is how a control comes to look dead. The button
   * opens the one screen that can undo it.
   */
  if (failure === 'permission-blocked') {
    return (
      <Alert tone="warning" role="status">
        <p>{t('voice.permissionBlocked')}</p>

        <div className={styles.noticeActions}>
          <Button
            onClick={() => {
              void openAppSettings();
            }}
          >
            {t('voice.openAppSettings')}
          </Button>
          <Button variant="primary" onClick={onTypeInstead}>
            {t('voice.typeCommandInstead')}
          </Button>
        </div>
      </Alert>
    );
  }

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
