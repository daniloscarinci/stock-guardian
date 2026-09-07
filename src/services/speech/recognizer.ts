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
 */
export type SpeechAvailability = 'ready' | 'installable' | 'unavailable';

export interface SpeechRecognizer {
  /**
   * Takes the language, because availability is per-language: a device with an
   * English model and no Portuguese one is `ready` for one and `unavailable`
   * for the other. Optional so a caller that only wants "is there a microphone
   * at all" need not pick a language.
   */
  readonly availability: (tag?: string) => Promise<SpeechAvailability>;
  /** Offer the platform's own language-pack install, where one exists. */
  readonly install?: (tag: string) => Promise<boolean>;
  /**
   * One utterance. Rejects rather than resolving empty, and rejects with a
   * `SpeechFailureError` so the caller can tell a cancellation from a failure.
   */
  readonly listen: (tag: string) => Promise<string>;
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
 */
export async function selectRecognizer(tag: string): Promise<SpeechRecognizer> {
  if (isNativeAndroid()) return createCapacitorRecognizer();

  const web = createWebSpeechRecognizer();
  return (await web.availability(tag)) === 'unavailable' ? noneRecognizer : web;
}
