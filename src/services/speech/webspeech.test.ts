import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebSpeechRecognizer } from './webspeech';
import { speechFailureReason } from './failure';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  processLocally = false;
  continuous = false;
  interimResults = false;
  started = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  abort() {
    this.started = false;
  }
}

/** The on-device check is a static, so it outlives the test that installed it. */
function onDevice(state: string): void {
  (FakeRecognition as unknown as Record<string, unknown>).availableOnDevice = vi.fn(
    async () => state,
  );
}

/** What `navigator.onLine` says. Only the retry reads it. */
function connectivity(online: boolean): void {
  vi.stubGlobal('navigator', { onLine: online });
}

/** Waits for the nth recognizer to be constructed, then hands it over. */
async function nth(index: number): Promise<FakeRecognition> {
  await vi.waitFor(() => expect(FakeRecognition.instances[index]).toBeDefined());
  return FakeRecognition.instances[index] as FakeRecognition;
}

/** Every `processLocally` a recognizer was started with, in order. */
function modes(): boolean[] {
  return FakeRecognition.instances.filter((i) => i.started).map((i) => i.processLocally);
}

describe('webspeech recognizer', () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    // Without this, "cannot run on-device at all" would pass only while it
    // happens to run before the tests that install the static.
    delete (FakeRecognition as unknown as Record<string, unknown>).availableOnDevice;
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    connectivity(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unavailable when the API is absent', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    const recognizer = createWebSpeechRecognizer();
    expect(await recognizer.availability()).toBe('unavailable');
  });

  it('reports unavailable when the API cannot run on-device at all', async () => {
    const recognizer = createWebSpeechRecognizer();
    expect(await recognizer.availability()).toBe('unavailable');
  });

  it('reports ready when the language is present on the device', async () => {
    onDevice('available');
    const recognizer = createWebSpeechRecognizer();
    expect(await recognizer.availability('pt-BR')).toBe('ready');
  });

  it('reports installable when the language can still be downloaded', async () => {
    onDevice('downloadable');
    const recognizer = createWebSpeechRecognizer();
    expect(await recognizer.availability('pt-BR')).toBe('installable');
  });

  it('ALWAYS sets processLocally before starting', async () => {
    onDevice('available');
    const recognizer = createWebSpeechRecognizer();
    void recognizer.listen('pt-BR');

    const instance = await nth(0);
    expect(instance.processLocally).toBe(true);
    expect(instance.started).toBe(true);
  });

  /*
   * The guarantee, and the shape it now has.
   *
   * It used to read "NEVER starts without processLocally", full stop, and on
   * the phone this was written for - no offline Portuguese pack - that meant a
   * microphone that refused every single press. The rule that replaces it is
   * narrower than "sometimes online" and is pinned one clause at a time below:
   *
   *   the FIRST recognizer of every listen is always local;
   *   a recognizer without processLocally is always a SECOND one;
   *   and there is no second one after a cancel, under the user's refusal, or
   *   with no network.
   *
   * If someone makes the first attempt networked, the first two fail. If
   * someone widens what a retry is allowed after, the last three fail.
   */
  describe('the first attempt is local, and only a retry is not', () => {
    it('starts locally and stops there when the device can answer', async () => {
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const heard = recognizer.listen('pt-BR');

      (await nth(0)).onresult?.({ results: [[{ transcript: 'dez latas' }]] });

      await expect(heard).resolves.toEqual({ text: 'dez latas', online: false });
      expect(modes()).toEqual([true]);
    });

    it('never starts a networked recognizer first, even with no local model', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      const heard = recognizer.listen('pt-BR');

      // The only recognizer this listen constructs is the retry, and it is
      // reached through a failure rather than chosen up front.
      const retry = await nth(0);
      expect(retry.processLocally).toBe(false);
      expect(FakeRecognition.instances).toHaveLength(1);
      retry.onresult?.({ results: [[{ transcript: 'dez latas' }]] });

      await expect(heard).resolves.toEqual({ text: 'dez latas', online: true });
    });

    it('retries a local attempt that failed, and marks the result as online', async () => {
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const heard = recognizer.listen('pt-BR');

      (await nth(0)).onerror?.({ error: 'language-not-supported' });
      (await nth(1)).onresult?.({ results: [[{ transcript: 'dez latas' }]] });

      await expect(heard).resolves.toEqual({ text: 'dez latas', online: true });
      expect(modes()).toEqual([true, false]);
    });

    it('refuses, with no options at all, once the device is offline', async () => {
      connectivity(false);
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();

      await expect(recognizer.listen('pt-BR')).rejects.toThrow(/on-device/i);
      expect(FakeRecognition.instances).toHaveLength(0);
    });

    it('refuses whatever the connectivity when the caller forbids the network', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();

      for (const online of [true, false]) {
        connectivity(online);
        await expect(recognizer.listen('pt-BR', { offlineOnly: true })).rejects.toThrow(
          /on-device/i,
        );
      }
      expect(FakeRecognition.instances).toHaveLength(0);
    });

    it('names the refusal, so the interface can explain it', async () => {
      connectivity(false);
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      const failure = await recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));
      expect(failure).toBe('no-offline-model');
    });

    /*
     * Pressing back is not a failure to work around, and this is the clause
     * that keeps the retry from turning "never mind" into a recording sent
     * away.
     */
    it('never retries a deliberate cancel', async () => {
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const failure = recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      (await nth(0)).onerror?.({ error: 'aborted' });

      expect(await failure).toBe('cancelled');
      expect(modes()).toEqual([true]);
      expect(FakeRecognition.instances).toHaveLength(1);
    });

    it('never retries once the user has asked for on-device only', async () => {
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const failure = recognizer
        .listen('pt-BR', { offlineOnly: true })
        .catch((cause: unknown) => speechFailureReason(cause));

      // A failure the retry WOULD normally fire on, so what stops it here is
      // the refusal and nothing else.
      (await nth(0)).onerror?.({ error: 'language-not-supported' });

      expect(await failure).toBe('no-offline-model');
      expect(modes()).toEqual([true]);
    });

    /*
     * The other reason a retry does not happen, and it is a diagnosis rather
     * than a permission. `no-speech` means the person did not speak; a retry
     * would open the microphone again at somebody who has already stopped.
     * `not-allowed` means they refused it; a retry is a second refusal.
     */
    it.each([
      ['no-speech', 'no-match'],
      ['not-allowed', 'permission-denied'],
    ])('never retries after %s, whatever the connection', async (error, expected) => {
      connectivity(true);
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const failure = recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      (await nth(0)).onerror?.({ error });

      expect(await failure).toBe(expected);
      expect(modes()).toEqual([true]);
      expect(FakeRecognition.instances).toHaveLength(1);
    });

    it('never retries with no network, and reports the first failure', async () => {
      connectivity(false);
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const failure = recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      (await nth(0)).onerror?.({ error: 'language-not-supported' });

      expect(await failure).toBe('no-offline-model');
      expect(modes()).toEqual([true]);
    });

    it('retries once and once only - a failing retry does not loop', async () => {
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const failure = recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      (await nth(0)).onerror?.({ error: 'language-not-supported' });
      (await nth(1)).onerror?.({ error: 'network' });

      // The first failure, because it is the one with install steps under it.
      expect(await failure).toBe('no-offline-model');
      expect(modes()).toEqual([true, false]);
      expect(FakeRecognition.instances).toHaveLength(2);
    });
  });

  describe('availability under the refusal', () => {
    it('is ready for a language with no model, because the retry can still transcribe', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      expect(await recognizer.availability('pt-BR')).toBe('ready');
      expect(await recognizer.availability('pt-BR', { offlineOnly: false })).toBe('ready');
    });

    it('goes back to unavailable for that language once the user refuses', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      expect(await recognizer.availability('pt-BR', { offlineOnly: true })).toBe('unavailable');
    });

    it('stays unavailable on a browser that cannot be asked about locality', async () => {
      // Safari. The retry relaxes what a qualifying browser does after a
      // failure, not which browsers qualify.
      const recognizer = createWebSpeechRecognizer();
      expect(await recognizer.availability('pt-BR')).toBe('unavailable');
      expect(await recognizer.availability('pt-BR', { offlineOnly: true })).toBe('unavailable');
    });
  });

  describe('failures carry a reason', () => {
    it.each([
      ['no-speech', 'no-match'],
      ['aborted', 'cancelled'],
      ['network', 'network'],
      ['language-not-supported', 'no-offline-model'],
      // The browser's microphone refusal, which used to read as a bare
      // "failed" and told a Chrome user nothing about why.
      ['not-allowed', 'permission-denied'],
    ])('reports %s as %s', async (error, expected) => {
      // Offline, so the first failure is the one reported rather than the
      // starting point of a retry.
      connectivity(false);
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const failure = recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      (await nth(0)).onerror?.({ error });
      expect(await failure).toBe(expected);
    });

    it('reports a recognizer that is already listening as busy', async () => {
      connectivity(false);
      onDevice('available');
      vi.spyOn(FakeRecognition.prototype, 'start').mockImplementation(() => {
        throw new Error('recognition already started');
      });
      const recognizer = createWebSpeechRecognizer();
      const failure = await recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));
      expect(failure).toBe('busy');
      vi.restoreAllMocks();
    });
  });
});
