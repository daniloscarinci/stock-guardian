/**
 * Reports.
 *
 * Four reports over the same data the rest of the application shows, each
 * exportable to CSV and printable. "Print to PDF" is the operating system's own
 * print dialog: entirely offline, no library, and honest about what it is - the
 * hint under the button says so rather than implying an embedded PDF writer.
 *
 * The screen fetches; `services/reports.ts` builds. Nothing here calculates a
 * status, a shortfall or a score - those come from `domain/`, already computed,
 * so a report can never disagree with the dashboard.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Button, Card, EmptyState, Loading } from '../../components/ui/primitives';
import { OptionChip } from '../../components/ui/Field';
import { evaluatePreparedness } from '../../domain/preparedness';
import { buildReplenishmentList } from '../../domain/replenishment';
import { formatCalendarDate } from '../../domain/dates';
import { downloadText, toCsv } from '../../services/download';
import {
  buildExpirationReport,
  buildInventoryReport,
  buildPreparednessReport,
  buildReplenishmentReport,
  reportFilename,
  reportToCsvRows,
  type Report,
  type ReportId,
} from '../../services/reports';
import { cx } from '../../components/ui/cx';
import screens from '../screens.module.css';

const REPORT_IDS: readonly ReportId[] = [
  'inventory',
  'expiration',
  'replenishment',
  'preparedness',
];

const HINT_KEY: Record<ReportId, string> = {
  inventory: 'reports.inventoryHint',
  expiration: 'reports.expirationHint',
  replenishment: 'reports.replenishmentHint',
  preparedness: 'reports.preparednessHint',
};

export function ReportsScreen() {
  const { t, repositories, itemContext, settings, revision } = useApp();
  const [selected, setSelected] = useState<ReportId>('inventory');
  const [message, setMessage] = useState<string | null>(null);

  const categories = useAsyncData(
    () => repositories.categories.list(true),
    [repositories.categories, revision],
  );

  // Every active item, in one page. A report is a whole-inventory document by
  // definition, so paginating it would be wrong; the cap is the repository's
  // own maximum and is far above any plausible household inventory.
  const items = useAsyncData(
    () =>
      repositories.items.list(itemContext, {
        limit: 500,
        sort: { field: 'name', direction: 'asc' },
        lang: settings.language,
      }),
    [repositories.items, itemContext, settings.language, revision],
  );

  const analysis = useAsyncData(
    () => repositories.items.listForAnalysis(),
    [repositories.items, revision],
  );

  const categoryName = useMemo(() => {
    const byId = new Map(
      (categories.data ?? []).map((category) => [
        category.id,
        category.names[settings.language] ?? category.names.en ?? category.id,
      ]),
    );
    return (id: string | null) => (id === null ? t('common.uncategorized') : (byId.get(id) ?? id));
  }, [categories.data, settings.language, t]);

  const report: Report | null = useMemo(() => {
    if (items.data === undefined || analysis.data === undefined) return null;

    const context = {
      t,
      dateFormat: settings.dateFormat,
      today: itemContext.today,
      categoryName,
    };

    switch (selected) {
      case 'inventory':
        return buildInventoryReport(items.data.rows, context);

      case 'expiration':
        return buildExpirationReport(items.data.rows, context);

      case 'replenishment':
        return buildReplenishmentReport(
          buildReplenishmentList({
            items: analysis.data,
            today: itemContext.today,
            defaultThreshold: itemContext.defaultThreshold,
            expiryWindows: itemContext.expiryWindows,
            dismissedItemIds: settings.replenishmentDismissed,
          }),
          context,
        );

      case 'preparedness':
        return buildPreparednessReport(
          evaluatePreparedness({
            items: analysis.data,
            today: itemContext.today,
            defaultThreshold: itemContext.defaultThreshold,
            trackedCategoryIds: settings.preparednessCategoryIds,
            expiryWindows: itemContext.expiryWindows,
          }),
          context,
        );
    }
  }, [selected, items.data, analysis.data, itemContext, settings, t, categoryName]);

  const exportCsv = () => {
    if (report === null) return;
    const { headers, rows } = reportToCsvRows(report);
    const filename = reportFilename(report);
    downloadText(filename, toCsv(headers, rows), 'text/csv');
    setMessage(t('backup.exported', { filename }));
  };

  const loading = items.loading && items.data === undefined;

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('reports.title')}</h1>
          <p className={screens.pageSubtitle}>{t('reports.subtitle')}</p>
        </div>
        {report !== null && !report.empty && (
          <div className={cx(screens.pageActions, 'no-print')}>
            <Button onClick={exportCsv}>{t('reports.exportCsv')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                window.print();
              }}
            >
              {t('reports.printReport')}
            </Button>
          </div>
        )}
      </header>

      {/* The chooser is interface, not document: it does not print. */}
      <div className={cx(screens.toolbar, 'no-print')}>
        {REPORT_IDS.map((id) => (
          <OptionChip
            key={id}
            type="radio"
            name="report"
            checked={selected === id}
            onChange={() => {
              setSelected(id);
              setMessage(null);
            }}
          >
            {t(`reports.${id}`)}
          </OptionChip>
        ))}
      </div>

      <p className={cx(screens.pageSubtitle, 'no-print')}>{t(HINT_KEY[selected])}</p>

      {message !== null && (
        <div className="no-print">
          <Alert tone="ok">{message}</Alert>
        </div>
      )}

      {loading || report === null ? (
        <Loading label={t('common.loading')} />
      ) : report.empty ? (
        <EmptyState
          title={
            selected === 'inventory' || selected === 'preparedness'
              ? t('reports.nothingToReport')
              : t('reports.allClear')
          }
        />
      ) : (
        <article>
          <header style={{ marginBottom: 'var(--space-4)' }}>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>{report.title}</h2>
            <p className={screens.itemMeta}>
              {t('reports.generatedOn', {
                date: formatCalendarDate(report.generatedOn, settings.dateFormat),
              })}
            </p>
          </header>

          {report.summary.length > 0 && (
            <Card title={t('reports.summary')} className={screens.printCard}>
              <dl className={screens.definitionList}>
                {report.summary.map((entry) => (
                  <div key={entry.label} style={{ display: 'contents' }}>
                    <dt>{entry.label}</dt>
                    <dd>{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {report.sections.map((section, index) => (
            <Card
              key={section.title ?? String(index)}
              title={section.title}
              className={screens.printCard}
            >
              <div className={screens.tableWrap}>
                <table className={screens.table}>
                  <thead>
                    <tr>
                      {section.columns.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          className={column.numeric === true ? screens.numeric : undefined}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={
                              section.columns[cellIndex]?.numeric === true
                                ? screens.numeric
                                : undefined
                            }
                          >
                            {cell === null || cell === '' ? (
                              <span className={screens.emptyValue}>—</span>
                            ) : (
                              cell
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          <p className={cx(screens.itemMeta, 'no-print')} style={{ marginTop: 'var(--space-4)' }}>
            {t('reports.printHint')}
          </p>
        </article>
      )}
    </div>
  );
}
