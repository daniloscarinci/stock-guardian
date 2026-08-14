/**
 * Backup and restore.
 *
 * The import flow is deliberately three steps: choose a file, read what it
 * contains, then decide. Nothing is written until the user picks merge or
 * replace, and the review step states the version, the record counts, whether
 * the file has been altered since it was made, and how many items are already
 * present.
 *
 * The original application's import was a single click that replaced everything
 * with no validation, no preview and no undo.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Alert, Badge, Button, Card, Loading } from '../../components/ui/primitives';
import { SwitchRow } from '../../components/ui/Field';
import { backupFilename, serializeBackup } from '../../services/backup/export.service';
import { applyImport, inspectBackup, type ImportPreview, type ImportResult } from '../../services/backup/import.service';
import { LIMITS } from '../../services/backup/format';
import { downloadText, readFileAsText, toCsv } from '../../services/download';
import { formatCalendarDate } from '../../domain/dates';
import screens from '../screens.module.css';

export function BackupPanel() {
  const { t, db, repositories, itemContext, settings, invalidate } = useApp();

  const [includeHistory, setIncludeHistory] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const exportJson = async () => {
    setBusy('export');
    setError(null);
    try {
      const json = await serializeBackup(db, { includeTransactions: includeHistory });
      const filename = backupFilename();
      downloadText(filename, json, 'application/json');
      setMessage(t('backup.exported', { filename }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setBusy('csv');
    setError(null);
    try {
      const page = await repositories.items.list(itemContext, {
        filters: { archived: 'all' },
        limit: 500,
        lang: settings.language,
      });
      const csv = toCsv(
        [
          t('common.name'),
          t('common.category'),
          t('common.location'),
          t('common.quantity'),
          t('common.unit'),
          t('stock.minimum'),
          t('stock.target'),
          t('inventory.expirationDate'),
          t('stock.label'),
          t('expiry.label'),
          t('common.priority'),
          t('common.notes'),
        ],
        page.rows.map((item) => [
          item.name,
          item.categoryName ?? '',
          item.locationName ?? '',
          item.quantity,
          item.unit,
          item.minimumQuantity ?? '',
          item.idealQuantity ?? '',
          item.expirationDate ?? '',
          t(`stock.${item.stockStatus}`),
          t(`expiry.${item.expiryBucket}`),
          t(`priority.${item.priority}`),
          item.notes ?? '',
        ]),
      );
      const filename = `stock-guardian-inventory-${itemContext.today}.csv`;
      downloadText(filename, csv, 'text/csv');
      setMessage(t('backup.exported', { filename }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setBusy('read');
    setError(null);
    setMessage(null);
    setResult(null);
    setPreview(null);
    try {
      const text = await readFileAsText(file, LIMITS.maxFileBytes);
      setPreview(await inspectBackup(text, db));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const apply = async (mode: 'merge' | 'replace') => {
    if (preview?.payload == null) return;
    setBusy('apply');
    setError(null);
    try {
      const outcome = await applyImport(db, preview.payload, mode);
      setResult(outcome);
      setPreview(null);
      invalidate();
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : String(cause)} — ${t('backup.dataIsSafe')}`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={screens.page}>
      <Card title={t('backup.exportTitle')} hint={t('backup.exportBody')}>
        <SwitchRow
          label={t('backup.includeHistory')}
          checked={includeHistory}
          onChange={setIncludeHistory}
        />
        <div className={screens.pageActions} style={{ marginTop: 'var(--space-3)' }}>
          <Button variant="primary" onClick={() => void exportJson()} disabled={busy !== null}>
            {busy === 'export' ? t('common.loading') : t('backup.exportJson')}
          </Button>
          <Button onClick={() => void exportCsv()} disabled={busy !== null}>
            {busy === 'csv' ? t('common.loading') : t('backup.exportCsv')}
          </Button>
        </div>
      </Card>

      <Card title={t('backup.importTitle')} hint={t('backup.importBody')}>
        <label className={screens.pageActions}>
          <span className="sr-only">{t('backup.chooseFile')}</span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy !== null}
            onChange={(event) => {
              void chooseFile(event.target.files?.[0]);
              // Cleared so choosing the same file twice fires again.
              event.target.value = '';
            }}
          />
        </label>

        {busy === 'read' && <Loading label={t('backup.reading')} />}

        {preview !== null && (
          <ImportReview
            preview={preview}
            busy={busy === 'apply'}
            onCancel={() => {
              setPreview(null);
            }}
            onApply={(mode) => void apply(mode)}
          />
        )}

        {result !== null && (
          <Alert tone="ok" title={t('backup.resultTitle')}>
            <ul style={{ paddingLeft: '1.1rem' }}>
              <li>{t('backup.resultItems', { count: result.itemsInserted })}</li>
              {result.itemsSkipped > 0 && (
                <li>{t('backup.resultSkipped', { count: result.itemsSkipped })}</li>
              )}
              {result.categoriesInserted > 0 && (
                <li>{t('backup.resultCategories', { count: result.categoriesInserted })}</li>
              )}
              {result.locationsInserted > 0 && (
                <li>{t('backup.resultLocations', { count: result.locationsInserted })}</li>
              )}
            </ul>
          </Alert>
        )}
      </Card>

      {message !== null && <Alert tone="ok">{message}</Alert>}
      {error !== null && (
        <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
          {error}
        </Alert>
      )}
    </div>
  );
}

function ImportReview({
  preview,
  busy,
  onCancel,
  onApply,
}: {
  readonly preview: ImportPreview;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onApply: (mode: 'merge' | 'replace') => void;
}) {
  const { t, settings } = useApp();

  if (!preview.ok) {
    return (
      <Alert tone="critical" role="alert" title={t('backup.cannotImport')}>
        <ul style={{ paddingLeft: '1.1rem' }}>
          {preview.problems.map((problem, index) => (
            <li key={index}>{problem.detail}</li>
          ))}
        </ul>
      </Alert>
    );
  }

  const warnings = preview.problems.filter((problem) => problem.severity === 'warning');

  return (
    <div style={{ marginTop: 'var(--space-4)', display: 'grid', gap: 'var(--space-4)' }}>
      <h3>{t('backup.reviewTitle')}</h3>

      <dl className={screens.definitionList}>
        <dt>{t('backup.backupVersion')}</dt>
        <dd>
          {preview.source === 'legacy' ? t('backup.sourceLegacy') : t('backup.sourceV2')}
          {preview.appVersion === null ? '' : ` · ${preview.appVersion}`}
        </dd>

        {preview.exportedAt !== null && (
          <>
            <dt>{t('backup.backupDate')}</dt>
            <dd>
              {formatCalendarDate(preview.exportedAt.slice(0, 10), settings.dateFormat)}
            </dd>
          </>
        )}

        <dt>{t('backup.backupRecords')}</dt>
        <dd>
          {t('common.itemCount', { count: preview.counts.items })}
          {preview.counts.locations > 0 ? ` · ${String(preview.counts.locations)} ${t('nav.locations')}` : ''}
          {preview.counts.categories > 0 ? ` · ${String(preview.counts.categories)} ${t('nav.categories')}` : ''}
        </dd>

        <dt>{t('backup.compatibility')}</dt>
        <dd>
          <Badge tone="ok" glyph="✓">
            {t('backup.compatible')}
          </Badge>
        </dd>

        <dt>{t('backup.checksumOk')}</dt>
        <dd>
          {preview.checksumValid === null ? (
            <Badge tone="neutral">{t('backup.checksumMissing')}</Badge>
          ) : preview.checksumValid ? (
            <Badge tone="ok" glyph="✓">
              {t('backup.checksumOk')}
            </Badge>
          ) : (
            <Badge tone="warning" glyph="!">
              {t('common.no')}
            </Badge>
          )}
        </dd>
      </dl>

      {preview.duplicates > 0 && (
        <Alert tone="info">{t('backup.duplicatesFound', { count: preview.duplicates })}</Alert>
      )}

      {warnings.length > 0 && (
        <Alert tone="warning" title={t('backup.problemsTitle')}>
          <ul style={{ paddingLeft: '1.1rem' }}>
            {warnings.map((problem, index) => (
              <li key={index}>{problem.detail}</li>
            ))}
          </ul>
        </Alert>
      )}

      <h4>{t('backup.chooseHowTitle')}</h4>
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div>
          <Button
            variant="primary"
            onClick={() => {
              onApply('merge');
            }}
            disabled={busy}
          >
            {busy ? t('backup.applying') : t('backup.merge')}
          </Button>
          <p className={screens.itemMeta} style={{ marginTop: 'var(--space-2)' }}>
            {t('backup.mergeBody')}
          </p>
        </div>

        <div>
          <Button
            variant="danger"
            onClick={() => {
              onApply('replace');
            }}
            disabled={busy}
          >
            {t('backup.replace')}
          </Button>
          <p className={screens.itemMeta} style={{ marginTop: 'var(--space-2)' }}>
            {t('backup.replaceBody')} <strong>{t('backup.replaceWarning')}</strong>
          </p>
        </div>

        <div>
          <Button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
