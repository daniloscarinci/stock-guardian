/**
 * The backup line, and the warning it becomes when a backup is overdue.
 *
 * Quiet by default: one line saying when you last made a backup, with a button.
 * Only when the rule in `evaluateBackupReminder` says "due" does it turn into a
 * warning. It is rendered by the dashboard only when the inventory is not empty.
 *
 * It uses the `warning` tone and the default `status` role, not `alert`: a
 * persistent banner is not urgent and must not be announced on every render.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Alert, Button } from '../../components/ui/primitives';
import { evaluateBackupReminder } from '../../domain/backup-reminder';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatDaysAgo } from '../../i18n/relative-time';
import { exportBackupToDevice } from '../../services/backup/run-export';

export function BackupReminder() {
  const { t, db, repositories, settings, revision, updateSettings } = useApp();

  const span = useAsyncData(
    () => repositories.backup.dataSpan(),
    [repositories.backup, revision],
  );

  const [busy, setBusy] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Now" is read once, when the dashboard is shown - a lazy initialiser, because
  // the clock is impure and a render must not call it. The dashboard is mounted
  // afresh every time somebody navigates to it, which is when its age matters.
  const [nowMs] = useState(() => Date.now());

  if (!settings.backupReminderEnabled || span.data === undefined) return null;

  const status = evaluateBackupReminder({
    enabled: settings.backupReminderEnabled,
    thresholdDays: settings.backupReminderDays,
    nowMs,
    lastBackupAt: settings.lastBackupAt,
    earliestDataAt: span.data.earliestAt,
    latestChangeAt: span.data.latestChangeAt,
    // The dashboard renders this only for a non-empty inventory.
    hasData: true,
  });
  if (status.kind === 'off') return null;

  const backUp = async () => {
    setBusy(true);
    setError(null);
    try {
      const { filename } = await exportBackupToDevice({
        db,
        updateSettings,
        includeTransactions: false,
      });
      setSavedAs(filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const days = status.kind === 'recent' || status.kind === 'due' ? status.days : 0;
  const showsAge = status.kind === 'recent' || (status.kind === 'due' && !status.never);
  const when = showsAge ? formatDaysAgo(settings.language, days) : '';

  const button = (
    <Button
      size="small"
      variant={status.kind === 'due' ? 'primary' : 'secondary'}
      disabled={busy}
      onClick={() => {
        void backUp();
      }}
    >
      {busy ? t('backup.backingUp') : t('backup.backUpNow')}
    </Button>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      {status.kind === 'due' ? (
        <Alert
          tone="warning"
          title={status.never ? t('backup.overdueTitleNever') : t('backup.overdueTitle', { when })}
        >
          <p>{status.never ? t('backup.overdueBodyNever') : t('backup.overdueBody')}</p>
          <div style={{ marginTop: 'var(--space-3)' }}>{button}</div>
        </Alert>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <span>
            {status.kind === 'recent'
              ? t('backup.reminderStatus', { when })
              : t('backup.reminderNever')}
          </span>
          {button}
        </div>
      )}

      {savedAs !== null && (
        <p role="status" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          {t('backup.exported', { filename: savedAs })}
        </p>
      )}
      {error !== null && (
        <Alert tone="critical" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}
