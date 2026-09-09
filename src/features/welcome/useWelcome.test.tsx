// @vitest-environment happy-dom
/**
 * The welcome as it actually fires: once, on the way in, and not otherwise.
 *
 * Three things are stubbed and nothing else. The application context, so the
 * settings and the language can be moved between tests without a database. The
 * speaker, so NOTHING HERE MAKES A SOUND. And the phone's silent switch, which
 * has no answer outside an APK.
 *
 * `composeWelcome` is real, so the sentence asserted below is the sentence the
 * phone would say.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';
import { translate } from '../../i18n/translate';
import type { DashboardStats } from '../../repositories/items.repository';

const mocks = vi.hoisted(() => ({
  app: { value: undefined as unknown },
  say: vi.fn(async (_text: string, _tag: string) => undefined),
  stop: vi.fn(),
  speaking: vi.fn(async () => false),
  silent: vi.fn(async () => false),
  /** What `createSpeaker` was built with, so the settings it reads can be checked. */
  built: [] as { enabled: () => boolean; chosen: () => string }[],
}));

vi.mock('../../app/AppContext', () => ({
  useApp: () => mocks.app.value,
}));

vi.mock('../../services/speech/speak', () => ({
  createSpeaker: (enabled: () => boolean, chosen: () => string) => {
    mocks.built.push({ enabled, chosen });
    return { say: mocks.say, stop: mocks.stop };
  },
  isSpeaking: mocks.speaking,
}));

vi.mock('../../services/speech/ringer', () => ({
  androidIsSilent: mocks.silent,
}));

const { useWelcome } = await import('./useWelcome');

const NOTHING_WRONG: DashboardStats = {
  totalItems: 12,
  totalQuantity: 40,
  categoriesUsed: 3,
  locationsUsed: 2,
  expired: 0,
  expiringToday: 0,
  expiringSoon: 0,
  noExpiration: 12,
  critical: 0,
  low: 0,
  archived: 0,
  recentlyModified: 0,
};

function withSettings(patch: Partial<Settings>): void {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...patch };
  mocks.app.value = {
    settings,
    t: (key: string, values?: Record<string, string | number>) =>
      translate(settings.language, key, values),
  };
}

/** Renders the hook and lets its effect's promises settle. */
async function launch(stats: DashboardStats | undefined) {
  const view = renderHook(({ counts }: { counts: DashboardStats | undefined }) => {
    useWelcome(counts);
  }, { initialProps: { counts: stats } });

  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  // Nine in the morning, so the greeting is stable whenever this suite runs.
  vi.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
  mocks.built.length = 0;
  // `clearAllMocks` forgets the calls and keeps the implementations, so the
  // answers have to be put back or one test's silenced phone becomes the next
  // test's.
  mocks.silent.mockResolvedValue(false);
  mocks.speaking.mockResolvedValue(false);
  withSettings({ language: 'pt-BR' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useWelcome', () => {
  it('speaks once the counts have arrived', async () => {
    await launch(NOTHING_WRONG);

    expect(mocks.say).toHaveBeenCalledOnce();
    expect(mocks.say).toHaveBeenCalledWith('Bom dia. Nada precisa de atenção.', 'pt-BR');
  });

  it('says what needs attention, not just hello', async () => {
    await launch({ ...NOTHING_WRONG, expired: 2, expiringToday: 1 });

    expect(mocks.say).toHaveBeenCalledWith(
      'Bom dia. 2 itens venceram. Um item vence hoje.',
      'pt-BR',
    );
  });

  it('speaks the interface language', async () => {
    withSettings({ language: 'en' });
    await launch(NOTHING_WRONG);

    expect(mocks.say).toHaveBeenCalledWith('Good morning. Nothing needs your attention.', 'en');
  });

  // The counts load asynchronously like everything else here. A greeting with
  // no news in it is not the greeting, so it waits rather than guessing zero.
  it('says nothing while the counts are still loading', async () => {
    await launch(undefined);
    expect(mocks.say).not.toHaveBeenCalled();
  });

  /*
   * ONCE PER LAUNCH. The shell mounts once and every route inside it comes and
   * goes underneath, so a re-render is a navigation and must not be a second
   * greeting.
   */
  describe('once per launch', () => {
    it('does not speak again when the shell re-renders', async () => {
      const view = await launch(NOTHING_WRONG);

      view.rerender({ counts: NOTHING_WRONG });
      view.rerender({ counts: NOTHING_WRONG });
      await act(async () => {
        await Promise.resolve();
      });

      expect(mocks.say).toHaveBeenCalledOnce();
    });

    /*
     * Every write in this application bumps `revision`, which re-runs the
     * dashboard query and produces a NEW counts object. Adding an item must not
     * be greeted.
     */
    it('does not speak again when a write produces new counts', async () => {
      const view = await launch(NOTHING_WRONG);

      view.rerender({ counts: { ...NOTHING_WRONG, totalItems: 13 } });
      await act(async () => {
        await Promise.resolve();
      });

      expect(mocks.say).toHaveBeenCalledOnce();
    });

    /*
     * The launch's one chance is taken when the counts arrive, whatever the
     * setting says. Somebody switching the greeting on at eleven in the morning
     * is asking to be greeted tomorrow, not in the middle of changing a setting.
     */
    it('does not speak when the setting is switched on mid-session', async () => {
      withSettings({ language: 'pt-BR', voiceSpeakWelcome: false });
      const view = await launch(NOTHING_WRONG);

      withSettings({ language: 'pt-BR', voiceSpeakWelcome: true });
      view.rerender({ counts: NOTHING_WRONG });
      await act(async () => {
        await Promise.resolve();
      });

      expect(mocks.say).not.toHaveBeenCalled();
    });
  });

  describe('what keeps it quiet', () => {
    it('says nothing when the setting is off', async () => {
      withSettings({ voiceSpeakWelcome: false });
      await launch(NOTHING_WRONG);

      expect(mocks.say).not.toHaveBeenCalled();
      // Not even built: nothing is composed for a greeting nobody wants.
      expect(mocks.built).toHaveLength(0);
    });

    it('says nothing when the phone is on silent', async () => {
      mocks.silent.mockResolvedValue(true);
      await launch(NOTHING_WRONG);

      expect(mocks.say).not.toHaveBeenCalled();
    });

    /*
     * A greeting must never talk over an answer somebody actually asked for.
     * The reverse is allowed: an answer that starts a moment later flushes the
     * greeting, because between a pleasantry and the thing that was asked for,
     * the thing that was asked for wins.
     */
    it('says nothing while something else is being read', async () => {
      mocks.speaking.mockResolvedValue(true);
      await launch(NOTHING_WRONG);

      expect(mocks.say).not.toHaveBeenCalled();
    });

    it('checks the phone before it checks whether anything is playing', async () => {
      mocks.silent.mockResolvedValue(true);
      await launch(NOTHING_WRONG);

      // A silenced phone is answered without asking the engine anything at all.
      expect(mocks.speaking).not.toHaveBeenCalled();
    });
  });

  /*
   * The speaker is built with the settings as functions, exactly as the ask
   * sheet builds it, so the seam's own guard is honoured as well as this
   * hook's - and the chosen voice is the same one answers are read in.
   */
  it('builds the speaker from the settings rather than from a captured value', async () => {
    withSettings({ speakingVoiceUri: 'pt-br-x-afm#female_1-local' });
    await launch(NOTHING_WRONG);

    const speaker = mocks.built[0];
    expect(speaker?.enabled()).toBe(true);
    expect(speaker?.chosen()).toBe('pt-br-x-afm#female_1-local');
  });
});
