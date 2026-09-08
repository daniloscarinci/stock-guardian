/**
 * Where the reminders are kept up to date, and where a tapped one lands.
 *
 * Mounted once, in the shell, so that it runs for the whole session regardless
 * of which screen is showing. Two effects and nothing else.
 *
 * THE REFRESH IS KEYED TO `revision`, WHICH IS THE APPLICATION'S "SOMETHING
 * CHANGED". Every write in this application ends with `invalidate()`, and
 * `updateSettings` bumps it too, so keying on it means the plan is recomputed
 * on start-up, after adding an item, after changing a date, after an import,
 * after archiving something, and after changing the warning windows - without
 * this hook having to enumerate those and without any of them having to know
 * that notifications exist.
 *
 * It never calls `invalidate()` itself. That would be a loop, and a loop that
 * talks to the alarm manager forty rows at a time.
 *
 * NOTHING HERE ASKS FOR A PERMISSION. `refreshExpiryNotices` checks and refuses;
 * the only prompt in this application is raised by the switch in Settings, by a
 * press. See the note at the top of `notifier.ts`.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import {
  expiryNotificationsAvailable,
  onExpiryNoticeTapped,
  refreshExpiryNotices,
} from '../../services/notifications/notifier';

export function useExpiryNotifications(): void {
  const { settings, repositories, revision, t } = useApp();
  const navigate = useNavigate();

  const enabled = settings.expiryNotificationsEnabled;
  const time = settings.expiryNotificationTime;
  /*
   * The smallest window, which is the same one `evaluateExpiry` treats as the
   * one that describes the urgency. The larger ones colour a list; a
   * notification ninety days before a tin of beans goes off is not a reminder.
   */
  const leadDays = Math.min(...settings.expiryWarningDays);

  useEffect(() => {
    // Off Android there is nothing to schedule and nothing to cancel, and the
    // query below would run on every single write for no reason.
    if (!expiryNotificationsAvailable()) return;

    let dropped = false;

    void (async () => {
      // Switched off, the items are not needed: the refresh cancels and
      // returns. Reading the whole table to throw it away would be a query per
      // write for people who never wanted this.
      const items = enabled ? await repositories.items.listForAnalysis() : [];
      if (dropped) return;

      const outcome = await refreshExpiryNotices({ enabled, items, t, leadDays, time });

      /*
       * Reported, not swallowed - but reported where a developer can see it
       * rather than as a banner over somebody's inventory. The place a person
       * finds out that Android is refusing is Settings, next to the switch that
       * caused it, and that screen asks the permission itself rather than
       * waiting to be told.
       */
      if (outcome.status === 'failed') {
        console.warn('[notifications] Android refused the reminders:', outcome.reason);
      }
    })();

    return () => {
      dropped = true;
    };
  }, [enabled, time, leadDays, revision, repositories.items, t]);

  useEffect(() => {
    return onExpiryNoticeTapped((route) => {
      void navigate(route);
    });
  }, [navigate]);
}
