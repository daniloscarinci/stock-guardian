/**
 * Chrome, transcribing on the device and nowhere else.
 *
 * THIS IS THE ONLY MODULE PERMITTED TO CONSTRUCT `SpeechRecognition`.
 * `scripts/audit-offline.mjs` fails the build if the identifier appears
 * anywhere else, because the default mode of this API streams audio to
 * Google's servers and would make the application's central claim false.
 *
 * `processLocally = true` is what prevents that. It fails CLOSED: with no local
 * model the call errors rather than quietly falling back to the network, which
 * is the property that makes this API usable here at all. Never set it
 * conditionally, and never start a recognizer without it.
 */
import type { SpeechAvailability, SpeechRecognizer } from './recognizer';
import { SpeechFailureError, type SpeechFailure } from './failure';

interface OnDeviceCapable {
  new (): SpeechRecognitionLike;
  availableOnDevice?: (lang: string) => Promise<string>;
  installOnDevice?: (lang: string) => Promise<boolean>;
}

interface SpeechRecognitionLike {
  lang: string;
  processLocally: boolean;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

/** The Web Speech API's own error names, mapped onto the seam's vocabulary. */
const WEB_ERRORS: Readonly<Record<string, SpeechFailure>> = {
  'no-speech': 'no-match',
  aborted: 'cancelled',
  'audio-capture': 'failed',
  network: 'network',
  'not-allowed': 'failed',
  'service-not-allowed': 'failed',
  'language-not-supported': 'no-offline-model',
  'bad-grammar': 'failed',
};

function api(): OnDeviceCapable | undefined {
  const scope = globalThis as unknown as Record<string, unknown>;
  return (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as
    | OnDeviceCapable
    | undefined;
}

function transcriptOf(event: unknown): string {
  const results = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results;
  const first = results?.[0]?.[0]?.transcript;
  return typeof first === 'string' ? first : '';
}

function reasonOf(event: unknown): SpeechFailure {
  const name = (event as { error?: unknown }).error;
  return typeof name === 'string' ? (WEB_ERRORS[name] ?? 'failed') : 'failed';
}

export function createWebSpeechRecognizer(): SpeechRecognizer {
  async function availability(tag = 'pt-BR'): Promise<SpeechAvailability> {
    const Recognition = api();
    if (Recognition === undefined) return 'unavailable';
    // Without this static method the browser has only the networked mode,
    // which this application does not use under any circumstance.
    if (typeof Recognition.availableOnDevice !== 'function') return 'unavailable';

    const state = await Recognition.availableOnDevice(tag).catch(() => 'unavailable');
    if (state === 'available') return 'ready';
    if (state === 'downloadable' || state === 'downloading') return 'installable';
    return 'unavailable';
  }

  return {
    availability,

    async install(tag: string): Promise<boolean> {
      const Recognition = api();
      if (typeof Recognition?.installOnDevice !== 'function') return false;
      return Recognition.installOnDevice(tag).catch(() => false);
    },

    async listen(tag: string): Promise<string> {
      const Recognition = api();
      if (Recognition === undefined) {
        throw new SpeechFailureError('no-recognizer', 'Speech recognition is unavailable.');
      }

      // Checked before construction, so a device without the language never
      // reaches `start()` and therefore never reaches a server.
      if ((await availability(tag)) !== 'ready') {
        throw new SpeechFailureError('no-offline-model', `No on-device speech model for ${tag}.`);
      }

      return new Promise<string>((resolve, reject) => {
        const recognition = new Recognition();
        // First, and unconditionally. If the property does not exist the
        // assignment is harmless; if a future engine makes it throw, the
        // executor rejects and `start()` below is never reached - which is the
        // outcome to want.
        recognition.processLocally = true;
        recognition.lang = tag;
        recognition.continuous = false;
        recognition.interimResults = false;

        let settled = false;
        recognition.onresult = (event) => {
          settled = true;
          const text = transcriptOf(event);
          if (text === '') reject(new SpeechFailureError('no-match', 'Nothing was heard.'));
          else resolve(text);
        };
        recognition.onerror = (event) => {
          settled = true;
          reject(new SpeechFailureError(reasonOf(event), 'Speech recognition failed.'));
        };
        recognition.onend = () => {
          if (!settled) reject(new SpeechFailureError('no-match', 'Nothing was heard.'));
        };

        try {
          recognition.start();
        } catch (cause) {
          // `start()` on a recognizer that is already running throws, and that
          // is the one failure the API reports this way rather than through
          // `onerror`.
          settled = true;
          reject(
            new SpeechFailureError(
              'busy',
              cause instanceof Error ? cause.message : 'The recognizer is already listening.',
            ),
          );
        }
      });
    },
  };
}
