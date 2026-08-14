/**
 * What the user sees when the application cannot start.
 *
 * Each failure gets its own explanation and its own way forward. Two rules hold
 * throughout: never show a raw JavaScript error as the primary message, and
 * never offer to delete anything. A user whose database is damaged or newer
 * than this build wants their data back - handing them a "reset" button is how
 * they lose it for good.
 */
import { useState } from 'react';
import type { StartupFailure } from './bootstrap';
import { Button } from '../components/ui/primitives';
import { translate } from '../i18n/translate';
import { serializeBackup, backupFilename } from '../services/backup/export.service';
import { downloadText } from '../services/download';
import type { Language } from '../domain/settings';
import styles from './StartupScreen.module.css';

/**
 * Startup failures happen before settings are readable, so the language is
 * guessed from the browser. Getting it slightly wrong is better than always
 * showing English to someone who reads neither.
 */
function guessLanguage(): Language {
  const preferred = navigator.languages ?? [navigator.language];
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('pt')) return 'pt-BR';
    if (lower.startsWith('es')) return 'es';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

export function StartupLoading() {
  const language = guessLanguage();
  return (
    <div className={styles.screen}>
      <div className={styles.loading}>
        <span className={styles.mark} aria-hidden="true">
          SG
        </span>
        <p role="status">{translate(language, 'common.loading')}</p>
      </div>
    </div>
  );
}

const TITLE_BY_KIND = {
  'insecure-context': 'errors.insecureContextTitle',
  locked: 'errors.lockedTitle',
  corrupt: 'errors.corruptTitle',
  'schema-too-new': 'errors.schemaTooNewTitle',
  unknown: 'errors.startupTitle',
} as const;

const BODY_BY_KIND = {
  'insecure-context': 'errors.insecureContextBody',
  locked: 'errors.lockedBody',
  corrupt: 'errors.corruptBody',
  'schema-too-new': 'errors.schemaTooNewBody',
  unknown: 'errors.genericBody',
} as const;

export function StartupFailureScreen({ failure }: { readonly failure: StartupFailure }) {
  const language = guessLanguage();
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(language, key, values);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const body = t(BODY_BY_KIND[failure.kind], {
    database: failure.databaseVersion ?? 0,
    supported: failure.supportedVersion ?? 0,
  });

  // Offered whenever the database opened far enough to be read, which is the
  // whole point of keeping the driver on the failure object.
  const canExport = failure.db !== null;

  const handleExport = async () => {
    if (failure.db === null) return;
    setExporting(true);
    setExportError(null);
    try {
      const json = await serializeBackup(failure.db, { includeTransactions: true });
      downloadText(backupFilename(), json, 'application/json');
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.panel} role="alert">
        <p className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            SG
          </span>
          {t('app.name')}
        </p>

        <h1 className={styles.title}>{t(TITLE_BY_KIND[failure.kind])}</h1>
        <p className={styles.body}>{body}</p>

        <div className={styles.actions}>
          {canExport && (
            <Button variant="primary" onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? t('common.loading') : t('errors.exportAnyway')}
            </Button>
          )}
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('errors.reload')}
          </Button>
        </div>

        {exportError !== null && <p className={styles.body}>{exportError}</p>}

        {/* Kept out of the way: useful to a developer, noise to everyone else. */}
        <details className={styles.details}>
          <summary>{t('errors.technicalDetails')}</summary>
          <p className={styles.detailsBody}>{failure.detail}</p>
        </details>
      </div>
    </div>
  );
}
