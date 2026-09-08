/**
 * Android, through the system's own recognizer.
 *
 * See SpeechPlugin: the system records, so this application declares no
 * microphone permission. One utterance per call - the Intent has no continuous
 * mode, which is why the design has no wake word.
 *
 * TWO ATTEMPTS, AND THEY ARE SEQUENCED HERE RATHER THAN IN JAVA. The plugin
 * takes `preferOffline` and does what it is told with it; the decision to ask
 * twice is TypeScript, where it can be tested without a phone in the room. The
 * first attempt always sends EXTRA_PREFER_OFFLINE, so the ordinary press
 * transcribes on the device and nothing leaves. If that fails and online.ts
 * permits it, the same call runs again without the extra and the system
 * recognizer uses whatever service it has - on most phones, Google's.
 *
 * WHY THE SECOND ATTEMPT IS NOT CONDITIONAL ON A DIAGNOSIS. The Intent flow
 * returns no error extra, so the plugin cannot tell a missing language pack
 * from anything else except by a timing heuristic below API 33. A retry that
 * waited for certainty would never run on the phone this was written for. See
 * online.ts for the three questions it does ask.
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
}

const Speech = registerPlugin<SpeechPlugin>('Speech');

export { isNativeAndroid };

/**
 * One trip through the recognizer dialog, in one mode.
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
