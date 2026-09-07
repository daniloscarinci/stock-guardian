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
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { SpeechAvailability, SpeechRecognizer } from './recognizer';
import { SpeechFailureError, speechFailureReason } from './failure';

/** What the plugin established about a model for the language it was asked about. */
type OnDeviceState = 'installed' | 'missing' | 'unknown';

interface SpeechPlugin {
  listen: (options: { lang: string }) => Promise<{ transcript: string }>;
  availability: (options: { lang: string }) => Promise<{
    state: SpeechAvailability;
    onDevice?: OnDeviceState;
  }>;
  isSilent: () => Promise<{ silent: boolean }>;
}

const Speech = registerPlugin<SpeechPlugin>('Speech');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function androidIsSilent(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  return Speech.isSilent()
    .then((r) => r.silent)
    .catch(() => false);
}

export function createCapacitorRecognizer(): SpeechRecognizer {
  return {
    async availability(tag = 'pt-BR'): Promise<SpeechAvailability> {
      if (!isNativeAndroid()) return 'unavailable';
      return Speech.availability({ lang: tag })
        .then((r) => r.state)
        .catch(() => 'unavailable');
    },

    async listen(tag: string): Promise<string> {
      let transcript: string;
      try {
        ({ transcript } = await Speech.listen({ lang: tag }));
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
