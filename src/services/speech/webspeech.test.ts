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

describe('webspeech recognizer', () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    // Without this, "cannot run on-device at all" would pass only while it
    // happens to run before the tests that install the static.
    delete (FakeRecognition as unknown as Record<string, unknown>).availableOnDevice;
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
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
    await vi.waitFor(() => expect(FakeRecognition.instances[0]).toBeDefined());

    const instance = FakeRecognition.instances[0];
    expect(instance).toBeDefined();
    expect(instance?.processLocally).toBe(true);
    expect(instance?.started).toBe(true);
  });

  /*
   * The guarantee, and the shape it now has.
   *
   * It used to read "NEVER starts when the language is not available
   * on-device", full stop. There is now exactly one way past it, and these
   * three tests are the whole of it: absent means no, an empty options object
   * means no, and only `allowOnline: true` opens the other path. If someone
   * weakens the default, the first two fail.
   */
  describe('NEVER starts without processLocally unless the user has opted in', () => {
    it('refuses, with no options at all', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();

      await expect(recognizer.listen('pt-BR')).rejects.toThrow(/on-device/i);
      expect(FakeRecognition.instances.every((i) => !i.started)).toBe(true);
    });

    it('refuses when the caller passes options that do not include the opt-in', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();

      await expect(recognizer.listen('pt-BR', {})).rejects.toThrow(/on-device/i);
      await expect(recognizer.listen('pt-BR', { allowOnline: false })).rejects.toThrow(/on-device/i);
      expect(FakeRecognition.instances.every((i) => !i.started)).toBe(true);
    });

    it('names the refusal, so the interface can explain it', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      const failure = await recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));
      expect(failure).toBe('no-offline-model');
    });

    it('starts with processLocally false ONLY once the user has opted in', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      void recognizer.listen('pt-BR', { allowOnline: true });
      await vi.waitFor(() => expect(FakeRecognition.instances[0]).toBeDefined());

      const instance = FakeRecognition.instances[0];
      expect(instance?.processLocally).toBe(false);
      expect(instance?.started).toBe(true);
    });

    /*
     * The opt-in permits the network; it does not prefer it. A device that can
     * transcribe locally still does, because sending audio away when the phone
     * could have done the job itself would be a bug rather than a preference.
     */
    it('still transcribes locally when it can, even with the opt-in on', async () => {
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      void recognizer.listen('pt-BR', { allowOnline: true });
      await vi.waitFor(() => expect(FakeRecognition.instances[0]).toBeDefined());

      expect(FakeRecognition.instances[0]?.processLocally).toBe(true);
    });
  });

  describe('availability under the opt-in', () => {
    it('stays unavailable for a language with no model, by default', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      expect(await recognizer.availability('pt-BR')).toBe('unavailable');
      expect(await recognizer.availability('pt-BR', { allowOnline: false })).toBe('unavailable');
    });

    it('becomes ready for that language once the user has opted in', async () => {
      onDevice('unavailable');
      const recognizer = createWebSpeechRecognizer();
      expect(await recognizer.availability('pt-BR', { allowOnline: true })).toBe('ready');
    });

    it('stays unavailable on a browser that cannot be asked about locality', async () => {
      // Safari. The opt-in relaxes which mode a qualifying browser may use, not
      // which browsers qualify.
      const recognizer = createWebSpeechRecognizer();
      expect(await recognizer.availability('pt-BR', { allowOnline: true })).toBe('unavailable');
    });
  });

  describe('failures carry a reason', () => {
    it.each([
      ['no-speech', 'no-match'],
      ['aborted', 'cancelled'],
      ['network', 'network'],
      ['language-not-supported', 'no-offline-model'],
      ['not-allowed', 'failed'],
    ])('reports %s as %s', async (error, expected) => {
      onDevice('available');
      const recognizer = createWebSpeechRecognizer();
      const failure = recognizer
        .listen('pt-BR')
        .catch((cause: unknown) => speechFailureReason(cause));

      await vi.waitFor(() => expect(FakeRecognition.instances[0]).toBeDefined());
      FakeRecognition.instances[0]?.onerror?.({ error });
      expect(await failure).toBe(expected);
    });

    it('reports a recognizer that is already listening as busy', async () => {
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
