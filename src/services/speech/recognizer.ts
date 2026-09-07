/**
 * The speech seam.
 *
 * Above this, nothing knows whether Android's system recognizer, Chrome's
 * on-device model or nothing at all is listening - the same separation
 * `SqlDriver` gives the database.
 *
 * Every implementation transcribes ON THE DEVICE. There is no implementation
 * that reaches a server, and adding one would fail `npm run build`.
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
  /** One utterance. Rejects rather than resolving empty. */
  readonly listen: (tag: string) => Promise<string>;
}
