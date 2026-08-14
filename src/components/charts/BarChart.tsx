/**
 * Horizontal bar charts for the dashboard.
 *
 * Deliberately hand-built: a charting library would be a dependency, a bundle
 * cost, and a thing to keep working offline, in exchange for rectangles.
 *
 * Two forms, chosen by the job the data does:
 *
 *   BarChart      one measure across many categories - a SINGLE series, so a
 *                 single hue. Colouring each category differently would encode
 *                 identity that the label already carries, and would repaint
 *                 the survivors whenever a filter changed the row count.
 *   StatusChart   counts by state - the status palette, one row per state, each
 *                 with its own label and swatch.
 *
 * Both always print the value beside the bar, so nothing is conveyed by colour
 * alone and the chart doubles as the table view.
 */
import type { ReactNode } from 'react';
import { cx } from '../ui/cx';
import styles from './BarChart.module.css';

export interface BarDatum {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** Overrides the single-hue default. Used only by the status form. */
  readonly color?: string;
}

function Row({
  datum,
  max,
  color,
  showSwatch,
  formatValue,
}: {
  readonly datum: BarDatum;
  readonly max: number;
  readonly color: string;
  readonly showSwatch: boolean;
  readonly formatValue: (value: number) => string;
}) {
  const percent = max <= 0 ? 0 : Math.max(0, Math.min(100, (datum.value / max) * 100));

  return (
    <div className={styles.row}>
      {showSwatch ? (
        <span className={styles.labelWithSwatch}>
          <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
          <span className={cx(styles.label, styles.labelText)} title={datum.label}>
            {datum.label}
          </span>
        </span>
      ) : (
        <span className={styles.label} title={datum.label}>
          {datum.label}
        </span>
      )}

      <div className={styles.track}>
        {datum.value > 0 && (
          <div className={styles.bar} style={{ width: `${String(percent)}%`, background: color }} />
        )}
      </div>

      <span className={styles.value}>{formatValue(datum.value)}</span>
    </div>
  );
}

export function BarChart({
  data,
  emptyLabel,
  color = 'var(--chart-accent)',
  formatValue = (value) => String(value),
  caption,
}: {
  readonly data: readonly BarDatum[];
  readonly emptyLabel: string;
  readonly color?: string;
  readonly formatValue?: (value: number) => string;
  readonly caption?: ReactNode;
}) {
  if (data.length === 0) return <p className={styles.empty}>{emptyLabel}</p>;

  const max = Math.max(...data.map((datum) => datum.value), 0);

  return (
    <div className={styles.chart}>
      {caption}
      {data.map((datum) => (
        <Row
          key={datum.id}
          datum={datum}
          max={max}
          color={color}
          showSwatch={false}
          formatValue={formatValue}
        />
      ))}
    </div>
  );
}

export function StatusChart({
  data,
  emptyLabel,
  formatValue = (value) => String(value),
}: {
  readonly data: readonly BarDatum[];
  readonly emptyLabel: string;
  readonly formatValue?: (value: number) => string;
}) {
  const visible = data.filter((datum) => datum.value > 0);
  if (visible.length === 0) return <p className={styles.empty}>{emptyLabel}</p>;

  // Scaled against the total, not the largest row, so the bars read as shares
  // of the inventory rather than as a ranking.
  const total = data.reduce((sum, datum) => sum + datum.value, 0);

  return (
    <div className={styles.chart}>
      {data.map((datum) => (
        <Row
          key={datum.id}
          datum={datum}
          max={total}
          color={datum.color ?? 'var(--chart-none)'}
          showSwatch
          formatValue={formatValue}
        />
      ))}
    </div>
  );
}

/** The preparedness headline: one number, with the bar that produced it. */
export function ScoreMeter({
  score,
  caption,
  label,
}: {
  readonly score: number;
  readonly caption: string;
  readonly label: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  // The colour restates the number rather than replacing it; the figure itself
  // is always the primary reading.
  const color =
    clamped >= 80
      ? 'var(--chart-ok)'
      : clamped >= 50
        ? 'var(--chart-warning)'
        : 'var(--chart-critical)';

  return (
    <div>
      <div className={styles.score}>
        <span className={styles.scoreValue}>{clamped}%</span>
        <span className={styles.scoreCaption}>{caption}</span>
      </div>
      <div
        className={styles.scoreTrack}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={styles.scoreFill} style={{ width: `${String(clamped)}%`, background: color }} />
      </div>
    </div>
  );
}

/** The chart fill for each status, so every chart names them the same way. */
export const STATUS_FILL = {
  critical: 'var(--chart-critical)',
  warning: 'var(--chart-warning)',
  ok: 'var(--chart-ok)',
  info: 'var(--chart-info)',
  none: 'var(--chart-none)',
} as const;
