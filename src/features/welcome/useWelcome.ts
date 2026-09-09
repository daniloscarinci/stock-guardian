/**
 * Saying it, once, on the way in.
 *
 * Mounted in the shell beside `useExpiryNotifications`, above the routes and
 * below the router, so it runs for the whole session whatever screen is showing.
 * It is handed the dashboard counts the shell has already loaded for the
 * navigation badge; it starts no query of its own.
 *
 * ONCE PER LAUNCH, NOT PER NAVIGATION. The shell mounts once and stays mounted
 * while every route inside it comes and goes, so the ref below is a launch and
 * not a screen. It is taken the moment the counts arrive, BEFORE the setting is
 * consulted: a person who switches the greeting on at eleven in the morning is
 * asking to be greeted tomorrow, not this second, and the alternative is an
 * application that says good morning in the middle of somebody changing a
 * setting.
 *
 * IT NEVER DELAYS THE INTERFACE. Everything here happens in an effect, after
 * paint, and the speaking itself is not awaited by anything that renders. The
 * application is drawn, interactive and scrollable before a word is said, and
 * every path out of this - no counts yet, the setting off, the phone silenced,
 * something already speaking, an engine that never starts - is a return, never
 * a wait.
 *
 * THREE THINGS CAN SILENCE IT, AND EACH IS SOMEBODY ELSE'S DECISION:
 *
 *   - The setting, which is the person's.
 *   - The switch on the side of the phone, which is also the person's, and wins
 *     over the setting for the same reason it does everywhere else here.
 *   - Something already being read, which is an answer somebody actually asked
 *     for. A greeting must never talk over one. The reverse is allowed on
 *     purpose: an answer requested a moment later flushes the greeting, because
 *     between a pleasantry and the thing that was asked for, the thing that was
 *     asked for wins.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '../../app/AppContext';
import { LOCALE_TAGS } from '../../i18n/translate';
import { createSpeaker, isSpeaking } from '../../services/speech/speak';
import { androidIsSilent } from '../../services/speech/ringer';
import { composeWelcome } from './welcome';
import type { DashboardStats } from '../../repositories/items.repository';

export function useWelcome(stats: DashboardStats | undefined): void {
  const { t, settings } = useApp();

  /** One launch, one greeting. Survives every navigation and every re-render. */
  const taken = useRef(false);

  useEffect(() => {
    // Nothing to report yet. The counts are loaded asynchronously like
    // everything else, and a greeting with no news in it is not the greeting.
    if (stats === undefined) return;

    if (taken.current) return;
    taken.current = true;

    if (!settings.voiceSpeakWelcome) return;

    const text = composeWelcome(
      t,
      {
        expired: stats.expired,
        expiringToday: stats.expiringToday,
        expiringSoon: stats.expiringSoon,
        // Critical and low are one fact to somebody being spoken to: there is
        // less of it than there should be.
        belowMinimum: stats.critical + stats.low,
        // The furthest window, because that is the horizon `dashboardStats`
        // counts `expiringSoon` against. Saying "soon" instead would be shorter
        // and would mean nothing.
        horizonDays: Math.max(...settings.expiryWarningDays),
      },
      new Date().getHours(),
    );

    void (async () => {
      if (await androidIsSilent()) return;
      /*
       * Checked immediately before speaking rather than at the top, because the
       * two awaits above take real time on a phone. Between this check and the
       * sentence there is still a gap in which an answer could start, and if it
       * does the answer's own flush wins - which is the right way round.
       */
      if (await isSpeaking()) return;

      await createSpeaker(
        () => settings.voiceSpeakWelcome,
        () => settings.speakingVoiceUri,
      ).say(text, LOCALE_TAGS[settings.language]);
    })();
  }, [stats, settings, t]);
}
