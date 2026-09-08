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
  isSilent: vi.fn(async () => ({ silent: true })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => capacitor.platform,
  },
  registerPlugin: () => ({ isSilent: capacitor.isSilent }),
}));

const { androidIsSilent, isNativeAndroid } = await import('./ringer');

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
});

describe('on Android', () => {
  it('reads the ringer switch', async () => {
    onAndroid();
    await expect(androidIsSilent()).resolves.toBe(true);
  });

  /*
   * A rejected bridge call must not become an exception in the interface. An
   * older APK may not carry this plugin at all - the one it replaces was named
   * `Speech` - and an application that throws rather than speaks is worse than
   * one that speaks when it might have kept quiet.
   */
  it('treats a failed silence check as not silenced', async () => {
    onAndroid();
    capacitor.isSilent.mockRejectedValueOnce(new Error('no such plugin'));
    await expect(androidIsSilent()).resolves.toBe(false);
  });
});
