/**
 * The microphone in the header.
 *
 * It owns the recognizer and the one utterance; the sheet owns everything that
 * happens to the words afterwards. `selectRecognizer` is called once per
 * language rather than once per press, because availability is per-language -
 * a device with an English model and no Portuguese one is ready for one and
 * unavailable for the other.
 *
 * A device that cannot transcribe still gets this button. It opens the sheet
 * straight to the typed box and says why the microphone will not be used, which
 * is a feature that still works rather than a feature that vanished.
 */
import { useCallback, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Button } from '../../components/ui/primitives';
import { MicIcon } from '../../components/ui/icons';
import { selectRecognizer } from '../../services/speech/recognizer';
import { LOCALE_TAGS } from '../../i18n/translate';
import { VoiceSheet } from './VoiceSheet';

/**
 * The Android plugin rejects with bare strings.
 *
 * `cancelled` is the user pressing back on the system dialog, and the right
 * response to "never mind" is nothing at all - an error banner for a deliberate
 * cancellation trains people to ignore error banners. `empty` is a real dead
 * end and gets a sentence a person can act on.
 */
function reasonFor(cause: unknown): 'cancelled' | 'empty' | 'failed' {
  const text = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  if (text.includes('cancel')) return 'cancelled';
  // Both spellings reach here: the plugin's bare "empty", and the message the
  // recognizers throw when a transcript comes back with nothing in it.
  if (text.includes('empty') || text.includes('nothing was heard')) return 'empty';
  return 'failed';
}

export function VoiceButton() {
  const { t, settings } = useApp();
  const tag = LOCALE_TAGS[settings.language];

  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [listening, setListening] = useState(false);

  // Nothing is probed while the feature is switched off, and the probe is
  // redone when the language changes because availability is per-language.
  const speech = useAsyncData(async () => {
    if (!settings.voiceEnabled) return null;
    const recognizer = await selectRecognizer(tag);
    return { recognizer, availability: await recognizer.availability(tag) };
  }, [tag, settings.voiceEnabled]);

  const onHeardConsumed = useCallback(() => {
    setHeard(null);
  }, []);

  // Rendering nothing is the setting's whole meaning. The sheet, and the typed
  // box inside it, open from this button and from nothing else, so switching
  // the setting off removes the feature rather than only its microphone.
  if (!settings.voiceEnabled) return null;

  const press = async () => {
    setOpen(true);

    const state = speech.data;
    if (state === undefined || state === null || state.availability === 'unavailable') {
      setNotice(t('voice.unavailable'));
      return;
    }

    setNotice(null);
    setListening(true);
    try {
      setHeard(await state.recognizer.listen(tag));
    } catch (cause) {
      switch (reasonFor(cause)) {
        case 'cancelled':
          break;
        case 'empty':
          setNotice(t('voice.nothingHeard'));
          break;
        case 'failed':
          setNotice(t('voice.listenFailed'));
          break;
      }
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
        notice={notice}
        listening={listening}
      />
    </>
  );
}
