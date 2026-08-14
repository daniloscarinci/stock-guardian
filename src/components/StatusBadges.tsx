/**
 * Status chips for stock level and expiry.
 *
 * Shared by the inventory list, the expiration centre and the replenishment
 * list, so a "critical" item looks and reads identically wherever it appears.
 *
 * Each status carries a glyph and a word as well as a colour. The original
 * application signalled status with colour alone plus a translated word, which
 * is closer to acceptable than most - but its low-stock indicator was a bare
 * coloured triangle, invisible to anyone who cannot separate amber from grey.
 */
import { Badge, type Tone } from './ui/primitives';
import type { StockStatus } from '../domain/stock';
import type { ExpiryBucket } from '../domain/expiry';
import type { TranslateFn } from '../i18n/translate';

const STOCK_PRESENTATION: Record<StockStatus, { tone: Tone; glyph: string; key: string }> = {
  critical: { tone: 'critical', glyph: '▼︎▼︎', key: 'stock.critical' },
  low: { tone: 'warning', glyph: '▼︎', key: 'stock.low' },
  adequate: { tone: 'ok', glyph: '●', key: 'stock.adequate' },
  surplus: { tone: 'info', glyph: '▲︎', key: 'stock.surplus' },
};

export function StockBadge({ status, t }: { readonly status: StockStatus; readonly t: TranslateFn }) {
  const presentation = STOCK_PRESENTATION[status];
  return (
    <Badge tone={presentation.tone} glyph={presentation.glyph}>
      {t(presentation.key)}
    </Badge>
  );
}

const EXPIRY_PRESENTATION: Record<ExpiryBucket, { tone: Tone; glyph: string; key: string }> = {
  expired: { tone: 'critical', glyph: '✕︎', key: 'expiry.expired' },
  today: { tone: 'critical', glyph: '!', key: 'expiry.today' },
  soon: { tone: 'warning', glyph: '◷︎', key: 'expiry.soon' },
  valid: { tone: 'ok', glyph: '✓︎', key: 'expiry.valid' },
  none: { tone: 'neutral', glyph: '∞', key: 'expiry.none' },
};

export function ExpiryBadge({
  bucket,
  daysUntil,
  t,
}: {
  readonly bucket: ExpiryBucket;
  readonly daysUntil: number | null;
  readonly t: TranslateFn;
}) {
  const presentation = EXPIRY_PRESENTATION[bucket];

  // The chip states the bucket; the tooltip gives the exact count, so the
  // common case stays scannable and the detail is still available.
  const detail =
    daysUntil === null
      ? undefined
      : bucket === 'expired'
        ? t('expiry.expiredDays', { count: Math.abs(daysUntil) })
        : daysUntil > 0
          ? t('expiry.inDays', { count: daysUntil })
          : undefined;

  return (
    <Badge tone={presentation.tone} glyph={presentation.glyph} title={detail}>
      {bucket === 'soon' && detail !== undefined ? detail : t(presentation.key)}
    </Badge>
  );
}

const PRIORITY_TONE: Record<number, Tone> = {
  1: 'critical',
  2: 'warning',
  3: 'neutral',
  4: 'neutral',
};

export function PriorityBadge({
  priority,
  t,
}: {
  readonly priority: number;
  readonly t: TranslateFn;
}) {
  // Normal priority is the default and needs no chip - marking every ordinary
  // item would make the genuinely urgent ones harder to spot.
  if (priority >= 3) return null;
  return (
    <Badge tone={PRIORITY_TONE[priority] ?? 'neutral'} glyph="!">
      {t(`priority.${priority}`)}
    </Badge>
  );
}
