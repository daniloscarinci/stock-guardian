/**
 * The switch that decides whether this application may interrupt somebody, and
 * the sentences that go with it.
 *
 * IT IS OFF, AND TURNING IT ON IS THE ONLY THING IN THIS APPLICATION THAT ASKS
 * ANDROID FOR THE NOTIFICATION PERMISSION. Not start-up, not the first write,
 * not a screen being opened. Somebody who never wants reminders never sees the
 * dialog, which is the same rule the microphone follows and for the same
 * reason.
 *
 * THE SWITCH IS NOT WRITTEN UNTIL THE PERMISSION IS GIVEN. A stored `true` with
 * a refused permission would be a control that says yes over a phone that says
 * no - the setting would read as on, nothing would ever arrive, and there would
 * be nothing on the screen to explain it. So the request comes first and the
 * setting is saved only on a grant.
 *
 * A REFUSAL IS SAID PLAINLY, AND THE TWO REFUSALS ARE DIFFERENT. Denied is a
 * sentence: Android will ask again, so the way forward is this switch.
 * Blocked is the panel with a button on it, because Android will NOT ask again
 * - a press would raise no dialog at all - and the only way back is this
 * application's own page in Settings. That is the shape `MicNotice` settled on
 * and it is deliberately the same shape here.
 *
 * THE COUNT SHOWN IS THE PLAN, NOT A QUERY. Asking Android what it currently
 * holds would be the more direct question and the answer would be stale for a
 * moment after every change - the alarm manager is written to by an effect in
 * the shell, and a screen that read it a beat too early would say "0 reminders
 * are set" over a phone that was in the middle of setting forty. The plan is
 * computed from the same items with the same rules, so it says what will be
 * there, and it cannot disagree with itself.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Button, Card } from '../../components/ui/primitives';
import { SwitchRow, TextField } from '../../components/ui/Field';
import {
  expiryNotificationsAvailable,
  notificationPermission,
  requestNotificationPermission,
  type NotificationRefusal,
} from '../../services/notifications/notifier';
import { planExpiryNotices } from '../../services/notifications/plan';
/*
 * The settings page belongs to this application, not to the microphone. This
 * is imported from the speech module because opening it is one Java method and
 * a second copy of it would be a second thing to keep working.
 */
import { openAppSettings } from '../../services/speech/capacitor';
import screens from '../screens.module.css';

export function NotificationsPanel() {
  const { t, settings, updateSettings, repositories, revision } = useApp();
  const [pressRefusal, setPressRefusal] = useState<NotificationRefusal | null>(null);

  const available = expiryNotificationsAvailable();
  const enabled = settings.expiryNotificationsEnabled;
  const leadDays = Math.min(...settings.expiryWarningDays);

  /*
   * Asked again on every revision, because the answer can change outside this
   * application entirely: somebody can revoke notifications in Android's own
   * settings between two visits here, and a switch still reading "on" over a
   * phone that will post nothing is exactly the silence this panel exists to
   * break.
   */
  const permission = useAsyncData(
    () => notificationPermission(),
    [available, revision],
  );

  const plan = useAsyncData(async () => {
    if (!available || !enabled) return null;
    const items = await repositories.items.listForAnalysis();
    return planExpiryNotices(items, {
      now: new Date(),
      leadDays,
      time: settings.expiryNotificationTime,
    });
  }, [available, enabled, leadDays, settings.expiryNotificationTime, repositories.items, revision]);

  // What was refused just now beats what was refused at some point in the past,
  // so that a press produces an answer about that press.
  const standing: NotificationRefusal | null =
    !enabled || permission.data === undefined || permission.data === 'granted'
      ? null
      : permission.data === 'blocked'
        ? 'permission-blocked'
        : permission.data === 'unsupported'
          ? null
          : 'permission-denied';
  const refusal = pressRefusal ?? standing;

  async function toggle(on: boolean): Promise<void> {
    setPressRefusal(null);

    if (!on) {
      // Switching off cancels what is already pending - the effect in the shell
      // does that the moment this setting changes. A switch that only stops
      // adding new reminders while a year of old ones kept arriving would not
      // be a switch.
      await updateSettings({ expiryNotificationsEnabled: false });
      return;
    }

    const answer = await requestNotificationPermission();
    if (answer === 'granted') {
      await updateSettings({ expiryNotificationsEnabled: true });
      return;
    }
    setPressRefusal(answer === 'blocked' ? 'permission-blocked' : 'permission-denied');
  }

  return (
    <Card title={t('notifications.title')} hint={t('notifications.subtitle')}>
      {!available ? (
        /*
         * A browser cannot wake this page while it is closed, so there is
         * nothing here that could work. A sentence saying so is the honest
         * version of a control that would do nothing - the same choice the
         * voice card makes about installing a language pack.
         */
        <p className={screens.pageSubtitle}>{t('notifications.unsupported')}</p>
      ) : (
        <>
          <SwitchRow
            label={t('notifications.settingEnabled')}
            help={t('notifications.settingEnabledHelp')}
            checked={enabled}
            onChange={(on) => {
              void toggle(on);
            }}
          />

          {refusal === 'permission-denied' && (
            <Alert tone="warning" role="status">
              <p>{t('notifications.permissionDenied')}</p>
            </Alert>
          )}

          {refusal === 'permission-blocked' && (
            <Alert tone="warning" role="status">
              <p>{t('notifications.permissionBlocked')}</p>
              <div className={screens.pageActions}>
                <Button
                  onClick={() => {
                    void openAppSettings();
                  }}
                >
                  {t('voice.openAppSettings')}
                </Button>
              </div>
            </Alert>
          )}

          {enabled && (
            <>
              <div className={screens.formGrid} style={{ marginTop: 'var(--space-4)' }}>
                <div>
                  <TextField
                    label={t('notifications.time')}
                    help={t('notifications.timeHelp')}
                    type="time"
                    value={settings.expiryNotificationTime}
                    onChange={(event) => {
                      // `<input type="time">` reports '' while it is being
                      // edited. Saving that would fail validation and reset the
                      // setting to 09:00 under somebody's finger.
                      const next = event.target.value;
                      if (next !== '') void updateSettings({ expiryNotificationTime: next });
                    }}
                  />
                </div>
              </div>

              <p className={screens.pageSubtitle}>{t('notifications.howItWorks')}</p>
              <p className={screens.pageSubtitle}>{t('notifications.scheduledAhead')}</p>

              {refusal === null && plan.data != null && (
                <p className={screens.pageSubtitle}>
                  {plan.data.notices.length === 0
                    ? t('notifications.scheduledNone')
                    : t('notifications.scheduled', { count: plan.data.notices.length })}
                  {plan.data.dropped > 0 && ` ${t('notifications.capped', { count: plan.data.dropped })}`}
                </p>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
