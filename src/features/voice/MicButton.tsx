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
 * `selectRecognizer` is called once per language and per refusal setting rather
 * than once per press, because both change the honest answer to "can this
 * device transcribe" - availability is per-language, and a device with no local
 * model for a language can still transcribe over the network unless its owner
 * has forbidden that.
 *
 * ONE PRESS CAN BE TWO ATTEMPTS, AND THIS COMPONENT DOES NOT KNOW IT. The
 * on-device attempt and the network retry are inside `listen`, where they can
 * be tested without a device; what comes back here is one transcript and
 * whether it was made on the phone. That flag is handed on with the sentence,
 * because the sheet marks the exchange and a person has to be able to see when
 * audio left.
 *
 * WHY THE FAILURE IS KEPT AS A CODE. This component knows what went wrong;
 * `MicNotice` knows what to show for it. A recognizer has no business choosing
 * a sentence in a language it cannot read.
 *
 * THERE IS A STOP BUTTON NOW, AND IT REPLACES SOMETHING THE SYSTEM USED TO
 * PROVIDE. Speech used to arrive through Android's own recognizer screen, which
 * came with a back button; that screen is gone, because the Intent behind it is
 * not handled on the phone this is built for. The recognition service is bound
 * directly instead and shows nothing at all, so a press made by mistake would
 * otherwise hold the microphone open until the recognizer tired of the silence.
 * The stop button is offered only where the platform can honour it - Chrome's
 * recognizer ends a listen on silence by itself and does not implement
 * `cancel`.
 *
 * IT ALSO STOPS WHEN THIS COMPONENT GOES AWAY. Closing the sheet mid-listen
 * used to close a system screen; now it has to close a microphone this process
 * is holding.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Button } from '../../components/ui/primitives';
import { MicIcon } from '../../components/ui/icons';
import {
  selectRecognizer,
  speechFailureReason,
  type SpeechFailure,
  type SpeechRecognizer,
} from '../../services/speech/recognizer';
import { LOCALE_TAGS } from '../../i18n/translate';
import { MicNotice } from './MicNotice';
import styles from './Voice.module.css';

export function MicButton({
  onHeard,
  onTypeInstead,
  busy,
}: {
  /**
   * One utterance, handed over exactly once, with where it was transcribed.
   *
   * This component keeps no transcript. `online` is true when the on-device
   * attempt failed and the network answered instead, and the sheet says so on
   * the exchange.
   */
  readonly onHeard: (transcript: string, online: boolean) => void;
  /** The panel's way out: clear it, and put the cursor where typing works. */
  readonly onTypeInstead: () => void;
  /** Something else in the sheet is already working. */
  readonly busy: boolean;
}) {
  const { t, settings } = useApp();
  const tag = LOCALE_TAGS[settings.language];

  const [failure, setFailure] = useState<SpeechFailure | null>(null);
  const [listening, setListening] = useState(false);

  /*
   * The recognizer currently holding the microphone, if any. A ref rather than
   * state because nothing renders from it: it exists so that unmounting can
   * release a microphone this process opened, and a render caused by that would
   * be a render of a component that is already gone.
   */
  const active = useRef<SpeechRecognizer | null>(null);

  useEffect(
    () => () => {
      void active.current?.cancel?.();
      active.current = null;
    },
    [],
  );

  /**
   * What the caller forbids for one utterance.
   *
   * Only the refusal travels. Whether to transcribe on the device is not a
   * setting and never was: it is what every listen does first. This says
   * whether the failed one may be tried again over the network.
   */
  const options = useMemo(
    () => ({ offlineOnly: settings.voiceOfflineOnly }),
    [settings.voiceOfflineOnly],
  );

  // Probed again when the language or the refusal changes, because both change
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
    active.current = state.recognizer;
    try {
      const heard = await state.recognizer.listen(tag, options);
      onHeard(heard.text, heard.online);
    } catch (cause) {
      // Every reason, named. The bug this replaces read anything it did not
      // recognise as a cancellation, and answered a cancellation with silence.
      setFailure(speechFailureReason(cause));
    } finally {
      active.current = null;
      setListening(false);
    }
  };

  /*
   * Stopping does not settle anything here. It tells the platform to let the
   * microphone go; the listen in flight then rejects with `cancelled`, which
   * `MicNotice` answers with silence and `online.ts` never retries after. One
   * path out, however it was reached.
   */
  const stop = async () => {
    await speech.data?.recognizer.cancel?.();
  };

  const stoppable = listening && speech.data?.recognizer.cancel !== undefined;

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
        {stoppable && (
          <Button
            onClick={() => {
              void stop();
            }}
          >
            {t('voice.stopListening')}
          </Button>
        )}
      </div>
    </>
  );
}
