/**
 * What a thing that speaks has to be able to do.
 *
 * The interface both sides of the seam implement - `websynthesis.ts` in a
 * browser, `tts.ts` inside the APK - and the reason `speak.ts` can choose
 * between them without knowing anything about either.
 *
 * It is deliberately lower-level than `Speaker`, which is what the rest of the
 * application uses. `Speaker` holds the policy that is the same everywhere: the
 * setting, the empty answer that means "nothing to say", and stopping a stale
 * sentence before starting a new one. An engine holds only what a platform does
 * differently.
 *
 * A separate file from `speak.ts` because both implementations import it and
 * `speak.ts` imports both of them; a type in the middle is how that stays a
 * line rather than a circle.
 */
import type { VoiceListing } from './voices';

export interface SpeechEngine {
  /**
   * Reads one sentence, replacing anything still being read.
   *
   * Flushing is not optional and is not the caller's job: an answer that queues
   * behind a stale one is heard several seconds after the screen it describes
   * has gone. `speechSynthesis.cancel()` on the web, `QUEUE_FLUSH` on Android.
   *
   * Resolves when the sentence has been HANDED OVER, not when it has been
   * heard. Both platforms behave that way and neither reports the end reliably,
   * so a promise that waited would be a promise that sometimes never settles.
   *
   * `chosen` is the stored `speakingVoiceUri`, empty when nobody has chosen.
   */
  readonly speak: (text: string, tag: string, chosen: string) => Promise<void>;

  /** Stops whatever is being read. Never throws: it runs from teardown paths. */
  readonly stop: () => void;

  /** The voices for one language, best first, and whether the answer is final. */
  readonly voices: (tag: string) => Promise<VoiceListing>;

  /**
   * Subscribes to a list that arrives late, and returns an unsubscribe.
   *
   * A browser concern. Android's engine is asked only after it has initialised,
   * so its first answer is its last and the native implementation subscribes to
   * nothing.
   */
  readonly onVoicesChanged: (listener: () => void) => () => void;

  /** Whether this device can speak this language at all. */
  readonly available: (tag: string) => Promise<boolean>;

  /** Whether something is being read right now. */
  readonly speaking: () => Promise<boolean>;
}
