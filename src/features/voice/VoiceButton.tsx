/**
 * The microphone in the header.
 *
 * It owns the recognizer and the one utterance; the sheet owns everything that
 * happens to the words afterwards. `selectRecognizer` is called once per
 * language and per online opt-in rather than once per press, because both
 * change the honest answer to "can this device transcribe" - availability is
 * per-language, and a device with no local model for a language can still
 * transcribe once its owner has allowed the audio to leave.
 *
 * A device that cannot transcribe still gets this button. It opens the sheet
 * straight to the typed box and says why the microphone will not be used, which
 * is a feature that still works rather than a feature that vanished.
 *
 * WHY THE FAILURE IS PASSED ON AS A CODE. This component knows what went wrong;
 * the sheet knows what to show for it. Turning the reason into a sentence here
 * would put half the interface in the header and leave the panel that offers
 * the install path with nowhere to live.
 */
import { useCallback, useMemo, useState } from 'react';
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
import { VoiceSheet } from './VoiceSheet';

export function VoiceButton() {
  const { t, settings } = useApp();
  const tag = LOCALE_TAGS[settings.language];

  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
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

  // Nothing is probed while the feature is switched off, and the probe is
  // redone when the language or the opt-in changes, because both change the
  // answer. Flipping the setting therefore takes effect on the next press
  // rather than on the next reload.
  const speech = useAsyncData(async () => {
    if (!settings.voiceEnabled) return null;
    const recognizer = await selectRecognizer(tag, options);
    return { recognizer, availability: await recognizer.availability(tag, options) };
  }, [tag, settings.voiceEnabled, options]);

  const onHeardConsumed = useCallback(() => {
    setHeard(null);
  }, []);

  const onFailureDismissed = useCallback(() => {
    setFailure(null);
  }, []);

  // Rendering nothing is the setting's whole meaning. The sheet, and the typed
  // box inside it, open from this button and from nothing else, so switching
  // the setting off removes the feature rather than only its microphone.
  if (!settings.voiceEnabled) return null;

  const press = async () => {
    setOpen(true);

    const state = speech.data;
    /*
     * Only `unavailable` blocks. An `installable` device has a working
     * microphone path - Android's own recognizer will offer to fetch the pack,
     * or the listen will fail with `no-offline-model` and the sheet will say
     * so, which is a better answer than refusing to try.
     */
    if (state === undefined || state === null || state.availability === 'unavailable') {
      setFailure('no-recognizer');
      return;
    }

    setFailure(null);
    setListening(true);
    try {
      setHeard(await state.recognizer.listen(tag, options));
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
      <Button
        variant="ghost"
        iconOnly
        aria-label={t('voice.button')}
        disabled={listening}
        onClick={() => {
          void press();
        }}
      >
        <MicIcon />
      </Button>

      <VoiceSheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        heard={heard}
        onHeardConsumed={onHeardConsumed}
        failure={failure}
        onFailureDismissed={onFailureDismissed}
        listening={listening}
      />
    </>
  );
}
