/**
 * Reading an answer aloud.
 *
 * `speechSynthesis` is a system service, not a network request: the audit
 * scans for constructs that fetch, and this is not one. On Android the voice is
 * whichever pt-BR voice the system has installed, which is one by default.
 *
 * `enabled` is a function rather than a boolean so a settings change takes
 * effect on the next sentence without rebuilding the speaker. Android's ringer
 * switch is NOT consulted here - this module has no platform knowledge. The
 * voice sheet composes the two, which keeps this testable without a Capacitor
 * bridge.
 */
export interface Speaker {
  readonly say: (text: string, tag: string) => Promise<void>;
  readonly stop: () => void;
}

export function createSpeaker(enabled: () => boolean): Speaker {
  return {
    async say(text, tag) {
      if (!enabled()) return;
      const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis })
        .speechSynthesis;
      const Utterance = (globalThis as unknown as {
        SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
      }).SpeechSynthesisUtterance;
      if (synth === undefined || Utterance === undefined) return;

      // An answer that arrives while the last one is still being read would
      // otherwise queue, and the user would hear a stale sentence first.
      synth.cancel();

      // Empty text is a legitimate answer meaning "nothing to say now", so the
      // check sits AFTER the cancel, not in the guard above. Returning early on
      // it used to skip the cancel entirely, which left the previous sentence
      // reading on over a screen that had already moved on - precisely the
      // stale answer the cancel exists to stop.
      if (text === '') return;

      const utterance = new Utterance(text);
      utterance.lang = tag;

      // A LOCAL voice, or none named at all.
      //
      // `speechSynthesis` offers server-synthesised voices alongside on-device
      // ones, and on a desktop browser the remote voice is often both first in
      // the list and the better-sounding one. Picking it would send the answer -
      // which names what is in someone's pantry - to a synthesis service, in an
      // application whose whole claim is that it makes no network request of its
      // own. `localService` is how the platform distinguishes them.
      //
      // When no local voice matches, no voice is named and `lang` alone is left
      // to the platform. That can still resolve to a remote voice, which is why
      // docs/OFFLINE.md states this as a best effort rather than a guarantee -
      // the API offers no way to refuse.
      const voices = synth.getVoices();
      const local = voices.find(
        (candidate) => candidate.lang === tag && candidate.localService,
      );
      if (local !== undefined) utterance.voice = local;

      synth.speak(utterance);
    },

    stop() {
      const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis })
        .speechSynthesis;
      synth?.cancel();
    },
  };
}
