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
      if (Recognition === undefined) throw new Error('Speech recognition is unavailable.');

      // Checked before construction, so a device without the language never
      // reaches `start()` and therefore never reaches a server.
      if ((await availability(tag)) !== 'ready') {
        throw new Error(`No on-device speech model for ${tag}.`);
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
          if (text === '') reject(new Error('Nothing was heard.'));
          else resolve(text);
        };
        recognition.onerror = () => {
          settled = true;
          reject(new Error('Speech recognition failed.'));
        };
        recognition.onend = () => {
          if (!settled) reject(new Error('Nothing was heard.'));
        };

        recognition.start();
      });
    },
  };
}
