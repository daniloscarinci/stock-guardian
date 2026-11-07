/**
 * Backup status and reminder controls, inside the Backup card in Settings.
 *
 * The status line is shown whether or not the reminder is on: Settings is where
 * somebody goes to ask "when did I last do this". The switch only governs the
 * dashboard.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { SelectField, SwitchRow } from '../../components/ui/Field';
import { parseInstant, reminderDayChoices, wholeDaysBetween } from '../../domain/backup-reminder';
import { formatDaysAgo } from '../../i18n/relative-time';

export function BackupReminderSettings() {
  const { t, settings, updateSettings } = useApp();

  // Read once, when the panel is shown: a lazy initialiser, because a render must
  // not call the clock itself.
  const [nowMs] = useState(() => Date.now());

  const lastMs = parseInstant(settings.lastBackupAt);
  const status =
    lastMs === null
      ? t('backup.reminderNever')
      : t('backup.reminderStatus', {
          when: formatDaysAgo(settings.language, wholeDaysBetween(lastMs, nowMs)),
        });

  const muted = { color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' } as const;

  return (
    <div style={{ marginTop: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
      <p role="status">{status}</p>

      <SwitchRow
        label={t('backup.reminderSwitch')}
        checked={settings.backupReminderEnabled}
        onChange={(checked) => {
          void updateSettings({ backupReminderEnabled: checked });
        }}
      />

      <SelectField
        label={t('backup.reminderAfter')}
        value={String(settings.backupReminderDays)}
        disabled={!settings.backupReminderEnabled}
        onChange={(event) => {
          void updateSettings({ backupReminderDays: Number(event.target.value) });
        }}
      >
        {reminderDayChoices(settings.backupReminderDays).map((days) => (
          <option key={days} value={String(days)}>
            {t('backup.reminderDaysOption', { count: days })}
          </option>
        ))}
      </SelectField>

      <p style={muted}>{t('backup.reminderAdvice')}</p>
      <p style={muted}>{t('backup.keyNotIncluded')}</p>
    </div>
  );
}
