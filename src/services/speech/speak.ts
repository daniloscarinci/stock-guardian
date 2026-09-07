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
      if (synth === undefined || Utterance === undefined || text === '') return;

      // An answer that arrives while the last one is still being read would
      // otherwise queue, and the user would hear a stale sentence first.
      synth.cancel();

      const utterance = new Utterance(text);
      utterance.lang = tag;
      const voice = synth.getVoices().find((candidate) => candidate.lang === tag);
      if (voice !== undefined) utterance.voice = voice;
      synth.speak(utterance);
    },

    stop() {
      const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis })
        .speechSynthesis;
      synth?.cancel();
    },
  };
}
