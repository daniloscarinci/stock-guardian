/**
 * Whether a listen that failed on the device gets a second try over the
 * network.
 *
 * OFFLINE IS THE STANDARD; THE INTERNET IS THE FALLBACK. Every listen starts on
 * the device, and this module decides only what happens after that attempt has
 * come back with nothing. It is the whole of the policy, so both recognizers
 * behave the same way and one file has to be read to know what the microphone
 * does.
 *
 * Three questions, in this order, and every one has to answer yes:
 *
 *   Has the user forbidden it? `voiceOfflineOnly` is the whole of that, and it
 *   is asked first because it is the only one of the three a person chose.
 *
 *   Is this failure one a different recognizer could get past? See `RETRIED`.
 *
 *   Is there a network at all? See `deviceIsOnline`.
 *
 * THE SECOND QUESTION IS NEW, AND IT USED TO BE "WAS IT A CANCEL?". The retry
 * fired on any failure but a deliberate cancel, and it had to: Android's
 * `ACTION_RECOGNIZE_SPEECH` returned no error, so a retry that waited for a
 * diagnosis would never have fired on the phone this was built for. That flow
 * is gone. `SpeechPlugin` now binds `SpeechRecognizer` directly and
 * `RecognitionListener.onError` names the reason, so the retry can be aimed
 * instead of sprayed.
 */
import type { SpeechOptions } from './recognizer';
import { asSpeechFailure, type SpeechFailure, type SpeechFailureError } from './failure';

/**
 * The failures a second recognizer could plausibly get past.
 *
 * The test for membership is one question: would asking a DIFFERENT service,
 * with the network this time, plausibly produce the sentence? Everything else
 * is left out, and leaving it out is what makes this list worth having.
 *
 *   `no-offline-model` is the whole reason the fallback exists. It is
 *   `ERROR_LANGUAGE_UNAVAILABLE` and `ERROR_LANGUAGE_NOT_SUPPORTED`, the two
 *   constants that never reached an Intent result, and a networked recognizer
 *   has the language the device does not.
 *
 *   `network` is `ERROR_SERVER`, `ERROR_SERVER_DISCONNECTED` and both network
 *   errors. An on-device recognizer should never produce these; one that does
 *   has answered about a service, not about the words.
 *
 *   `failed` is `ERROR_CLIENT`, `ERROR_AUDIO`, the watchdogs, and anything the
 *   platform declines to name. It is in the list deliberately: an on-device
 *   recognizer that cannot bind reports `ERROR_CLIENT`, and that is a phone
 *   this feature has to work on. A wasted retry costs a second; treating this
 *   as terminal costs the microphone on exactly the device the retry is for.
 *
 * What is NOT here, and why:
 *
 *   `no-match` and `speech-timeout` - which arrive together as `no-match` -
 *   mean the person did not speak, or was not understood. The retry is a fresh
 *   recording, not a second look at the same audio, so it would open the
 *   microphone again and wait for somebody who has already stopped talking.
 *
 *   `cancelled` is somebody changing their mind. Sending a recording away
 *   because of that is the worst thing this feature could do.
 *
 *   `permission-denied` and `permission-blocked` mean there is no microphone to
 *   record with at all. A second attempt is a second refusal.
 *
 *   `no-recognizer` means nothing on the device transcribes. The fallback uses
 *   the same absent service.
 *
 *   `busy` means something else holds the microphone, and it still will a
 *   moment later. The sentence for it asks the person to close that instead.
 */
const RETRIED: ReadonlySet<SpeechFailure> = new Set<SpeechFailure>([
  'no-offline-model',
  'network',
  'failed',
]);

/**
 * Whether there is any point trying the network.
 *
 * `navigator.onLine` reports the radio, not whether anything is reachable, so
 * it is read as a hint in one direction only: a definite `false` stops the
 * retry, and everything else - `true`, a missing property, no `navigator` at
 * all - lets it run. Being wrong that way costs a second and a failure that was
 * already going to be reported; being wrong the other way costs the feature.
 */
export function deviceIsOnline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
  return nav?.onLine !== false;
}

/** The policy in the module comment, applied to one failed attempt. */
export function mayRetryOnline(cause: unknown, options?: SpeechOptions): boolean {
  if (options?.offlineOnly === true) return false;
  if (!RETRIED.has(asSpeechFailure(cause).reason)) return false;
  return deviceIsOnline();
}

/**
 * Which of two failures the interface is told about.
 *
 * The first one, ordinarily. The on-device attempt is the path this application
 * stands behind, its failure is the one a person can act on - a missing pack
 * has install steps under it - and the retry was an extra nobody asked for. It
 * also means a phone with the radio off and a phone whose retry failed report
 * the same thing for the same situation.
 *
 * The exception is a cancelled retry. Somebody who pressed stop during the
 * second attempt has said "never mind", and answering that with a warning panel
 * is precisely the banner-after-a-cancellation this feature has a rule against.
 */
export function reportedFailure(first: SpeechFailureError, retry: unknown): SpeechFailureError {
  const second = asSpeechFailure(retry);
  return second.reason === 'cancelled' ? second : first;
}
