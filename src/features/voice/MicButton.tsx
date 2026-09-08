/**
 * The microphone, and everything that can go wrong with one.
 *
 * IT IS IN THE SHEET RATHER THAN IN THE HEADER, AND THAT IS THE CHANGE. The
 * header button used to be the microphone: pressing it opened the sheet and
 * started a listen in the same gesture. On the phone this feature was built for
 * - no offline Portuguese pack, and the recognizer refusing every offline
 * request - that meant a warning panel on top of the box every single time
 * somebody opened the sheet to type. The failure that killed this feature was a
 * control that appeared dead; burying the control that works under an
 * explanation of the one that does not is the same mistake wearing a hat.
 *
 * So the header opens the sheet, and this asks to listen. Nothing explains
 * itself until somebody has actually asked to speak, and then it explains
 * itself completely.
 *
 * `selectRecognizer` is called once per language and per online opt-in rather
 * than once per press, because both change the honest answer to "can this
 * device transcribe" - availability is per-language, and a device with no local
 * model for a language can still transcribe once its owner has allowed the
 * audio to leave.
 *
 * WHY THE FAILURE IS KEPT AS A CODE. This component knows what went wrong;
 * `MicNotice` knows what to show for it. A recognizer has no business choosing
 * a sentence in a language it cannot read.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Button } from '../../components/ui/primitives';
import { MicIcon } from '../../components/ui/icons';
import {
  selectRecognizer,
  speechFailureReason,
  type SpeechFailure,
} from '../../services/speech/recognizer';
import { LOCALE_TAGS } from '../../i18n/translate';
import { MicNotice } from './MicNotice';
import styles from './Voice.module.css';

export function MicButton({
  onHeard,
  onTypeInstead,
  busy,
}: {
  /** One utterance, handed over exactly once. This component keeps no transcript. */
  readonly onHeard: (transcript: string) => void;
  /** The panel's way out: clear it, and put the cursor where typing works. */
  readonly onTypeInstead: () => void;
  /** Something else in the sheet is already working. */
  readonly busy: boolean;
}) {
  const { t, settings } = useApp();
  const tag = LOCALE_TAGS[settings.language];

  const [failure, setFailure] = useState<SpeechFailure | null>(null);
  const [listening, setListening] = useState(false);

  /**
   * What the caller permits for one utterance.
   *
   * Absent means no, everywhere below this. The default path is unchanged by
   * the existence of the other one: while the setting is off, this object says
   * `allowOnline: false` and every implementation keeps the audio on the phone.
   */
  const options = useMemo(
    () => ({ allowOnline: settings.voiceAllowOnline }),
    [settings.voiceAllowOnline],
  );

  // Probed again when the language or the opt-in changes, because both change
  // the answer. Flipping the switch on the panel therefore takes effect on the
  // next press rather than on the next reload.
  const speech = useAsyncData(async () => {
    const recognizer = await selectRecognizer(tag, options);
    return { recognizer, availability: await recognizer.availability(tag, options) };
  }, [tag, options]);

  const press = async () => {
    const state = speech.data;
    /*
     * Only `unavailable` blocks. An `installable` device has a working
     * microphone path - Android's own recognizer will offer to fetch the pack,
     * or the listen will fail with `no-offline-model` and the panel will say
     * so, which is a better answer than refusing to try.
     */
    if (state === undefined || state.availability === 'unavailable') {
      setFailure('no-recognizer');
      return;
    }

    setFailure(null);
    setListening(true);
    try {
      onHeard(await state.recognizer.listen(tag, options));
    } catch (cause) {
      // Every reason, named. The bug this replaces read anything it did not
      // recognise as a cancellation, and answered a cancellation with silence.
      setFailure(speechFailureReason(cause));
    } finally {
      setListening(false);
    }
  };

  return (
    <>
      <MicNotice
        failure={failure}
        onTypeInstead={() => {
          setFailure(null);
          onTypeInstead();
        }}
      />

      <div className={styles.micRow}>
        <Button
          iconOnly
          aria-label={t('voice.micButton')}
          disabled={listening || busy}
          onClick={() => {
            void press();
          }}
        >
          <MicIcon />
        </Button>
        {listening && <p role="status">{t('voice.listening')}</p>}
      </div>
    </>
  );
}
