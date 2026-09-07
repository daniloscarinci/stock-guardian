import { describe, expect, it } from 'vitest';
import { noneRecognizer } from './none';
import { SPEECH_FAILURES, SpeechFailureError, speechFailureReason } from './failure';

describe('noneRecognizer', () => {
  it('reports itself unavailable', async () => {
    expect(await noneRecognizer.availability()).toBe('unavailable');
  });

  it('rejects rather than resolving with an empty transcript', async () => {
    await expect(noneRecognizer.listen('pt-BR')).rejects.toThrow(/unavailable/i);
  });

  it('says why, rather than leaving the interface to guess', async () => {
    const failure = await noneRecognizer
      .listen('pt-BR')
      .catch((cause: unknown) => speechFailureReason(cause));
    expect(failure).toBe('no-recognizer');
  });
});

/*
 * The mapping the interface branches on. Its whole purpose is that exactly one
 * of these codes means "say nothing", and everything else means "say
 * something" - the two used to be the same value, and a microphone that failed
 * said nothing at all.
 */
describe('speechFailureReason', () => {
  it('reads the reason straight off a failure that carries one', () => {
    expect(speechFailureReason(new SpeechFailureError('no-offline-model'))).toBe('no-offline-model');
  });

  it.each(SPEECH_FAILURES)('accepts the plugin code %s verbatim', (code) => {
    expect(speechFailureReason(new Error(code))).toBe(code);
  });

  it('reads a code off a bridge rejection that carries one as a property', () => {
    expect(speechFailureReason({ code: 'network', message: 'whatever' })).toBe('network');
  });

  it.each([
    ['User cancelled the dialog', 'cancelled'],
    ['aborted by the user', 'cancelled'],
    ['No on-device speech model for pt-BR.', 'no-offline-model'],
    ['language-not-supported', 'no-offline-model'],
    ['Speech recognition is unavailable on this device.', 'no-recognizer'],
    ['a network error occurred', 'network'],
    ['Nothing was heard.', 'no-match'],
    ['recognition already started', 'busy'],
  ])('reads %s as %s', (message, expected) => {
    expect(speechFailureReason(new Error(message))).toBe(expected);
  });

  /*
   * Order matters in the rules: "language unavailable" contains "unavailable",
   * and reporting a missing language as a phone that cannot transcribe at all
   * would send the user to the wrong explanation.
   */
  it('does not mistake one missing language for a device with no recognizer', () => {
    expect(speechFailureReason(new Error('ERROR_LANGUAGE_UNAVAILABLE'))).toBe('no-offline-model');
  });

  it('calls anything it does not recognise a failure, never a cancellation', () => {
    expect(speechFailureReason(new Error('kernel panic'))).toBe('failed');
    expect(speechFailureReason(undefined)).toBe('failed');
    expect(speechFailureReason(null)).toBe('failed');
    expect(speechFailureReason(42)).toBe('failed');
  });

  it('has exactly one code that the interface answers with silence', () => {
    expect(SPEECH_FAILURES.filter((code) => code === 'cancelled')).toHaveLength(1);
  });
});
