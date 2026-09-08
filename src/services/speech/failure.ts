/**
 * Why the microphone did not produce a sentence.
 *
 * The codes are the contract between `SpeechPlugin.java`, the two web
 * recognizers and the interface. They are deliberately machine-readable and
 * deliberately not prose: the plugin cannot know the user's language, and the
 * locale files cannot know what Android returned. Each side does the part it
 * can.
 *
 * The bug this exists to end: the plugin used to answer every unsuccessful
 * outcome with "cancelled", and the interface shows nothing for a cancellation
 * because a banner after a deliberate "never mind" teaches people to ignore
 * banners. Both decisions were right on their own, and together they made a
 * microphone that failed in total silence on a phone with no offline model.
 *
 * THESE CODES ARE NOW EXACT ON ANDROID, AND THEY USED NOT TO BE. The plugin
 * bound the system recognizer through an Intent, which carries no error, so a
 * refusal was told apart from a cancellation by how fast the dialog came back.
 * That guess is gone: SpeechPlugin binds `SpeechRecognizer` directly and reads
 * the constants `RecognitionListener.onError` delivers, including the two that
 * name a missing offline model. Nothing here infers a reason from a stopwatch
 * any more.
 */

/** Every reason a listen can end without a transcript. */
export const SPEECH_FAILURES = [
  /** The user pressed back. The only one the interface answers with silence. */
  'cancelled',
  /** No speech model on the device for this language, so nothing could listen. */
  'no-offline-model',
  /** Nothing on this device transcribes speech at all. */
  'no-recognizer',
  /** The recognizer went looking for a network and did not find one. */
  'network',
  /** It listened and made nothing of what it heard. */
  'no-match',
  /** Something else holds the recognizer, or one listen is already running. */
  'busy',
  /**
   * The microphone permission was refused, and can be asked for again.
   *
   * A refusal, not a fault. The next press shows the system's prompt again,
   * because Android still considers this one askable.
   */
  'permission-denied',
  /**
   * Refused for good: Android will not show the prompt again.
   *
   * The two are separate because the ways out are separate. Asking again here
   * is a dialog into a void - the request returns instantly, nothing appears,
   * and the microphone stays shut. The only way back is the application's own
   * page in Settings, which is why the interface offers it for this code and
   * not for the other.
   */
  'permission-blocked',
  /** Everything else, including the reasons a platform declines to name. */
  'failed',
] as const;

export type SpeechFailure = (typeof SPEECH_FAILURES)[number];

const KNOWN = new Set<string>(SPEECH_FAILURES);

/**
 * A rejection that already knows its reason.
 *
 * The message stays a sentence so a stack trace and a `toThrow(/.../)` are
 * still readable; `reason` is what the interface branches on.
 */
export class SpeechFailureError extends Error {
  readonly reason: SpeechFailure;

  constructor(reason: SpeechFailure, message?: string) {
    super(message ?? reason);
    this.name = 'SpeechFailureError';
    this.reason = reason;
  }
}

/**
 * Substring rules, in the order they are tried.
 *
 * Order carries meaning here. "language unavailable" contains "unavailable", so
 * the missing-model rule has to be tried before the no-recognizer one, or a
 * phone that is missing one language would be reported as a phone that cannot
 * transcribe at all.
 */
const RULES: readonly (readonly [RegExp, SpeechFailure])[] = [
  // Both before the rules below, because "permission denied" would otherwise
  // fall through to `failed` and lose the one failure with a way out under it.
  [/never.?ask|permanently.?denied/, 'permission-blocked'],
  [/permission|not.?allowed/, 'permission-denied'],
  [/cancel|abort/, 'cancelled'],
  [/offline.?model|on-device|language.?(not.?supported|unavailable|not.?available)/, 'no-offline-model'],
  [/no.?recognizer|unavailable|not available/, 'no-recognizer'],
  [/network|server/, 'network'],
  [/no.?match|no.?speech|nothing was heard|empty/, 'no-match'],
  [/busy|already started|invalidstate/, 'busy'],
];

/**
 * Reads a reason out of whatever the platform threw.
 *
 * Three shapes reach here. A `SpeechFailureError`, which says so outright. A
 * Capacitor bridge rejection, whose message is the bare code the plugin passed
 * to `call.reject`. And anything else at all, which falls through the rules to
 * `failed` - because an unrecognised failure is still a failure, and answering
 * "cancelled" to one is exactly the bug this module exists to prevent.
 */
export function speechFailureReason(cause: unknown): SpeechFailure {
  if (cause instanceof SpeechFailureError) return cause.reason;

  const source = cause as { reason?: unknown; code?: unknown; message?: unknown } | null;
  for (const candidate of [source?.reason, source?.code, source?.message]) {
    if (typeof candidate === 'string' && KNOWN.has(candidate)) return candidate as SpeechFailure;
  }

  const text = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  if (KNOWN.has(text.trim())) return text.trim() as SpeechFailure;

  for (const [pattern, reason] of RULES) {
    if (pattern.test(text)) return reason;
  }
  return 'failed';
}

/**
 * The same rejection, as an error that carries its reason.
 *
 * A recognizer that means to try again has to hold on to what went wrong the
 * first time, and a bare bridge rejection is not a shape worth carrying. This
 * reads the reason once, at the boundary, and everything after it branches on
 * a field rather than on a regular expression.
 */
export function asSpeechFailure(cause: unknown): SpeechFailureError {
  if (cause instanceof SpeechFailureError) return cause;
  return new SpeechFailureError(
    speechFailureReason(cause),
    cause instanceof Error ? cause.message : String(cause),
  );
}
