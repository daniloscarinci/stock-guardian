/**
 * Android, through the recognition service the keyboard uses.
 *
 * See SpeechPlugin: this application now records, holds `RECORD_AUDIO`, and
 * asks for it on the first press of the microphone. It used to fire
 * `ACTION_RECOGNIZE_SPEECH` and declare no permission at all, which was the
 * better design and could not work on the phone this is built for - the Intent
 * is handled by Google Voice Search, which that phone does not have, while the
 * keyboard's voice typing works on it perfectly. One utterance per call; there
 * is no continuous mode here and therefore no wake word.
 *
 * TWO ATTEMPTS, AND THEY ARE STILL SEQUENCED HERE RATHER THAN IN JAVA. The
 * plugin takes `preferOffline` and does what it is told with it; the decision
 * to ask twice is TypeScript, where it can be tested without a phone in the
 * room. The first attempt always asks for on-device transcription, so the
 * ordinary press stays on the phone. If that fails and online.ts permits it,
 * the same call runs again without the offline requirement and the system
 * recognizer uses whatever service it has - on most phones, Google's.
 *
 * WHY THE SECOND ATTEMPT IS NOW CONDITIONAL ON A DIAGNOSIS. It used to fire on
 * anything that was not a cancel, because the Intent flow returned no error and
 * there was nothing to condition on. `RecognitionListener` names the reason, so
 * online.ts retries the failures a different recognizer could get past and
 * leaves alone the ones that mean nobody spoke or nobody may listen.
 *
 * WHY `isNativeAndroid` IS IMPORTED RATHER THAN DECLARED. This file and
 * ringer.ts used to be one module, and the microphone's removal left the ringer
 * half behind - `speak.ts` needs it, and a phone on silent must not be talked
 * over. The microphone is back and the two have stayed apart: reading the
 * ringer switch is a fact about the speaker, and nothing about playing a
 * sentence should pull a recognizer into its module graph. What they still
 * share is one predicate, and one copy of it cannot drift from the other.
 */
import { registerPlugin } from '@capacitor/core';
import type {
  SpeechAvailability,
  SpeechOptions,
  SpeechRecognizer,
  Transcript,
} from './recognizer';
import { SpeechFailureError, asSpeechFailure } from './failure';
import { mayRetryOnline, reportedFailure } from './online';
import { isNativeAndroid } from './ringer';

/** What the plugin established about a model for the language it was asked about. */
type OnDeviceState = 'installed' | 'missing' | 'unknown';

interface SpeechPlugin {
  listen: (options: { lang: string; preferOffline: boolean }) => Promise<{ transcript: string }>;
  availability: (options: { lang: string }) => Promise<{
    state: SpeechAvailability;
    onDevice?: OnDeviceState;
  }>;
  cancel: () => Promise<void>;
  openSettings: () => Promise<void>;
}

const Speech = registerPlugin<SpeechPlugin>('Speech');

export { isNativeAndroid };

/**
 * Opens this application's page in Android's settings.
 *
 * The only way back from a permanently refused microphone: Android will not
 * show the prompt again, so an application that kept asking would be asking
 * into a void. Resolves false anywhere it cannot be done, including every
 * browser, so a caller may offer it without first asking what it is running on.
 */
export async function openAppSettings(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  return Speech.openSettings()
    .then(() => true)
    .catch(() => false);
}

/**
 * One trip through the recognizer, in one mode.
 *
 * `preferOffline` is sent explicitly on both attempts rather than left out on
 * one, so the plugin's default and this module's cannot drift apart.
 */
async function attempt(tag: string, preferOffline: boolean): Promise<string> {
  let transcript: string;
  try {
    ({ transcript } = await Speech.listen({ lang: tag, preferOffline }));
  } catch (cause) {
    throw asSpeechFailure(cause);
  }

  // A resolve with nothing in it should not be possible - the plugin rejects
  // with no-match instead - but a recognizer that returns a space must not
  // become a command.
  if (transcript.trim() === '') {
    throw new SpeechFailureError('no-match', 'Nothing was heard.');
  }
  return transcript;
}

export function createCapacitorRecognizer(): SpeechRecognizer {
  return {
    async availability(tag = 'pt-BR'): Promise<SpeechAvailability> {
      if (!isNativeAndroid()) return 'unavailable';
      return Speech.availability({ lang: tag })
        .then((r) => r.state)
        .catch(() => 'unavailable');
    },

    /**
     * Stops a listen in progress and closes the microphone.
     *
     * The Intent flow got this for free - the system's dialog had a back
     * button. A bound recognizer shows no screen of its own, so without this
     * there would be no way to take a press back, and `cancelled` - the one
     * code the interface answers with silence, and the one the retry never
     * fires after - could never happen on Android at all.
     */
    async cancel(): Promise<void> {
      if (!isNativeAndroid()) return;
      await Speech.cancel().catch(() => undefined);
    },

    async listen(tag: string, options?: SpeechOptions): Promise<Transcript> {
      let first: SpeechFailureError;
      try {
        return { text: await attempt(tag, true), online: false };
      } catch (cause) {
        first = asSpeechFailure(cause);
      }

      if (!mayRetryOnline(first, options)) throw first;

      // Once. A failing retry is not tried again - it reports, and the log of
      // this feature is long enough without a loop in it.
      try {
        return { text: await attempt(tag, false), online: true };
      } catch (again) {
        throw reportedFailure(first, again);
      }
    },
  };
}
