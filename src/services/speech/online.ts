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
 *   Was it a deliberate cancel? Pressing back is not a failure to work around.
 *   Sending a recording away because somebody changed their mind is the worst
 *   thing this feature could do, so `cancelled` stops here and stops here
 *   first.
 *
 *   Is there a network at all? See `deviceIsOnline`.
 *
 * WHY THE RETRY IS NOT AIMED MORE PRECISELY. `ACTION_RECOGNIZE_SPEECH` returns
 * no error extra, and the two Android constants that name a missing language
 * pack are delivered to a `RecognitionListener` - the API that needs
 * RECORD_AUDIO, which this application deliberately does not hold. Below API 33
 * the diagnosis is a timing heuristic. A retry that fires on a precise
 * diagnosis would therefore not fire on the phone this exists for. So it fires
 * on any failure but a cancel: a wasted retry costs a second, and a missed one
 * is a microphone that does nothing, which is the bug being fixed for the third
 * time.
 */
import type { SpeechOptions } from './recognizer';
import { asSpeechFailure, type SpeechFailureError } from './failure';

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

/** The policy in the class comment, applied to one failed attempt. */
export function mayRetryOnline(cause: unknown, options?: SpeechOptions): boolean {
  if (options?.offlineOnly === true) return false;
  if (asSpeechFailure(cause).reason === 'cancelled') return false;
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
 * The exception is a cancelled retry. Somebody who pressed back on the second
 * dialog has said "never mind", and answering that with a warning panel is
 * precisely the banner-after-a-cancellation this feature has a rule against.
 */
export function reportedFailure(first: SpeechFailureError, retry: unknown): SpeechFailureError {
  const second = asSpeechFailure(retry);
  return second.reason === 'cancelled' ? second : first;
}
