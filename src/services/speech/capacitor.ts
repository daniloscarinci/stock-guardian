/**
 * Android, through the system's own recognizer.
 *
 * See SpeechPlugin: the system records, so this application declares no
 * microphone permission. One utterance per call - the Intent has no continuous
 * mode, which is why the design has no wake word.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { SpeechAvailability, SpeechRecognizer } from './recognizer';

interface SpeechPlugin {
  listen: (options: { lang: string }) => Promise<{ transcript: string }>;
  availability: () => Promise<{ state: SpeechAvailability }>;
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
    async availability(): Promise<SpeechAvailability> {
      if (!isNativeAndroid()) return 'unavailable';
      return Speech.availability()
        .then((r) => r.state)
        .catch(() => 'unavailable');
    },

    async listen(tag: string): Promise<string> {
      const { transcript } = await Speech.listen({ lang: tag });
      if (transcript.trim() === '') throw new Error('Nothing was heard.');
      return transcript;
    },
  };
}
