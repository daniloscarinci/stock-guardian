/**
 * Chrome, transcribing on the device first and every time.
 *
 * THIS IS THE ONLY MODULE PERMITTED TO CONSTRUCT `SpeechRecognition`.
 * `scripts/audit-offline.mjs` fails the build if the identifier appears
 * anywhere else, because the default mode of this API streams audio to
 * Google's servers.
 *
 * `processLocally` is what governs that, and it fails CLOSED: with no local
 * model the call errors rather than quietly falling back to the network. The
 * shape of every listen here is therefore fixed, and there are exactly two
 * steps to it:
 *
 *   1. The on-device attempt. `processLocally = true`, assigned first and
 *      before `start()`. A language the device has no model for does not even
 *      get this far - it is refused before construction, because a recognizer
 *      built for a language it cannot handle is one assignment away from being
 *      the wrong kind.
 *   2. If, and only if, that failed and online.ts permits a retry: one more
 *      recognizer, with `processLocally = false`. That one sends the audio to
 *      whichever service the browser uses.
 *
 * SO THE GUARANTEE IS NOT "NEVER WITHOUT `processLocally`" ANY MORE, AND IT IS
 * WORTH STATING WHAT REPLACED IT. Every recognizer that starts without it is a
 * retry: it never happens on the first attempt, never after a deliberate
 * cancel, never while `offlineOnly` is set, and never while the device says it
 * has no network. The tests in webspeech.test.ts pin each of those separately,
 * which is a stronger statement than the old one - the old rule was absolute
 * and, on a phone with no Portuguese pack, meant the microphone never worked at
 * all.
 *
 * The seam is still refused to browsers that do not expose these controls at
 * all. Safari has `webkitSpeechRecognition` and no way to ask about locality;
 * this application does not use a recognizer it cannot question, and the retry
 * does not change which browsers qualify - only what a qualifying one does
 * after a failure.
 */
import type {
  SpeechAvailability,
  SpeechOptions,
  SpeechRecognizer,
  Transcript,
} from './recognizer';
import { SpeechFailureError, asSpeechFailure, type SpeechFailure } from './failure';
import { mayRetryOnline, reportedFailure } from './online';

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

/**
 * One recognizer, one utterance, one mode.
 *
 * `processLocally` is assigned first and on every path. If the property does
 * not exist the assignment is harmless; if a future engine makes it throw, the
 * executor rejects and `start()` below is never reached - which is the outcome
 * to want.
 */
function attempt(
  Recognition: OnDeviceCapable,
  tag: string,
  processLocally: boolean,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const recognition = new Recognition();
    recognition.processLocally = processLocally;
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
      // `start()` on a recognizer that is already running throws, and that is
      // the one failure the API reports this way rather than through `onerror`.
      settled = true;
      reject(
        new SpeechFailureError(
          'busy',
          cause instanceof Error ? cause.message : 'The recognizer is already listening.',
        ),
      );
    }
  });
}

export function createWebSpeechRecognizer(): SpeechRecognizer {
  /**
   * What the device itself can do, with no regard for what the user permits.
   *
   * Kept separate from `availability` because `listen` needs the plain fact:
   * whether to attempt locally is not a question about anybody's settings.
   */
  async function onDeviceState(tag: string): Promise<SpeechAvailability> {
    const Recognition = api();
    if (Recognition === undefined) return 'unavailable';
    // Without this static method the browser has only the networked mode and no
    // way to be asked about locality, which this application does not use under
    // any circumstance - including the retry.
    if (typeof Recognition.availableOnDevice !== 'function') return 'unavailable';

    const state = await Recognition.availableOnDevice(tag).catch(() => 'unavailable');
    if (state === 'available') return 'ready';
    if (state === 'downloadable' || state === 'downloading') return 'installable';
    return 'unavailable';
  }

  async function availability(
    tag = 'pt-BR',
    options?: SpeechOptions,
  ): Promise<SpeechAvailability> {
    const Recognition = api();
    if (Recognition === undefined) return 'unavailable';
    if (typeof Recognition.availableOnDevice !== 'function') return 'unavailable';

    const local = await onDeviceState(tag);
    if (local !== 'unavailable') return local;

    // Nothing on the device and nothing to download, but a failed on-device
    // attempt gets a second one over the network, so the honest answer to "can
    // this device transcribe" is still `ready`. It goes back to `unavailable`
    // the moment the user forbids that.
    return options?.offlineOnly === true ? 'unavailable' : 'ready';
  }

  return {
    availability,

    async install(tag: string): Promise<boolean> {
      const Recognition = api();
      if (typeof Recognition?.installOnDevice !== 'function') return false;
      return Recognition.installOnDevice(tag).catch(() => false);
    },

    async listen(tag: string, options?: SpeechOptions): Promise<Transcript> {
      const Recognition = api();
      if (Recognition === undefined) {
        throw new SpeechFailureError('no-recognizer', 'Speech recognition is unavailable.');
      }

      // Step one, always, and always local.
      let first: SpeechFailureError;
      if ((await onDeviceState(tag)) === 'ready') {
        try {
          return { text: await attempt(Recognition, tag, true), online: false };
        } catch (cause) {
          first = asSpeechFailure(cause);
        }
      } else {
        // Checked before construction, so a device without the language never
        // reaches `start()` in the local mode it could not have honoured.
        first = new SpeechFailureError('no-offline-model', `No on-device speech model for ${tag}.`);
      }

      if (!mayRetryOnline(first, options)) throw first;

      // Step two. Once, and the failure it reports is still the first one -
      // see `reportedFailure`.
      try {
        return { text: await attempt(Recognition, tag, false), online: true };
      } catch (again) {
        throw reportedFailure(first, again);
      }
    },
  };
}
