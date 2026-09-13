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
  // The media volume is optional in the plugin's own result - an older APK
  // reports the ringer and nothing else - so the stub's type says so too.
  isSilent: vi.fn(async (): Promise<{ silent: boolean; mediaVolume?: number }> => ({
    silent: true,
  })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => capacitor.platform,
  },
  registerPlugin: () => ({ isSilent: capacitor.isSilent }),
}));

const { androidAudibility, androidIsSilent, isNativeAndroid } = await import('./ringer');

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
   * older APK may not carry this plugin at all - for one release this method
   * lived on the `Speech` plugin instead - and an application that throws
   * rather than speaks is worse than one that speaks when it might have kept
   * quiet.
   */
  it('treats a failed silence check as not silenced', async () => {
    onAndroid();
    capacitor.isSilent.mockRejectedValueOnce(new Error('no such plugin'));
    await expect(androidIsSilent()).resolves.toBe(false);
  });
});

/**
 * Both silences, from one bridge call.
 *
 * They are different states with different answers - the ringer switch is
 * somebody saying "not now", the media slider at zero is usually somebody who
 * does not know they moved it - and both used to be asked separately, which is
 * two `Ringer.isSilent` round trips for one plugin result. The conversation loop
 * asks before every sentence of every turn, so once matters.
 */
describe('what the phone would do with a sentence', () => {
  it('says audible off Android, and asks the bridge nothing', async () => {
    await expect(androidAudibility()).resolves.toBe('audible');
    expect(capacitor.isSilent).not.toHaveBeenCalled();
  });

  it('reads the ringer and the media volume in one call', async () => {
    onAndroid();
    capacitor.isSilent.mockResolvedValueOnce({ silent: false, mediaVolume: 7 });

    await expect(androidAudibility()).resolves.toBe('audible');
    expect(capacitor.isSilent).toHaveBeenCalledTimes(1);
  });

  it('reports a silenced phone as silenced', async () => {
    onAndroid();
    capacitor.isSilent.mockResolvedValueOnce({ silent: true, mediaVolume: 7 });
    await expect(androidAudibility()).resolves.toBe('silenced');
  });

  /*
   * The gap this closes. `TextToSpeech` plays on the media stream and the ringer
   * says nothing about it, so this phone speaks perfectly and is heard by
   * nobody - which used to be reported as an answer that had been read out.
   */
  it('reports a phone that is not silenced but cannot be heard', async () => {
    onAndroid();
    capacitor.isSilent.mockResolvedValueOnce({ silent: false, mediaVolume: 0 });
    await expect(androidAudibility()).resolves.toBe('mediaMuted');
  });

  /*
   * Both at once is `silenced`, because that is the one of the two the person
   * chose on purpose and the one whose sentence is worth showing them.
   */
  it('blames the ringer when the ringer and the volume are both against it', async () => {
    onAndroid();
    capacitor.isSilent.mockResolvedValueOnce({ silent: true, mediaVolume: 0 });
    await expect(androidAudibility()).resolves.toBe('silenced');
  });

  /*
   * An older APK reports no such field. Claiming the volume is down when nobody
   * said so would send somebody to fix a setting that was never the problem.
   */
  it('says audible when the plugin does not report a volume at all', async () => {
    onAndroid();
    capacitor.isSilent.mockResolvedValueOnce({ silent: false });
    await expect(androidAudibility()).resolves.toBe('audible');
  });

  it('says audible when the bridge call is refused outright', async () => {
    onAndroid();
    capacitor.isSilent.mockRejectedValueOnce(new Error('no such plugin'));
    await expect(androidAudibility()).resolves.toBe('audible');
  });
});
