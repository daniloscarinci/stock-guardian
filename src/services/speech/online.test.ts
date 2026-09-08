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
   * Broadly, not on a diagnosis. The Intent flow cannot name a missing language
   * pack, so a retry that waited for certainty would never run on the phone
   * this exists for.
   */
  it.each(['no-offline-model', 'failed', 'no-match', 'network', 'busy', 'no-recognizer'])(
    'retries after %s',
    (reason) => {
      vi.stubGlobal('navigator', { onLine: true });
      expect(mayRetryOnline(new Error(reason))).toBe(true);
    },
  );
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
