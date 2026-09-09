/**
 * Android, through the engine the system itself reads with.
 *
 * WHY THIS FILE EXISTS. Android's WebView exposes `speechSynthesis` and does not
 * implement it. The object is there, so every guard in `websynthesis.ts` passes;
 * `getVoices()` returns nothing, `speak()` accepts the utterance and plays
 * silence, and no error is raised anywhere. Answers appeared as text and were
 * never read aloud, and the preview button in Settings did nothing at all.
 *
 * That is the microphone's bug again - a web API that exists, satisfies every
 * check and quietly does nothing, while the native path underneath it works - so
 * it has the microphone's fix: TtsPlugin binds `android.speech.tts.TextToSpeech`
 * directly, and this module is the web half of that bridge. It is the speaking
 * counterpart of `capacitor.ts` and sits beside it deliberately.
 *
 * WHAT IS DECIDED HERE RATHER THAN IN JAVA. Which voice reads a sentence. The
 * plugin honours a voice named by the caller and otherwise leaves the language
 * to the engine; the local-first preference - never hand a sentence naming
 * somebody's pantry to a synthesis server when a voice on the device will do -
 * lives in `voices.ts`, shared with the browser path and testable without a
 * phone in the room. `Voice.isNetworkConnectionRequired()` is what feeds it, and
 * it is a better source than the browser's `localService`: the engine states the
 * requirement rather than the browser summarising it.
 *
 * FAILING SOFT, IN ONE DIRECTION ONLY. Listing voices may fail - an engine that
 * declines to enumerate, an older APK with no such plugin - and when it does the
 * sentence is still spoken, with no voice named and the language left to the
 * engine. The reverse would be the bug this file exists to fix: a preference
 * that costs somebody their speech.
 */
import { registerPlugin } from '@capacitor/core';
import { inferVoiceGender, pickVoice, sortVoices, type VoiceChoice, type VoiceListing } from './voices';
import type { SpeechEngine } from './engine';

/** One voice as `TextToSpeech.getVoices()` describes it, flattened by the plugin. */
interface NativeVoice {
  /**
   * The engine's own identifier, such as `pt-br-x-afm#female_1-local`.
   *
   * Passed through untouched, because that `#female` is the only thing on this
   * device that says whether a voice is a woman's or a man's - the pattern
   * `inferVoiceGender` trusts most and had never once seen, since the browser
   * list inside the APK was always empty.
   */
  readonly name: string;
  readonly lang: string;
  /** `Voice.isNetworkConnectionRequired()`. The native form of `localService`. */
  readonly networkRequired: boolean;
  /** `Voice.getFeatures()`, unread by the plugin so the rule below can be tested. */
  readonly features: readonly string[];
}

interface TtsPlugin {
  speak: (options: { text: string; lang: string; voice: string }) => Promise<void>;
  stop: () => Promise<void>;
  voices: (options: { lang: string }) => Promise<{ voices: NativeVoice[] }>;
  isAvailable: (options: { lang: string }) => Promise<{ available: boolean }>;
  isSpeaking: () => Promise<{ speaking: boolean }>;
}

const Tts = registerPlugin<TtsPlugin>('Tts');

/**
 * `Voice.FEATURE_NOT_INSTALLED`, which is the engine saying this voice's data
 * has not been downloaded.
 *
 * Selecting one produces silence, so they are left out of the list rather than
 * offered - a picker whose entries do not speak is the failure this whole
 * release is about. They are dropped here rather than in Java so that the rule
 * has a test.
 */
const NOT_INSTALLED = 'notInstalled';

/** The native payload, in the shape the picker and `pickVoice` read. */
export function toVoiceChoices(voices: readonly NativeVoice[], tag: string): VoiceChoice[] {
  const usable = voices
    .filter((voice) => !voice.features.includes(NOT_INSTALLED))
    .map((voice) => ({
      // Android gives one string, so the identifier and the label are the same
      // string. `pickVoice` matches on either, so a stored choice survives
      // whichever of the two a future release decides to change.
      voiceURI: voice.name,
      name: voice.name,
      lang: voice.lang,
      localService: !voice.networkRequired,
      gender: inferVoiceGender(voice.name),
    }));

  return sortVoices(usable, tag);
}

/** The engine's voices, or nothing at all if it will not say. */
async function listNative(tag: string): Promise<VoiceChoice[]> {
  try {
    const { voices } = await Tts.voices({ lang: tag });
    return toVoiceChoices(voices, tag);
  } catch {
    // An engine that will not enumerate is not an engine that cannot speak.
    return [];
  }
}

export const nativeTtsEngine: SpeechEngine = {
  async speak(text, tag, chosen) {
    /*
     * Read fresh on every sentence, exactly as the browser path does. The list
     * is a bridge call rather than a property read, and it is worth it: a voice
     * installed while the application was open is used by the next answer, and
     * the local-first preference is applied against what the engine has NOW
     * rather than what it had when the speaker was built.
     */
    const voice = pickVoice(await listNative(tag), tag, chosen);

    await Tts.speak({ text, lang: tag, voice: voice?.voiceURI ?? '' });
  },

  stop() {
    // Nothing awaits this: `Speaker.stop` is synchronous because it runs from
    // teardown paths, and a rejected stop is not a thing to report to anybody.
    void Tts.stop().catch(() => undefined);
  },

  async voices(tag): Promise<VoiceListing> {
    // Always settled. The plugin answers only once the engine has initialised,
    // so unlike `speechSynthesis` there is no later list to wait for: an empty
    // answer here means this engine has no voice for this language.
    return { voices: await listNative(tag), settled: true };
  },

  onVoicesChanged() {
    return () => {
      // Nothing to subscribe to. The first native answer is the final one.
    };
  },

  async available(tag) {
    return Tts.isAvailable({ lang: tag })
      .then((r) => r.available)
      .catch(() => false);
  },

  async speaking() {
    // Fails to false, so a bridge that will not answer can never leave the
    // welcome permanently convinced that something else is talking.
    return Tts.isSpeaking()
      .then((r) => r.speaking)
      .catch(() => false);
  },
};
