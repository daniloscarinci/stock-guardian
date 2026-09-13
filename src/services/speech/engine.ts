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

/**
 * What became of a sentence an engine was given.
 *
 * `spoken` means the platform said the utterance finished. `unknown` means
 * nobody can say: the engine reported a failure, or something cut the sentence
 * off, or the watchdog below expired with the platform still silent about it.
 *
 * A union rather than the boolean this could obviously have been, because the
 * difference between "it was heard" and "we do not know whether it was heard"
 * is the whole reason the type exists. A caller about to open a microphone can
 * act on the first and must not act on the second, and `false` would have
 * collapsed them into one word.
 */
export type EngineOutcome = 'spoken' | 'unknown';

/**
 * What became of a sentence the application asked for.
 *
 * `silent` is the third case and no engine ever produces it: nothing was handed
 * to a platform at all, on purpose. `speak.ts` decides two of those - the
 * setting is off, or the answer was empty - and answers with this word. The
 * switch on the side of the phone is a platform fact that `speak.ts`
 * deliberately knows nothing about, so the sheet composes it and answers with
 * the same word; see `VoiceSheet`. Two other callers ask the phone and answer
 * nobody: `useWelcome` returns, and the preview in Settings asks about the
 * ringer AND the media volume and puts a line on the screen saying which one
 * stopped it. Neither hands an outcome anywhere, because nothing is waiting on
 * either. However it was decided, it means one thing to somebody waiting: the
 * device deliberately made no sound, and there is nothing to wait for.
 */
export type SpeechOutcome = EngineOutcome | 'silent';

/**
 * The floor under the watchdog, in milliseconds.
 *
 * ESTIMATED, NOT MEASURED, like everything else about this ceiling. Short
 * answers are the common case - "Rice: 3 kg" is ten characters and takes well
 * under a second to say - and for those the wait is not about the sentence at
 * all. It is about how long an engine may take to make its first sound: a cold
 * `TextToSpeech` binding a service, or a browser fetching a voice it has not
 * loaded yet. Neither was timed. It is a second more than
 * `INIT_TIMEOUT_MILLIS` in TtsPlugin.java, and generous for the reason that one
 * is: cutting off an engine that was about to work is worse than waiting.
 */
const SPEECH_FLOOR_MILLIS = 6000;

/**
 * How much to allow per character of the sentence.
 *
 * ESTIMATED, NOT MEASURED. Nothing here has been timed on a device - there is
 * no Android SDK on the machine this was written on - so the number is derived
 * from published speaking rates and then loosened. Synthesised speech runs at
 * roughly 150 to 200 words a minute, and words in the three languages this
 * application speaks average around six characters counting the space, which
 * puts a sentence at fifteen to twenty characters a second: 50 to 67ms each.
 *
 * WHAT 120 ACTUALLY BUYS, since a number like this invites a rounder claim than
 * it can support. It is about 1.8 times the slow end of that range, so a
 * sentence read up to 1.8 times slower than the estimate still finishes inside
 * the ceiling. An engine set to HALF speed does not: that is 134ms a character,
 * and on any sentence long enough to clear the floor the watchdog would fire
 * first and report `unknown` for a sentence that was in fact being read.
 */
const MILLIS_PER_CHARACTER = 120;

/**
 * The longest one sentence is waited for before it is given up on.
 *
 * THIS IS THE ANSWER TO THE OBJECTION THAT USED TO BE WRITTEN HERE, and the
 * objection was correct: some Android engines never report that an utterance
 * ended. A promise that waited for a signal that may never arrive would be a
 * promise that sometimes never settles, and the two plugin files already stand
 * three timers of exactly this shape between this application and that: in
 * SpeechPlugin.java one Runnable re-armed with three different ceilings as a
 * listen progresses (ready, utterance, result) and a second on the on-device
 * language query, and in TtsPlugin.java one on initialisation. Five ceilings,
 * three timers, counted off the files.
 *
 * This is the rule the two new ones use. TtsPlugin.java arms one per utterance
 * for the native path; `websynthesis.ts` arms its own from this function,
 * because a browser has no plugin behind it to arm one for it.
 *
 * It resolves; it never rejects. A slow engine is not an error to show anybody,
 * and the outcome it produces is `unknown`, which says precisely what has
 * happened: the sentence was handed over and the platform never said how it
 * went.
 *
 * BOTH NUMBERS ARE ESTIMATES AND NEITHER WAS MEASURED - see the two constants
 * above, which say where they came from. Nothing is shared across the language
 * boundary: TtsPlugin.java declares `SPEECH_FLOOR_MILLIS` and
 * `MILLIS_PER_CHARACTER` again, with the same values, and the names are kept
 * identical so that a grep finds both halves of any change to either.
 */
export function speechCeilingMillis(text: string): number {
  return Math.max(SPEECH_FLOOR_MILLIS, text.length * MILLIS_PER_CHARACTER);
}

export interface SpeechEngine {
  /**
   * Reads one sentence, replacing anything still being read.
   *
   * Flushing is not optional and is not the caller's job: an answer that queues
   * behind a stale one is heard several seconds after the screen it describes
   * has gone. `speechSynthesis.cancel()` on the web, `QUEUE_FLUSH` on Android.
   *
   * RESOLVES WHEN THE SENTENCE HAS BEEN HEARD, not when it was handed over.
   * That is the opposite of what this contract said until now, and the reason
   * it said the opposite has not gone away: neither platform reports the end
   * dependably. Some third-party Android engines are reported never to call
   * `onDone` at all, and a WebView that accepts an utterance and plays silence
   * is the failure this whole seam was built to work around. Neither claim was
   * measured here - there is no device on the machine this was written on.
   * What changed is that a watchdog now stands behind the signal - see
   * `speechCeilingMillis` - so the promise settles whether or not the platform
   * ever speaks up.
   *
   * The three ways it can settle are the three the caller has to tell apart:
   * `spoken` because the platform said so, `unknown` because the sentence was
   * cut off or failed or the ceiling expired. `silent` never comes from here;
   * it is the Speaker's word for a sentence that was never handed over.
   *
   * WHY ANY OF THIS MATTERS. There is no echo cancellation in this application
   * and nothing coordinates audio focus between the engine that speaks and the
   * recogniser that listens. TTS plays on the media stream and the recogniser
   * records from the microphone, so a microphone opened while the phone is
   * still talking transcribes the phone. Knowing when a sentence has actually
   * finished is what makes it safe to listen for an answer to it.
   *
   * It may reject. `speak.ts` maps a rejection to `unknown`, which is where
   * an older APK with no such plugin and an engine that will not start both
   * end up.
   *
   * `chosen` is the stored `speakingVoiceUri`, empty when nobody has chosen.
   */
  readonly speak: (text: string, tag: string, chosen: string) => Promise<EngineOutcome>;

  /**
   * Stops whatever is being read. Never throws: it runs from teardown paths.
   *
   * A sentence stopped this way settles as `unknown` rather than being left
   * pending. One promise per interrupted sentence is a leak, and this
   * application interrupts on purpose: every new answer flushes the last one,
   * and an empty answer stops the previous one without queueing anything.
   */
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

  /**
   * Whether the platform says something is being read right now.
   *
   * Asked only where the signal above cannot answer - see `isSpeaking` in
   * `speak.ts`, which prefers the sentence it knows is in flight and falls
   * back to this for the one case the signal cannot cover: a sentence whose
   * watchdog expired, which the engine may still be reading out.
   */
  readonly speaking: () => Promise<boolean>;
}
