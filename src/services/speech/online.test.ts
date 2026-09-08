import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceIsOnline, mayRetryOnline, reportedFailure } from './online';
import { SpeechFailureError } from './failure';

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * The policy both recognizers share. It is tested here as well as through them
 * because it is the whole of what decides whether a recording leaves the phone,
 * and a rule that lives in one file should be readable in one file.
 */
describe('deviceIsOnline', () => {
  it('believes a definite no', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(deviceIsOnline()).toBe(false);
  });

  it('believes a definite yes', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(deviceIsOnline()).toBe(true);
  });

  /*
   * It reports the radio, not whether anything is reachable, so it is read as a
   * hint in one direction. Where there is no answer the retry runs and either
   * works or fails with the failure that was already going to be reported;
   * refusing to try would cost the feature to save a second.
   */
  it.each([
    ['no onLine property', {}],
    ['no navigator at all', undefined],
    ['something that is not a boolean', { onLine: 'yes' }],
  ])('treats %s as worth trying', (_case, nav) => {
    vi.stubGlobal('navigator', nav);
    expect(deviceIsOnline()).toBe(true);
  });
});

describe('mayRetryOnline', () => {
  const failure = new SpeechFailureError('no-offline-model');

  it('allows the retry on a failure, with a connection and no refusal', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(mayRetryOnline(failure)).toBe(true);
    expect(mayRetryOnline(failure, {})).toBe(true);
    expect(mayRetryOnline(failure, { offlineOnly: false })).toBe(true);
  });

  it('refuses when the user has said on-device only, connection or not', () => {
    for (const onLine of [true, false]) {
      vi.stubGlobal('navigator', { onLine });
      expect(mayRetryOnline(failure, { offlineOnly: true })).toBe(false);
    }
  });

  it('refuses after a deliberate cancel, whatever else is true', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(mayRetryOnline(new SpeechFailureError('cancelled'))).toBe(false);
    expect(mayRetryOnline(new Error('User cancelled the dialog'))).toBe(false);
  });

  it('refuses when the device says it has no network', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(mayRetryOnline(failure)).toBe(false);
  });

  /*
   * THE TWO TABLES BELOW ARE THE POLICY, AND THEY USED TO BE ONE.
   *
   * The retry fired on anything that was not a cancel, because Android's
   * `ACTION_RECOGNIZE_SPEECH` returned no error and there was nothing to
   * condition on. `SpeechPlugin` now binds `SpeechRecognizer` and reads the
   * constants `RecognitionListener` delivers, so the question is answerable:
   * would a DIFFERENT recognizer, with the network this time, plausibly produce
   * the sentence?
   *
   * Both halves are pinned, because each protects the other. Widen the first
   * and audio starts leaving the phone after failures that had nothing to do
   * with the network; narrow it and the microphone dies on the device this
   * exists for.
   */
  it.each([
    // The whole reason the fallback exists: ERROR_LANGUAGE_UNAVAILABLE and
    // ERROR_LANGUAGE_NOT_SUPPORTED, which never reached an Intent result.
    'no-offline-model',
    // A service answered about itself rather than about the words.
    'network',
    // ERROR_CLIENT, ERROR_AUDIO, the plugin's watchdogs, and anything unnamed.
    // An on-device recognizer that cannot bind lands here, and that is a phone
    // this feature has to work on.
    'failed',
  ])('retries after %s, which another recognizer could get past', (reason) => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(mayRetryOnline(new Error(reason))).toBe(true);
  });

  it.each([
    // Nobody spoke. The retry is a fresh recording, not a second look at the
    // same audio, so it would open the microphone at somebody who has stopped.
    'no-match',
    // Somebody changed their mind.
    'cancelled',
    // There is no microphone to record with. A second attempt is a second
    // refusal, and for the blocked one not even a dialog.
    'permission-denied',
    'permission-blocked',
    // Nothing on this device transcribes. The fallback uses the same nothing.
    'no-recognizer',
    // Something else holds the microphone, and still will a moment later.
    'busy',
  ])('does not retry after %s, whatever the connection', (reason) => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(mayRetryOnline(new Error(reason))).toBe(false);
  });
});

describe('reportedFailure', () => {
  const first = new SpeechFailureError('no-offline-model');

  it('keeps the first failure, which is the one with an answer under it', () => {
    expect(reportedFailure(first, new SpeechFailureError('network')).reason).toBe(
      'no-offline-model',
    );
  });

  // A banner after "never mind" is the thing this feature has a rule against.
  it('reports a cancelled retry as the cancel it was', () => {
    expect(reportedFailure(first, new SpeechFailureError('cancelled')).reason).toBe('cancelled');
  });
});
