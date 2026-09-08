/**
 * The speech seam.
 *
 * Above this, nothing knows whether Android's recognition service, Chrome's
 * on-device model or nothing at all is listening - the same separation
 * `SqlDriver` gives the database.
 *
 * EVERY LISTEN STARTS ON THE DEVICE. That is the standard and it is not
 * configurable: the first attempt always asks the platform to transcribe
 * locally, so the ordinary press of the microphone sends nothing anywhere and
 * works with the radio off. What holds it true, in the order it holds:
 *
 *   - The page's Content-Security-Policy in index.html, whose `connect-src`
 *     names `'self'` and one host, `https://api.anthropic.com`. An
 *     implementation that shipped audio to a speech server itself would have
 *     nowhere to send it. This is the structural one: it constrains what the
 *     code can do rather than what it may say.
 *   - `scripts/audit-offline.mjs` fails the build when the literal identifier
 *     `SpeechRecognition` appears in `src/` outside webspeech.ts. That is a
 *     text match on one spelling, so it catches the obvious second use site and
 *     not a name assembled at runtime.
 *   - In webspeech.ts, the first attempt sets `processLocally = true`, which
 *     fails closed. The browser makes that API's network calls itself, out of
 *     reach of the CSP, so this is the only thing standing between that
 *     implementation and Google's servers.
 *
 * None of the three is sufficient alone, and the second is the weakest.
 *
 * WHEN THE ON-DEVICE ATTEMPT FAILS, THE PHONE TRIES AGAIN OVER THE NETWORK.
 * Once, only when the device reports a connection, and only for the failures a
 * different recognizer could plausibly get past - never after a cancel, never
 * after nobody spoke, and never after the microphone was refused. The whole of
 * that policy is in online.ts; the two recognizers share it rather than each
 * having an opinion. This is a change of standard, made deliberately: the
 * requirement used to be absolute, and on a phone with no offline Portuguese
 * pack it produced a microphone that refused every single press. An absolute
 * rule nobody can use is not a stronger promise, it is a dead button.
 *
 * Two things keep that honest, and both are load-bearing:
 *
 *   - `Transcript.online` says which attempt answered, and the sheet marks the
 *     exchange. Audio never leaves without the person being told it did.
 *   - `SpeechOptions.offlineOnly` carries the `voiceOfflineOnly` setting, which
 *     restores the absolute behaviour in one press. Nothing in this application
 *     ever writes that setting: a failure may put the switch in front of
 *     somebody, and only a person flips it.
 */
export type SpeechAvailability = 'ready' | 'installable' | 'unavailable';

/**
 * What the caller permits for one utterance.
 *
 * An argument rather than construction state because the answer belongs to the
 * moment the button is pressed: the setting can change between two presses, and
 * a recognizer built an hour ago must not still be acting on what it was told
 * then.
 */
export interface SpeechOptions {
  /**
   * The user has refused the network entirely.
   *
   * Absent means the fallback stands: the on-device attempt still runs first
   * and still answers most presses, and a failed one may be tried again over
   * the network. Set, nothing is ever retried and a device with no model for
   * the language simply has no microphone - which is exactly what somebody
   * switching this on is asking for.
   *
   * It is named for the restriction rather than for the permission so that
   * reading it at a call site states what it does: `offlineOnly` means the
   * recording never leaves this device.
   */
  readonly offlineOnly?: boolean;
}

/** One utterance, and where it was turned into text. */
export interface Transcript {
  /** What was heard. Never empty - a recognizer that hears nothing rejects. */
  readonly text: string;
  /**
   * True when the on-device attempt failed and a second one over the network
   * produced this instead.
   *
   * Carried up to the sheet, which marks the exchange. A person has to be able
   * to tell which path answered; silent network use is not this application's
   * character, and a promise nobody can check is not a promise.
   */
  readonly online: boolean;
}

export interface SpeechRecognizer {
  /**
   * Takes the language, because availability is per-language: a device with an
   * English model and no Portuguese one is `ready` for one and `unavailable`
   * for the other. Optional so a caller that only wants "is there a microphone
   * at all" need not pick a language.
   *
   * `options` matters here as well as in `listen`: a recognizer with no local
   * model for the language can still transcribe over the network, so the honest
   * answer to "can this device do it" is `ready` - and becomes `unavailable`
   * again the moment `offlineOnly` is set.
   */
  readonly availability: (tag?: string, options?: SpeechOptions) => Promise<SpeechAvailability>;
  /** Offer the platform's own language-pack install, where one exists. */
  readonly install?: (tag: string) => Promise<boolean>;
  /**
   * Stop a listen in progress and release the microphone.
   *
   * Optional because it is not everyone's to offer. Android binds the
   * recognition service itself and shows no screen of its own, so somebody who
   * pressed the microphone by mistake needs a way back and the process needs
   * telling to let the microphone go. Chrome's recognizer ends a listen on
   * silence by itself and is not given one.
   *
   * A cancelled listen rejects with `cancelled`, which the interface answers
   * with silence and the retry never fires after.
   */
  readonly cancel?: () => Promise<void>;
  /**
   * One utterance. Rejects rather than resolving empty, and rejects with a
   * `SpeechFailureError` so the caller can tell a cancellation from a failure.
   *
   * Resolves with where it was transcribed as well as what was said, because
   * the interface has to say so.
   */
  readonly listen: (tag: string, options?: SpeechOptions) => Promise<Transcript>;
}

import { noneRecognizer } from './none';
import { createWebSpeechRecognizer } from './webspeech';
import { createCapacitorRecognizer, isNativeAndroid, openAppSettings } from './capacitor';

export { openAppSettings };

export {
  SPEECH_FAILURES,
  SpeechFailureError,
  asSpeechFailure,
  speechFailureReason,
  type SpeechFailure,
} from './failure';

/**
 * The recognizer for this device.
 *
 * Android first: inside the APK the recognition service is what actually
 * transcribes, and Chrome's WebView does not expose the Web Speech API anyway.
 *
 * `options` is passed through to the availability probe, so a browser whose
 * only working mode is the networked one is refused when - and only when - the
 * user has forbidden that mode.
 */
export async function selectRecognizer(
  tag: string,
  options?: SpeechOptions,
): Promise<SpeechRecognizer> {
  if (isNativeAndroid()) return createCapacitorRecognizer();

  const web = createWebSpeechRecognizer();
  return (await web.availability(tag, options)) === 'unavailable' ? noneRecognizer : web;
}
