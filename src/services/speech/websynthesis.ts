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
import { speechCeilingMillis, type EngineOutcome, type SpeechEngine } from './engine';

function getSynth(): SpeechSynthesis | undefined {
  return (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
}

function getUtteranceConstructor(): (new (text: string) => SpeechSynthesisUtterance) | undefined {
  return (globalThis as unknown as {
    SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
  }).SpeechSynthesisUtterance;
}

/**
 * How to settle the sentence being read right now, or undefined.
 *
 * THIS IS WHAT MAKES AN INTERRUPTION DETERMINISTIC, and an interruption is the
 * normal case here rather than the exception: every new answer cancels the last
 * one, an empty answer cancels without queueing anything, and closing the sheet
 * cancels from a teardown path.
 *
 * The specification says a cancelled utterance should end with an `error` whose
 * code is `interrupted` or `canceled` rather than with `end`, and that would be
 * enough on its own if implementations could be relied on to do it. This module
 * exists because one of them cannot: the WebView accepts an utterance, plays
 * nothing and reports neither event. So the cancel path settles the outgoing
 * sentence itself, before the platform gets a chance to describe it, and
 * whichever event arrives afterwards - if any does - finds a promise that has
 * already been answered. Nothing here depends on which one it is.
 *
 * One at a time, because `speechSynthesis` is one queue and this module flushes
 * it before every sentence: there is never a second utterance of ours waiting
 * behind the first.
 */
let outgoing: ((outcome: EngineOutcome) => void) | undefined;

/**
 * Empties the queue, settling anything of ours that was in it.
 *
 * A sentence cut off is `unknown` rather than `spoken`: some of it was heard,
 * possibly none of it, and nothing here can say how much. For the caller that
 * matters as much as a failure does - it is not a sentence that finished.
 */
function flush(synth: SpeechSynthesis): void {
  const settle = outgoing;
  outgoing = undefined;
  settle?.('unknown');
  synth.cancel();
}

export const webSynthesisEngine: SpeechEngine = {
  async speak(text, tag, chosen): Promise<EngineOutcome> {
    const synth = getSynth();
    // No synthesiser at all, and nothing of ours can be playing through one
    // that does not exist. Nothing was heard, but this is still a sentence
    // somebody asked for and did not get, which is what `unknown` is for -
    // `silent` is reserved for a deliberate quiet.
    if (synth === undefined) return 'unknown';

    // An answer that arrives while the last one is still being read would
    // otherwise queue, and the user would hear a stale sentence first. The
    // native path gets this from QUEUE_FLUSH; here it is explicit. It sits
    // ABOVE the guard below so that no way out of this function skips it: a new
    // answer supersedes the one being read whether or not it can be spoken.
    flush(synth);

    // The constructor arrives with the object on every platform there has ever
    // been, so this is a guard against a stubbed-out global rather than a real
    // device. It still returns `unknown` rather than `silent`, because a
    // sentence nobody could speak is not a sentence anybody chose not to.
    const Utterance = getUtteranceConstructor();
    if (Utterance === undefined) return 'unknown';

    const utterance = new Utterance(text);
    utterance.lang = tag;

    // Read fresh on every sentence rather than captured when the speaker was
    // built: this is the same call that is empty on first use, so a voice that
    // arrives a moment later is used by the next answer with nothing rebuilt.
    const voice = pickVoice(synth.getVoices(), tag, chosen);
    if (voice !== undefined) utterance.voice = voice;

    return new Promise<EngineOutcome>((resolve) => {
      let done = false;

      /*
       * The single exit, modelled on `Session.finish` in SpeechPlugin.java.
       *
       * Settles once and only once. Four things reach for it - the platform's
       * `end`, the platform's `error`, the ceiling, and `flush` above, which
       * answers the sentence itself when something is about to cut it off - and
       * on a cancel two of them arrive for the same utterance.
       *
       * It reads `ceiling` from below its own declaration, which is safe
       * because nothing calls it until after the timer exists: the handlers are
       * attached here and fired by the platform, and the earliest the platform
       * can fire one is inside the `speak` at the bottom.
       */
      const settle = (outcome: EngineOutcome): void => {
        if (done) return;
        done = true;
        clearTimeout(ceiling);
        utterance.onend = null;
        utterance.onerror = null;
        if (outgoing === settle) outgoing = undefined;
        resolve(outcome);
      };

      utterance.onend = () => {
        settle('spoken');
      };
      /*
       * `error` covers a synthesiser that refused the utterance, a voice that
       * could not be loaded and a language it will not read. It is not a
       * rejection: a sentence nobody heard is a fact for the caller to act on,
       * not an exception to throw through whichever screen asked a question.
       */
      utterance.onerror = () => {
        settle('unknown');
      };

      const ceiling = setTimeout(() => {
        settle('unknown');
      }, speechCeilingMillis(text));

      // Published before the utterance is handed over, so that a browser which
      // ends it synchronously from inside `speak()` cannot leave this slot
      // pointing at a sentence that has already finished. The handlers above
      // were attached earlier still and would be found either way; this line is
      // about the slot, not about them.
      outgoing = settle;
      synth.speak(utterance);
    });
  },

  stop() {
    const synth = getSynth();
    if (synth !== undefined) flush(synth);
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
