/**
 * Android, through the system's own recognizer.
 *
 * See SpeechPlugin: the system records, so this application declares no
 * microphone permission. One utterance per call - the Intent has no continuous
 * mode, which is why the design has no wake word.
 *
 * The plugin rejects with the bare codes in failure.ts and never with a
 * sentence, because it cannot know which of three languages the user reads.
 * This module turns the rejection into a `SpeechFailureError` and changes
 * nothing else about it.
 *
 * WHY `isNativeAndroid` IS IMPORTED RATHER THAN DECLARED. This file and
 * ringer.ts used to be one module, and the microphone's removal left the ringer
 * half behind - `speak.ts` needs it, and a phone on silent must not be talked
 * over. The microphone is back and the two have stayed apart: reading the
 * ringer switch is a fact about the speaker, and nothing about playing a
 * sentence should pull a recognizer into its module graph. What they still
 * share is one predicate, and one copy of it cannot drift from the other.
 */
import { registerPlugin } from '@capacitor/core';
import type { SpeechAvailability, SpeechOptions, SpeechRecognizer } from './recognizer';
import { SpeechFailureError, speechFailureReason } from './failure';
import { isNativeAndroid } from './ringer';

/** What the plugin established about a model for the language it was asked about. */
type OnDeviceState = 'installed' | 'missing' | 'unknown';

interface SpeechPlugin {
  listen: (options: { lang: string; allowOnline: boolean }) => Promise<{ transcript: string }>;
  availability: (options: { lang: string }) => Promise<{
    state: SpeechAvailability;
    onDevice?: OnDeviceState;
  }>;
}

const Speech = registerPlugin<SpeechPlugin>('Speech');

export { isNativeAndroid };

export function createCapacitorRecognizer(): SpeechRecognizer {
  return {
    async availability(tag = 'pt-BR'): Promise<SpeechAvailability> {
      if (!isNativeAndroid()) return 'unavailable';
      return Speech.availability({ lang: tag })
        .then((r) => r.state)
        .catch(() => 'unavailable');
    },

    async listen(tag: string, options?: SpeechOptions): Promise<string> {
      // Sent explicitly rather than left out, so the plugin's default and this
      // one cannot drift apart. Both are false.
      const allowOnline = options?.allowOnline === true;

      let transcript: string;
      try {
        ({ transcript } = await Speech.listen({ lang: tag, allowOnline }));
      } catch (cause) {
        throw new SpeechFailureError(
          speechFailureReason(cause),
          cause instanceof Error ? cause.message : String(cause),
        );
      }

      // A resolve with nothing in it should not be possible - the plugin
      // rejects with no-match instead - but a recognizer that returns a space
      // must not become a command.
      if (transcript.trim() === '') {
        throw new SpeechFailureError('no-match', 'Nothing was heard.');
      }
      return transcript;
    },
  };
}
