import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speechFailureReason } from './failure';

/*
 * The plugin proxy is created when the module loads, so the mock has to exist
 * before the import. `vi.mock` is hoisted above it, and the state below lives
 * in a factory-scoped object because the factory may not close over anything
 * declared later in the file.
 *
 * The ringer switch is not here. It is a separate plugin over a separate
 * module, and ringer.test.ts is where it is pinned; this file is about the
 * microphone and nothing else.
 */
const capacitor = vi.hoisted(() => ({
  native: false,
  platform: 'web',
  listen: vi.fn(async () => ({ transcript: 'dez latas' })),
  availability: vi.fn(async () => ({ state: 'ready', onDevice: 'installed' })),
  cancel: vi.fn(async () => undefined),
  openSettings: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => capacitor.platform,
  },
  registerPlugin: () => ({
    listen: capacitor.listen,
    availability: capacitor.availability,
    cancel: capacitor.cancel,
    openSettings: capacitor.openSettings,
  }),
}));

const { createCapacitorRecognizer, isNativeAndroid, openAppSettings } = await import(
  './capacitor'
);

/** Pretends the code is running inside the APK. */
function onAndroid(): void {
  capacitor.native = true;
  capacitor.platform = 'android';
}

/** What `navigator.onLine` says. The retry reads it and nothing else does. */
function connectivity(online: boolean): void {
  vi.stubGlobal('navigator', { onLine: online });
}

/** Every `preferOffline` the plugin was asked for, in order. */
function modes(): boolean[] {
  return capacitor.listen.mock.calls.map(
    (call) => (call as unknown as [{ preferOffline: boolean }])[0].preferOffline,
  );
}

/*
 * Reset rather than cleared. `mockRejectedValue` sets an implementation, and
 * `clearAllMocks` leaves implementations in place - a persistent rejection
 * installed to make BOTH attempts fail would otherwise leak into the next test
 * and fail it somewhere unrelated.
 */
beforeEach(() => {
  capacitor.native = false;
  capacitor.platform = 'web';
  connectivity(true);
  capacitor.listen.mockReset();
  capacitor.listen.mockResolvedValue({ transcript: 'dez latas' });
  capacitor.availability.mockReset();
  capacitor.availability.mockResolvedValue({ state: 'ready', onDevice: 'installed' });
  capacitor.cancel.mockReset();
  capacitor.cancel.mockResolvedValue(undefined);
  capacitor.openSettings.mockReset();
  capacitor.openSettings.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('off Android', () => {
  it('does not claim to be native', () => {
    expect(isNativeAndroid()).toBe(false);
  });

  it('is not native on an iOS build either, which has no such plugin', () => {
    capacitor.native = true;
    capacitor.platform = 'ios';
    expect(isNativeAndroid()).toBe(false);
  });

  it('reports no recognizer without asking the bridge', async () => {
    await expect(createCapacitorRecognizer().availability()).resolves.toBe('unavailable');
    expect(capacitor.availability).not.toHaveBeenCalled();
  });

  it('cancels nothing, and opens no settings page that is not there', async () => {
    await createCapacitorRecognizer().cancel?.();
    await expect(openAppSettings()).resolves.toBe(false);
    expect(capacitor.cancel).not.toHaveBeenCalled();
    expect(capacitor.openSettings).not.toHaveBeenCalled();
  });
});

describe('on Android', () => {
  it('passes the language tag to the system recognizer', async () => {
    onAndroid();
    await expect(createCapacitorRecognizer().listen('pt-BR')).resolves.toEqual({
      text: 'dez latas',
      online: false,
    });
    expect(capacitor.listen).toHaveBeenCalledWith({ lang: 'pt-BR', preferOffline: true });
  });

  it('asks about the language when checking availability', async () => {
    onAndroid();
    await expect(createCapacitorRecognizer().availability('es')).resolves.toBe('ready');
    expect(capacitor.availability).toHaveBeenCalledWith({ lang: 'es' });
  });

  it('reports the language as installable when the phone has no model for it', async () => {
    onAndroid();
    capacitor.availability.mockResolvedValueOnce({ state: 'installable', onDevice: 'missing' });
    await expect(createCapacitorRecognizer().availability('pt-BR')).resolves.toBe('installable');
  });

  it('rejects rather than resolving with a blank transcript', async () => {
    onAndroid();
    capacitor.listen.mockResolvedValue({ transcript: '   ' });
    await expect(createCapacitorRecognizer().listen('pt-BR')).rejects.toThrow(/nothing was heard/i);
  });

  /*
   * The bug this file exists to prevent coming back. Every unsuccessful outcome
   * used to arrive as "cancelled", and the interface answers a cancellation
   * with silence, so a phone with no Portuguese model had a microphone that did
   * nothing at all and never said why.
   */
  it.each([
    ['no-offline-model', 'no-offline-model'],
    ['no-recognizer', 'no-recognizer'],
    ['network', 'network'],
    ['no-match', 'no-match'],
    ['busy', 'busy'],
    ['cancelled', 'cancelled'],
    // The two the permission brought with it. A refusal is an outcome, and the
    // interface has a different answer for each: one can be asked again, one
    // cannot be asked again at all.
    ['permission-denied', 'permission-denied'],
    ['permission-blocked', 'permission-blocked'],
    ['failed', 'failed'],
  ])('carries the plugin code %s through as a reason', async (code, expected) => {
    onAndroid();
    // Both attempts, because a retry that succeeded would hide the first code.
    capacitor.listen.mockRejectedValue(new Error(code));
    const failure = await createCapacitorRecognizer()
      .listen('pt-BR')
      .catch((cause: unknown) => speechFailureReason(cause));
    expect(failure).toBe(expected);
  });

  it('calls an unrecognised rejection a failure rather than a cancellation', async () => {
    onAndroid();
    capacitor.listen.mockRejectedValue(new Error('something nobody predicted'));
    const failure = await createCapacitorRecognizer()
      .listen('pt-BR')
      .catch((cause: unknown) => speechFailureReason(cause));
    expect(failure).toBe('failed');
  });

  /*
   * The whole of the fix, and the reason this file was opened a third time.
   *
   * The phone this application was written for has no offline Portuguese pack.
   * Under the old absolute rule the recognizer refused every press and the
   * microphone appeared dead. What follows is the sequence that replaces it:
   * the device first, always, and one more try over the network when the device
   * could not do it - unless the person said no, or there is no network, or
   * they pressed back.
   */
  describe('the on-device attempt, and the one retry after it', () => {
    it('asks the device first and stops there when the device answers', async () => {
      onAndroid();
      const heard = await createCapacitorRecognizer().listen('pt-BR');

      expect(heard).toEqual({ text: 'dez latas', online: false });
      expect(modes()).toEqual([true]);
    });

    it('tries again without the offline requirement when the device fails', async () => {
      onAndroid();
      capacitor.listen.mockRejectedValueOnce(new Error('no-offline-model'));
      const heard = await createCapacitorRecognizer().listen('pt-BR');

      expect(heard).toEqual({ text: 'dez latas', online: true });
      expect(modes()).toEqual([true, false]);
    });

    /*
     * AIMED, NOT SPRAYED, AND THAT IS THE CHANGE.
     *
     * It used to retry after anything but a cancel, because the Intent flow
     * returned no error to condition on. The plugin now binds
     * `SpeechRecognizer` and reports what `RecognitionListener` said, so the
     * retry runs where a second recognizer could plausibly help: a language the
     * device does not have, a service that answered about itself, or a
     * recognizer that could not bind at all.
     */
    it.each(['no-offline-model', 'network', 'failed', 'something nobody predicted'])(
      'retries after %s, which the networked recognizer might get past',
      async (code) => {
        onAndroid();
        capacitor.listen.mockRejectedValueOnce(new Error(code));
        await expect(createCapacitorRecognizer().listen('pt-BR')).resolves.toEqual({
          text: 'dez latas',
          online: true,
        });
        expect(modes()).toEqual([true, false]);
      },
    );

    /*
     * The other half, and the more important one. Every code here means the
     * second attempt would record somebody who has stopped talking, ask again
     * for a microphone that has already been refused, or bind the same absent
     * service. `online.test.ts` states the whole table; this proves the plugin
     * path obeys it.
     */
    it.each(['no-match', 'busy', 'no-recognizer', 'permission-denied', 'permission-blocked'])(
      'never retries after %s, and reports it as it stands',
      async (code) => {
        onAndroid();
        capacitor.listen.mockRejectedValue(new Error(code));

        const failure = await createCapacitorRecognizer()
          .listen('pt-BR')
          .catch((cause: unknown) => speechFailureReason(cause));

        expect(failure).toBe(code);
        expect(modes()).toEqual([true]);
      },
    );

    it('does not retry with no connectivity, and reports the first failure', async () => {
      onAndroid();
      connectivity(false);
      capacitor.listen.mockRejectedValue(new Error('no-offline-model'));

      const failure = await createCapacitorRecognizer()
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      expect(failure).toBe('no-offline-model');
      expect(modes()).toEqual([true]);
    });

    /*
     * Pressing stop is not a failure to work around. A retry here would send a
     * recording away because somebody changed their mind, which is the worst
     * thing this feature could do.
     */
    it('never retries a deliberate cancel', async () => {
      onAndroid();
      capacitor.listen.mockRejectedValue(new Error('cancelled'));

      const failure = await createCapacitorRecognizer()
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      expect(failure).toBe('cancelled');
      expect(modes()).toEqual([true]);
    });

    it('never retries at all once the user has asked for on-device only', async () => {
      onAndroid();
      capacitor.listen.mockRejectedValue(new Error('no-offline-model'));

      for (const online of [true, false]) {
        connectivity(online);
        capacitor.listen.mockClear();
        const failure = await createCapacitorRecognizer()
          .listen('pt-BR', { offlineOnly: true })
          .catch((cause: unknown) => speechFailureReason(cause));

        expect(failure).toBe('no-offline-model');
        expect(modes()).toEqual([true]);
      }
    });

    /*
     * The stop button, which replaces the back button on a system screen that
     * no longer opens. Without it `cancelled` - the one code answered with
     * silence, and the one the retry never fires after - could not happen on
     * Android at all.
     */
    it('stops a listen in progress through the plugin', async () => {
      onAndroid();
      await createCapacitorRecognizer().cancel?.();
      expect(capacitor.cancel).toHaveBeenCalledTimes(1);
    });

    it('lets a failed cancel pass, because a closed microphone is not the caller to fix', async () => {
      onAndroid();
      capacitor.cancel.mockRejectedValueOnce(new Error('no such plugin'));
      await expect(createCapacitorRecognizer().cancel?.()).resolves.toBeUndefined();
    });

    it('opens the settings page, and says so when it could not', async () => {
      onAndroid();
      await expect(openAppSettings()).resolves.toBe(true);

      capacitor.openSettings.mockRejectedValueOnce(new Error('no such activity'));
      await expect(openAppSettings()).resolves.toBe(false);
    });

    it('retries once and once only - a failing retry does not loop', async () => {
      onAndroid();
      capacitor.listen.mockRejectedValue(new Error('failed'));

      await expect(createCapacitorRecognizer().listen('pt-BR')).rejects.toThrow();
      expect(modes()).toEqual([true, false]);
    });

    /*
     * The first failure is the one worth showing: a missing pack has install
     * steps under it, and the retry was an extra nobody asked for. The
     * exception is a cancelled retry - a banner after "never mind" is the thing
     * this feature has a rule against.
     */
    it('reports the first failure when the retry fails too', async () => {
      onAndroid();
      capacitor.listen
        .mockRejectedValueOnce(new Error('no-offline-model'))
        .mockRejectedValueOnce(new Error('network'));

      const failure = await createCapacitorRecognizer()
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      expect(failure).toBe('no-offline-model');
    });

    it('reports a cancelled retry as a cancel, so nothing is said after "never mind"', async () => {
      onAndroid();
      capacitor.listen
        .mockRejectedValueOnce(new Error('no-offline-model'))
        .mockRejectedValueOnce(new Error('cancelled'));

      const failure = await createCapacitorRecognizer()
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      expect(failure).toBe('cancelled');
    });

    it('sends the offline extra explicitly on the first attempt of every call', async () => {
      onAndroid();
      await createCapacitorRecognizer().listen('pt-BR');
      await createCapacitorRecognizer().listen('pt-BR', {});
      await createCapacitorRecognizer().listen('pt-BR', { offlineOnly: true });

      expect(modes()).toEqual([true, true, true]);
    });
  });

  /*
   * A rejected bridge call must not become an exception in the interface. The
   * plugin rejects on a cancelled listen, and an older APK may not have these
   * methods at all.
   */
  it('treats a failed bridge call as unavailable, not as an error', async () => {
    onAndroid();
    capacitor.availability.mockRejectedValueOnce(new Error('no such plugin'));
    await expect(createCapacitorRecognizer().availability()).resolves.toBe('unavailable');
  });
});
