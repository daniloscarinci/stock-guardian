import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The plugin proxy is created when the module loads, so the mock has to exist
 * before the import. `vi.mock` is hoisted above it, and the state below lives
 * in a factory-scoped object because the factory may not close over anything
 * declared later in the file.
 */
const capacitor = vi.hoisted(() => ({
  native: false,
  platform: 'web',
  listen: vi.fn(async () => ({ transcript: 'dez latas' })),
  availability: vi.fn(async () => ({ state: 'ready' })),
  isSilent: vi.fn(async () => ({ silent: true })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => capacitor.platform,
  },
  registerPlugin: () => ({
    listen: capacitor.listen,
    availability: capacitor.availability,
    isSilent: capacitor.isSilent,
  }),
}));

const { androidIsSilent, createCapacitorRecognizer, isNativeAndroid } = await import('./capacitor');

/** Pretends the code is running inside the APK. */
function onAndroid(): void {
  capacitor.native = true;
  capacitor.platform = 'android';
}

beforeEach(() => {
  capacitor.native = false;
  capacitor.platform = 'web';
});

afterEach(() => {
  vi.clearAllMocks();
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

  it('reports the phone as not silenced, because there is no phone', async () => {
    await expect(androidIsSilent()).resolves.toBe(false);
    expect(capacitor.isSilent).not.toHaveBeenCalled();
  });

  it('reports no recognizer without asking the bridge', async () => {
    await expect(createCapacitorRecognizer().availability()).resolves.toBe('unavailable');
    expect(capacitor.availability).not.toHaveBeenCalled();
  });
});

describe('on Android', () => {
  it('passes the language tag to the system recognizer', async () => {
    onAndroid();
    await expect(createCapacitorRecognizer().listen('pt-BR')).resolves.toBe('dez latas');
    expect(capacitor.listen).toHaveBeenCalledWith({ lang: 'pt-BR' });
  });

  it('rejects rather than resolving with a blank transcript', async () => {
    onAndroid();
    capacitor.listen.mockResolvedValueOnce({ transcript: '   ' });
    await expect(createCapacitorRecognizer().listen('pt-BR')).rejects.toThrow(/nothing was heard/i);
  });

  it('reads the ringer switch', async () => {
    onAndroid();
    await expect(androidIsSilent()).resolves.toBe(true);
  });

  /*
   * A rejected bridge call must not become an exception in the interface. The
   * plugin rejects on a cancelled dialog, and an older APK may not have these
   * methods at all.
   */
  it('treats a failed bridge call as unavailable, not as an error', async () => {
    onAndroid();
    capacitor.availability.mockRejectedValueOnce(new Error('no such plugin'));
    await expect(createCapacitorRecognizer().availability()).resolves.toBe('unavailable');
  });

  it('treats a failed silence check as not silenced', async () => {
    onAndroid();
    capacitor.isSilent.mockRejectedValueOnce(new Error('no such plugin'));
    await expect(androidIsSilent()).resolves.toBe(false);
  });
});
