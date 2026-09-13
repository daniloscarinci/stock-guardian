/**
 * The speaking seam.
 *
 * Above this, nothing knows whether Android's TextToSpeech engine or the
 * browser's `speechSynthesis` is reading the sentence - the same separation
 * `recognizer.ts` gives the microphone and `SqlDriver` gives the database.
 *
 * WHY IT IS A SEAM NOW, AND WAS NOT BEFORE. This module used to call
 * `speechSynthesis` directly, and the code was correct. It also read nothing
 * aloud on the phone this application is built for. Android's WebView EXPOSES
 * the Web Speech synthesis API and does not implement it: `speechSynthesis` is
 * present, so every guard passed; `getVoices()` returned an empty list, the
 * voice picker in Settings was permanently empty, `speak()` accepted every
 * utterance and played silence, and nothing anywhere reported an error. Answers
 * appeared as text and were never spoken, and the preview button did nothing at
 * all.
 *
 * That is the microphone's bug exactly - a web API that exists, satisfies every
 * check and quietly does nothing while the native path underneath it works - and
 * it has the microphone's answer: a hand-written plugin, `TtsPlugin.java`,
 * reached through `tts.ts`. What is NOT the answer is deleting the browser path.
 * `speechSynthesis` works in a desktop browser and in the installed PWA, and
 * this application ships as both.
 *
 * WHAT THIS FILE KEEPS, AND WHY IT IS HERE RATHER THAN IN AN ENGINE. Three rules
 * that are the same on every platform, and each of which cost real debugging:
 *
 *   - The setting is read on every sentence, so switching it off takes effect on
 *     the next one without anything being rebuilt. `enabled` is a function for
 *     that reason, and `chosenVoiceUri` is one for the same reason.
 *   - An empty answer means "nothing to say now" and is NOT silence: it still
 *     stops the sentence in flight, which is about a screen the user has already
 *     left. Returning early on it once skipped the stop entirely and left the
 *     previous answer reading on.
 *   - A new sentence replaces the old one rather than queueing behind it. The
 *     engines do that themselves - `cancel()` on the web, `QUEUE_FLUSH` on
 *     Android - which is why it is stated in `SpeechEngine` and not repeated
 *     here.
 *
 * WHAT IS DELIBERATELY NOT HERE: Android's ringer switch. This module has no
 * platform knowledge beyond choosing an engine, so the callers compose the two -
 * see `ringer.ts` and the voice sheet. That keeps every rule above testable
 * without a Capacitor bridge. What it does mean is that `say` answers `silent`
 * for the two quiets it decides itself - the setting and the empty answer - and
 * the sheet answers with the same word for the one it decides, the switch on
 * the side of the phone. Wherever it was decided it is the same word, so
 * nothing above the seam has to know which of them applied.
 *
 * AND WHAT SAY NOW MEANS. It used to resolve the moment a sentence had been
 * handed to a platform, and it used to swallow every failure into the same
 * `undefined` a deliberate silence produced - so a caller could not tell "they
 * heard it" from "we do not know whether anybody heard it" from "we chose not
 * to say it". It now answers with one of those three. Nothing in this release
 * acts on the difference; the conversation loop that comes next cannot exist
 * without it, because a microphone opened while the phone is still talking
 * records the phone.
 */
import { isNativeAndroid } from './ringer';
import { webSynthesisEngine } from './websynthesis';
import { nativeTtsEngine } from './tts';
import type { SpeechEngine, SpeechOutcome } from './engine';
import type { VoiceListing } from './voices';

export {
  inferVoiceGender,
  type InferredGender,
  type VoiceChoice,
  type VoiceListing,
} from './voices';

export type { EngineOutcome, SpeechOutcome } from './engine';

export interface Speaker {
  /**
   * Reads one sentence, and resolves when it has been heard.
   *
   * `spoken` means the platform reported the end of it. `silent` means nothing
   * was handed to a platform at all: the setting is off, or the answer was
   * empty. `unknown` means the sentence went to an engine and nothing came
   * back that can be trusted - a failure, an interruption, or the watchdog in
   * `engine.ts` expiring.
   */
  readonly say: (text: string, tag: string) => Promise<SpeechOutcome>;
  readonly stop: () => void;
}

/**
 * The sentence being read right now, or undefined when nothing is.
 *
 * Module-level rather than per-speaker on purpose: the ask sheet builds one
 * speaker, the welcome builds another, and the question "is something being
 * read" is about the device, not about whichever object was asked. Every
 * sentence this application says goes through the `say` below, so this record
 * sees all of them.
 *
 * It is the promise itself rather than a boolean so that a stale sentence
 * cannot clear a fresh one's flag - `say` compares before clearing, the same
 * way TtsPlugin.java compares generations before acting on a callback.
 */
let reading: Promise<SpeechOutcome> | undefined;

/**
 * The engine for this device.
 *
 * Android first, and asked on every call rather than resolved once: the answer
 * cannot change on a real device, and asking each time is what lets both paths
 * be tested in one process.
 */
function engine(): SpeechEngine {
  return isNativeAndroid() ? nativeTtsEngine : webSynthesisEngine;
}

export function createSpeaker(
  enabled: () => boolean,
  chosenVoiceUri: () => string = () => '',
): Speaker {
  return {
    async say(text, tag): Promise<SpeechOutcome> {
      // Not spoken, and deliberately: the person asked for quiet.
      if (!enabled()) return 'silent';

      /*
       * The empty answer, and the order it is handled in.
       *
       * Empty means "nothing to say now", not "leave things as they are": the
       * sentence still playing describes a screen that has moved on, so it is
       * stopped and nothing is queued in its place. The check sits AFTER the
       * setting and BEFORE the engine because stopping is all there is to do.
       *
       * `silent` as well, for the same reason as the setting: nothing was
       * handed to an engine, so there is nothing for anybody to wait on. The
       * sentence this one stopped settles as `unknown` in its own caller, which
       * is where that news belongs.
       */
      if (text === '') {
        reading = undefined;
        engine().stop();
        return 'silent';
      }

      /*
       * Failing soft, because the alternative is worse than not speaking: a
       * rejected bridge call - an older APK with no such plugin, an engine that
       * will not start, a language the engine does not have - must not become
       * an exception thrown through whichever screen happened to ask for an
       * answer. It is `unknown` and not `silent`: something was attempted and
       * nobody can say what came of it.
       */
      const attempt = engine()
        .speak(text, tag, chosenVoiceUri())
        .catch<SpeechOutcome>(() => 'unknown');

      reading = attempt;
      const outcome = await attempt;
      // Only if it is still ours. A newer sentence flushes this one and takes
      // the slot, and its promise must not be cleared by this one settling.
      if (reading === attempt) reading = undefined;
      return outcome;
    },

    /**
     * Stops what is being read, whatever the setting says.
     *
     * The setting governs whether to START speaking. A sheet being closed while
     * a sentence plays is not the moment to consult it.
     *
     * The record is cleared here as well as by the promise settling. On the
     * native path the engine is told to stop across a bridge and says so back
     * across it, so leaving the record until the answer arrived would have
     * `isSpeaking` claiming a sentence is being read for the length of a round
     * trip after somebody closed the sheet.
     */
    stop() {
      reading = undefined;
      engine().stop();
    },
  };
}

/**
 * The voices this device offers for a language, best first, and whether that
 * answer is final.
 *
 * ASYNCHRONOUS BECAUSE ONE OF THE TWO PLATFORMS IS. `speechSynthesis.getVoices()`
 * is a synchronous call that lies on first use; the plugin is a bridge call that
 * waits for an engine to initialise and then tells the truth. One shape covers
 * both, and `settled` is what a picker needs in order to tell "still asking"
 * from "this device has none" - see SettingsScreen, which draws both cases.
 */
export async function listVoices(tag: string): Promise<VoiceListing> {
  return engine().voices(tag);
}

/**
 * Calls back when the platform finishes loading its voices, and returns an
 * unsubscribe.
 *
 * A browser concern only: Chrome's first `getVoices()` after a page load returns
 * nothing and the real list arrives with a `voiceschanged` event. The native
 * engine is asked only once it has initialised, so it subscribes to nothing and
 * hands back a harmless unsubscribe.
 */
export function onVoicesChanged(listener: () => void): () => void {
  return engine().onVoicesChanged(listener);
}

/**
 * Whether this device can read this language aloud at all.
 *
 * Worth far more on Android than in a browser. The plugin asks the engine
 * whether it has the language; a browser can only report that the API object
 * exists, which is precisely the check that passed inside the WebView while
 * nothing played. Settings shows it beside the recognizer's own availability,
 * so that a button which cannot work says why rather than doing nothing.
 */
export async function speechAvailable(tag: string): Promise<boolean> {
  return engine()
    .available(tag)
    .catch(() => false);
}

/**
 * Whether something is being read right now.
 *
 * The welcome asks before it says good morning, so that it can never talk over
 * an answer somebody actually requested. Anything else that speaks does so
 * because a person asked for it, and is entitled to interrupt.
 *
 * THE SIGNAL FIRST, AND THE PLATFORM ONLY AFTER IT. This used to be one bridge
 * call and nothing else - a poll standing in for a signal that did not exist
 * yet. Now `say` holds the sentence in flight, so the usual answer is a field
 * read: no round trip to Java, and true from the instant a sentence is asked
 * for rather than from whenever the engine gets round to admitting it.
 *
 * The platform is still asked, and for a real case rather than out of caution:
 * a sentence whose watchdog expired is no longer in flight here, and the engine
 * may still be reading it out. That is the one thing the record cannot see.
 */
export async function isSpeaking(): Promise<boolean> {
  if (reading !== undefined) return true;
  return engine()
    .speaking()
    .catch(() => false);
}
