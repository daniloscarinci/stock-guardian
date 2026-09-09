/**
 * Speaking through the browser: `speechSynthesis`, and nothing else.
 *
 * This is the implementation that worked all along, moved rather than changed.
 * It is what a desktop browser and the installed PWA use, and this application
 * ships as both - so the seam has two sides, and losing this one to fix Android
 * would have traded one silent platform for two.
 *
 * IT IS NOT WHAT RUNS INSIDE THE APK. Android's WebView exposes this API and
 * does not implement it: the object is present, every guard below passes,
 * `getVoices()` returns an empty list and `speak()` plays nothing while
 * reporting no error at all. `speak.ts` sends Android to `tts.ts` instead, for
 * exactly the reason `recognizer.ts` sends it to `capacitor.ts`.
 *
 * `speechSynthesis` is a system service, not a network request: the audit scans
 * for constructs that fetch, and this is not one.
 */
import { pickVoice, sortVoices, sameLanguage, inferVoiceGender, type VoiceListing } from './voices';
import type { SpeechEngine } from './engine';

function getSynth(): SpeechSynthesis | undefined {
  return (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
}

function getUtteranceConstructor(): (new (text: string) => SpeechSynthesisUtterance) | undefined {
  return (globalThis as unknown as {
    SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
  }).SpeechSynthesisUtterance;
}

export const webSynthesisEngine: SpeechEngine = {
  async speak(text, tag, chosen) {
    const synth = getSynth();
    const Utterance = getUtteranceConstructor();
    if (synth === undefined || Utterance === undefined) return;

    // An answer that arrives while the last one is still being read would
    // otherwise queue, and the user would hear a stale sentence first. The
    // native path gets this from QUEUE_FLUSH; here it is explicit.
    synth.cancel();

    const utterance = new Utterance(text);
    utterance.lang = tag;

    // Read fresh on every sentence rather than captured when the speaker was
    // built: this is the same call that is empty on first use, so a voice that
    // arrives a moment later is used by the next answer with nothing rebuilt.
    const voice = pickVoice(synth.getVoices(), tag, chosen);
    if (voice !== undefined) utterance.voice = voice;

    synth.speak(utterance);
  },

  stop() {
    getSynth()?.cancel();
  },

  /**
   * The voices this browser offers for a language, best first.
   *
   * MAY LEGITIMATELY BE EMPTY, and empty does not mean the device has no
   * voices. `getVoices()` returns what has been loaded so far, and on Chrome the
   * first call after a page load returns nothing at all; the list arrives later
   * and the platform fires `voiceschanged`. That is what `settled` is for, and
   * why a caller drawing a control from this has to pair it with
   * `onVoicesChanged` - see the picker in SettingsScreen, which does, and which
   * says it is still looking rather than drawing an empty menu.
   */
  voices(tag): Promise<VoiceListing> {
    const synth = getSynth();
    if (synth === undefined || typeof synth.getVoices !== 'function') {
      // No API at all is a final answer: nothing is going to arrive later.
      return Promise.resolve({ voices: [], settled: true });
    }

    const matching = synth.getVoices().filter((voice) => sameLanguage(voice.lang, tag));
    return Promise.resolve({
      voices: sortVoices(matching, tag).map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        gender: inferVoiceGender(voice.name),
      })),
      // An empty first answer is the one case this API cannot distinguish from
      // a device with no voices, so it is reported as unfinished and the event
      // below settles it.
      settled: matching.length > 0,
    });
  },

  /**
   * Calls back when the platform finishes loading its voices.
   *
   * Returns an unsubscribe, and a harmless one where there is no
   * `speechSynthesis` at all or where it predates `addEventListener` - a device
   * that cannot tell us is a device whose first list is the only list there will
   * ever be.
   */
  onVoicesChanged(listener) {
    const synth = getSynth();
    if (synth === undefined || typeof synth.addEventListener !== 'function') {
      return () => {
        // Nothing was subscribed, so there is nothing to undo.
      };
    }
    synth.addEventListener('voiceschanged', listener);
    return () => {
      synth.removeEventListener('voiceschanged', listener);
    };
  },

  /**
   * Whether this browser can speak at all.
   *
   * The API's presence is the only answer available, and it is a weak one - it
   * is exactly the check that passed inside the WebView while nothing played.
   * Off Android that is as much as can be known, because `speak()` reports
   * nothing and there is no language query to ask.
   */
  available() {
    return Promise.resolve(getSynth() !== undefined && getUtteranceConstructor() !== undefined);
  },

  /** `pending` as well as `speaking`: a queued sentence is one about to be heard. */
  speaking() {
    const synth = getSynth();
    return Promise.resolve(synth !== undefined && (synth.speaking || synth.pending));
  },
};
