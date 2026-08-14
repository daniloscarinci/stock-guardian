/**
 * Report construction.
 *
 * Pure: every builder takes data that has already been fetched and returns a
 * structure the screen renders and the CSV exporter flattens. No database
 * access, so each one is testable on its own.
 *
 * The rule that matters: **reports never compute their own numbers.** Stock
 * status, expiry buckets, replenishment quantities and the preparedness score
 * all arrive already calculated, from the same `domain/` functions the dashboard
 * and the lists use. A report that did its own arithmetic would eventually
 * disagree with the screen the user was looking at a moment earlier, and there
 * would be no way to tell which one was lying.
 */
import { formatCalendarDate } from '../domain/dates';
import type { PreparednessReport } from '../domain/preparedness';
import type { ReplenishmentLine } from '../domain/replenishment';
import type { DateFormat } from '../domain/settings';
import type { InventoryItemView } from '../types/domain';
import type { TranslateFn } from '../i18n/translate';

export type ReportId = 'inventory' | 'expiration' | 'replenishment' | 'preparedness';

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly numeric?: boolean;
}

export type ReportCell = string | number | null;

export interface ReportSection {
  readonly title?: string;
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly (readonly ReportCell[])[];
}

export interface Report {
  readonly id: ReportId;
  readonly title: string;
  readonly generatedOn: string;
  readonly summary: readonly { readonly label: string; readonly value: string }[];
  readonly sections: readonly ReportSection[];
  /** True when there is genuinely nothing to show, so the screen can say so. */
  readonly empty: boolean;
}

interface Context {
  readonly t: TranslateFn;
  readonly dateFormat: DateFormat;
  readonly today: string;
  readonly categoryName: (id: string | null) => string;
}

const date = (value: string | null, format: DateFormat) =>
  value === null ? '' : formatCalendarDate(value, format);

/* ---- Inventory ------------------------------------------------------------ */

export function buildInventoryReport(
  items: readonly InventoryItemView[],
  context: Context,
): Report {
  const { t, dateFormat } = context;

  const columns: ReportColumn[] = [
    { key: 'name', label: t('common.name') },
    { key: 'category', label: t('common.category') },
    { key: 'location', label: t('common.location') },
    { key: 'quantity', label: t('common.quantity'), numeric: true },
    { key: 'unit', label: t('common.unit') },
    { key: 'minimum', label: t('stock.minimum'), numeric: true },
    { key: 'target', label: t('stock.target'), numeric: true },
    { key: 'stock', label: t('stock.label') },
    { key: 'expiry', label: t('expiry.label') },
    { key: 'expiryDate', label: t('inventory.expirationDate') },
  ];

  const rows = items.map((item) => [
    item.name,
    item.categoryName ?? t('common.uncategorized'),
    item.locationName ?? t('common.noLocation'),
    item.quantity,
    item.unit,
    item.minimumQuantity,
    item.idealQuantity,
    t(`stock.${item.stockStatus}`),
    t(`expiry.${item.expiryBucket}`),
    date(item.expirationDate, dateFormat),
  ]);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: 'inventory',
    title: t('reports.inventory'),
    generatedOn: context.today,
    summary: [
      { label: t('dashboard.totalItems'), value: String(items.length) },
      {
        label: t('dashboard.totalQuantity'),
        value: String(Math.round(totalQuantity * 1e6) / 1e6),
      },
    ],
    sections: [{ columns, rows }],
    empty: items.length === 0,
  };
}

/* ---- Expiration ----------------------------------------------------------- */

export function buildExpirationReport(
  items: readonly InventoryItemView[],
  context: Context,
): Report {
  const { t, dateFormat } = context;

  const columns: ReportColumn[] = [
    { key: 'name', label: t('common.name') },
    { key: 'category', label: t('common.category') },
    { key: 'location', label: t('common.location') },
    { key: 'quantity', label: t('common.quantity'), numeric: true },
    { key: 'expiryDate', label: t('inventory.expirationDate') },
    { key: 'days', label: t('expiry.label') },
  ];

  // Only the buckets that need action. Items with no expiry are not a
  // deficiency, and listing them here would bury what actually matters.
  const groups: { bucket: string; title: string }[] = [
    { bucket: 'expired', title: t('expiry.expired') },
    { bucket: 'today', title: t('expiry.today') },
    { bucket: 'soon', title: t('expiry.soon') },
  ];

  const sections: ReportSection[] = [];
  for (const group of groups) {
    const inGroup = items.filter((item) => item.expiryBucket === group.bucket);
    if (inGroup.length === 0) continue;

    sections.push({
      title: `${group.title} (${String(inGroup.length)})`,
      columns,
      rows: inGroup.map((item) => [
        item.name,
        item.categoryName ?? t('common.uncategorized'),
        item.locationName ?? t('common.noLocation'),
        `${item.quantity} ${item.unit}`,
        date(item.expirationDate, dateFormat),
        item.daysUntilExpiry === null
          ? t('expiry.none')
          : item.daysUntilExpiry < 0
            ? t('expiry.expiredDays', { count: Math.abs(item.daysUntilExpiry) })
            : t('expiry.inDays', { count: item.daysUntilExpiry }),
      ]),
    });
  }

  const count = (bucket: string) => items.filter((item) => item.expiryBucket === bucket).length;

  return {
    id: 'expiration',
    title: t('reports.expiration'),
    generatedOn: context.today,
    summary: [
      { label: t('expiry.expired'), value: String(count('expired')) },
      { label: t('expiry.today'), value: String(count('today')) },
      { label: t('expiry.soon'), value: String(count('soon')) },
      { label: t('expiry.none'), value: String(count('none')) },
    ],
    sections,
    empty: sections.length === 0,
  };
}

/* ---- Replenishment -------------------------------------------------------- */

export function buildReplenishmentReport(
  lines: readonly ReplenishmentLine[],
  context: Context,
): Report {
  const { t, dateFormat } = context;

  const columns: ReportColumn[] = [
    { key: 'name', label: t('common.name') },
    { key: 'category', label: t('common.category') },
    { key: 'current', label: t('stock.current'), numeric: true },
    { key: 'minimum', label: t('stock.minimum'), numeric: true },
    { key: 'target', label: t('stock.target'), numeric: true },
    { key: 'needed', label: t('stock.needed'), numeric: true },
    { key: 'unit', label: t('common.unit') },
    { key: 'priority', label: t('common.priority') },
    { key: 'reason', label: t('reports.reason') },
  ];

  return {
    id: 'replenishment',
    title: t('reports.replenishment'),
    generatedOn: context.today,
    summary: [{ label: t('replenishment.title'), value: String(lines.length) }],
    sections: [
      {
        columns,
        rows: lines.map((line) => [
          line.name,
          context.categoryName(line.categoryId),
          line.current,
          line.minimum,
          line.target,
          line.needed,
          line.unit,
          t(`priority.${line.priority}`),
          line.reason === 'expired'
            ? `${t('replenishment.reasonExpired')}${
                line.expirationDate === null ? '' : ` (${date(line.expirationDate, dateFormat)})`
              }`
            : t('replenishment.reasonBelowTarget'),
        ]),
      },
    ],
    empty: lines.length === 0,
  };
}

/* ---- Preparedness --------------------------------------------------------- */

export function buildPreparednessReport(
  report: PreparednessReport,
  context: Context,
): Report {
  const { t } = context;

  const coverage: ReportSection = {
    title: t('reports.coverage'),
    columns: [
      { key: 'category', label: t('common.category') },
      { key: 'score', label: t('preparedness.score'), numeric: true },
      { key: 'items', label: t('dashboard.totalItems'), numeric: true },
      { key: 'below', label: t('preparedness.belowMinimum'), numeric: true },
      { key: 'expired', label: t('preparedness.expiredStock'), numeric: true },
    ],
    rows: report.categories.map((category) => [
      context.categoryName(category.categoryId),
      `${String(Math.round(category.score * 100))}%`,
      category.itemCount,
      category.belowMinimum,
      category.expired,
    ]),
  };

  const deficiencies: ReportSection = {
    title: t('reports.deficiency'),
    columns: [
      { key: 'item', label: t('common.name') },
      { key: 'category', label: t('common.category') },
      { key: 'reason', label: t('reports.reason') },
      { key: 'have', label: t('stock.current'), numeric: true },
      { key: 'minimum', label: t('stock.minimum'), numeric: true },
      { key: 'needed', label: t('stock.needed'), numeric: true },
    ],
    rows: report.deficits.map((deficit) => [
      deficit.name ?? context.categoryName(deficit.categoryId),
      context.categoryName(deficit.categoryId),
      deficit.reason === 'expired'
        ? t('preparedness.expiredStock')
        : deficit.reason === 'category-empty'
          ? t('preparedness.categoryEmpty')
          : t('preparedness.belowMinimum'),
      deficit.quantity,
      deficit.minimum,
      deficit.needed,
    ]),
  };

  return {
    id: 'preparedness',
    title: t('reports.preparedness'),
    generatedOn: context.today,
    summary: [
      { label: t('preparedness.score'), value: `${String(report.score)}%` },
      { label: t('dashboard.totalItems'), value: String(report.totals.itemsCounted) },
      { label: t('preparedness.belowMinimum'), value: String(report.totals.belowMinimum) },
      { label: t('preparedness.expiredStock'), value: String(report.totals.expired) },
    ],
    sections: [coverage, ...(deficiencies.rows.length > 0 ? [deficiencies] : [])],
    empty: report.totals.itemsCounted === 0,
  };
}

/* ---- CSV ------------------------------------------------------------------ */

/**
 * Flattens a report into rows for `toCsv`.
 *
 * A section title becomes its own row so a multi-section report stays readable
 * once it is a flat file. Column headers repeat per section, because the
 * sections do not necessarily share them.
 */
export function reportToCsvRows(report: Report): {
  headers: string[];
  rows: ReportCell[][];
} {
  const rows: ReportCell[][] = [];
  let headers: string[] = [];

  report.sections.forEach((section, index) => {
    if (index === 0) {
      headers = section.columns.map((column) => column.label);
      if (section.title !== undefined) rows.push([section.title]);
    } else {
      rows.push([]);
      if (section.title !== undefined) rows.push([section.title]);
      rows.push(section.columns.map((column) => column.label));
    }
    for (const row of section.rows) rows.push([...row]);
  });

  return { headers, rows };
}

export function reportFilename(report: Report): string {
  return `stock-guardian-${report.id}-${report.generatedOn}.csv`;
}
