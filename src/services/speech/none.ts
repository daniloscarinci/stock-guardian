import type { SpeechRecognizer } from './recognizer';
import { SpeechFailureError } from './failure';

/**
 * Safari, Firefox, and every test.
 *
 * Not a degraded mode: the typed box is present on every platform, so a device
 * without on-device speech loses the microphone and keeps the feature.
 */
export const noneRecognizer: SpeechRecognizer = {
  availability: async () => 'unavailable',
  listen: async () => {
    throw new SpeechFailureError(
      'no-recognizer',
      'Speech recognition is unavailable on this device.',
    );
  },
};
