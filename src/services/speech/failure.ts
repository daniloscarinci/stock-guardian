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
