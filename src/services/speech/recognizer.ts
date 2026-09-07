/**
 * The speech seam.
 *
 * Above this, nothing knows whether Android's system recognizer, Chrome's
 * on-device model or nothing at all is listening - the same separation
 * `SqlDriver` gives the database.
 *
 * BY DEFAULT, EVERY IMPLEMENTATION TRANSCRIBES ON THE DEVICE. What actually
 * holds that true, in the order it holds:
 *
 *   - The page's Content-Security-Policy, `connect-src 'self'` in index.html.
 *     An implementation that shipped audio to a server itself would have
 *     nowhere to send it. This is the structural one: it constrains what the
 *     code can do rather than what it may say.
 *   - `scripts/audit-offline.mjs` fails the build when the literal identifier
 *     `SpeechRecognition` appears in `src/` outside webspeech.ts. That is a
 *     text match on one spelling, so it catches the obvious second use site and
 *     not a name assembled at runtime.
 *   - In webspeech.ts, `processLocally = true`, which fails closed. The browser
 *     makes that API's network calls itself, out of reach of the CSP, so this
 *     is the only thing standing between that implementation and Google's
 *     servers.
 *
 * None of the three is sufficient alone, and the second is the weakest.
 *
 * THE ONE WAY AUDIO EVER LEAVES: `SpeechOptions.allowOnline`, which carries the
 * `voiceAllowOnline` setting. It is false unless a person has switched it on in
 * Settings, under a label that names Google rather than saying "online". While
 * it is false nothing changes at all: the Android plugin sends
 * EXTRA_PREFER_OFFLINE and webspeech.ts sets `processLocally = true`, both
 * exactly as before. The default path is not weakened by the existence of the
 * other one - it is the same code, with the same tests on it.
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
   * Whether the audio may leave the device.
   *
   * Absent means no. Every implementation reads it that way, so a caller that
   * forgets the argument gets the private behaviour rather than the other one.
   */
  readonly allowOnline?: boolean;
}

export interface SpeechRecognizer {
  /**
   * Takes the language, because availability is per-language: a device with an
   * English model and no Portuguese one is `ready` for one and `unavailable`
   * for the other. Optional so a caller that only wants "is there a microphone
   * at all" need not pick a language.
   *
   * `options` matters here as well as in `listen`: with `allowOnline` a
   * recognizer that has no local model for the language can still transcribe,
   * so the honest answer to "can this device do it" changes.
   */
  readonly availability: (tag?: string, options?: SpeechOptions) => Promise<SpeechAvailability>;
  /** Offer the platform's own language-pack install, where one exists. */
  readonly install?: (tag: string) => Promise<boolean>;
  /**
   * One utterance. Rejects rather than resolving empty, and rejects with a
   * `SpeechFailureError` so the caller can tell a cancellation from a failure.
   */
  readonly listen: (tag: string, options?: SpeechOptions) => Promise<string>;
}

import { noneRecognizer } from './none';
import { createWebSpeechRecognizer } from './webspeech';
import { createCapacitorRecognizer, isNativeAndroid } from './capacitor';

export {
  SPEECH_FAILURES,
  SpeechFailureError,
  speechFailureReason,
  type SpeechFailure,
} from './failure';

/**
 * The recognizer for this device.
 *
 * Android first: inside the APK the system recognizer is both available and
 * permission-free, and Chrome's WebView does not expose the Web Speech API
 * anyway.
 *
 * `options` is passed through to the availability probe, so a browser whose
 * only working mode is the networked one is selected when - and only when - the
 * user has allowed that mode.
 */
export async function selectRecognizer(
  tag: string,
  options?: SpeechOptions,
): Promise<SpeechRecognizer> {
  if (isNativeAndroid()) return createCapacitorRecognizer();

  const web = createWebSpeechRecognizer();
  return (await web.availability(tag, options)) === 'unavailable' ? noneRecognizer : web;
}
