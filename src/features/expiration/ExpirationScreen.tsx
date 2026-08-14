/**
 * The expiration centre.
 *
 * One question: what is running out, and when. Items are grouped by urgency and
 * ordered soonest-first within each group, so the top of the page is always the
 * thing to deal with first.
 *
 * The warning windows are the user's, set in Settings. The original had a single
 * hard-coded thirty days.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Button, Card, EmptyState, Loading } from '../../components/ui/primitives';
import { ExpiryBadge, StockBadge } from '../../components/StatusBadges';
import { formatCalendarDate } from '../../domain/dates';
import type { ExpiryBucket } from '../../domain/expiry';
import type { InventoryItemView } from '../../types/domain';
import { OptionChip } from '../../components/ui/Field';
import screens from '../screens.module.css';

const GROUPS: readonly { bucket: ExpiryBucket; titleKey: string }[] = [
  { bucket: 'expired', titleKey: 'expiry.expired' },
  { bucket: 'today', titleKey: 'expiry.today' },
  { bucket: 'soon', titleKey: 'expiry.soon' },
];

export function ExpirationScreen() {
  const { t, repositories, itemContext, settings, revision, invalidate } = useApp();
  const [includeValid, setIncludeValid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buckets = useMemo<ExpiryBucket[]>(
    () => (includeValid ? ['expired', 'today', 'soon', 'valid'] : ['expired', 'today', 'soon']),
    [includeValid],
  );

  const list = useAsyncData(
    () =>
      repositories.items.list(itemContext, {
        filters: { expiryBuckets: buckets },
        sort: { field: 'expiration', direction: 'asc' },
        limit: 500,
        lang: settings.language,
      }),
    [repositories.items, itemContext, buckets, settings.language, revision],
  );

  const grouped = useMemo(() => {
    const map = new Map<ExpiryBucket, InventoryItemView[]>();
    for (const item of list.data?.rows ?? []) {
      const bucket = map.get(item.expiryBucket) ?? [];
      bucket.push(item);
      map.set(item.expiryBucket, bucket);
    }
    return map;
  }, [list.data]);

  const consume = async (item: InventoryItemView) => {
    setError(null);
    try {
      await repositories.items.adjustQuantity(item.id, -1, { type: 'consume' });
      invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const archive = async (item: InventoryItemView) => {
    setError(null);
    try {
      await repositories.items.archive(item.id);
      invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const visibleGroups = includeValid ? [...GROUPS, { bucket: 'valid' as const, titleKey: 'expiry.valid' }] : GROUPS;
  const totalShown = list.data?.rows.length ?? 0;

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('expiry.center')}</h1>
          <p className={screens.pageSubtitle}>{t('expiry.centerSubtitle')}</p>
        </div>
      </header>

      <div className={screens.toolbar}>
        <OptionChip checked={includeValid} onChange={setIncludeValid}>
          {t('expiry.valid')}
        </OptionChip>
        <span className={screens.activeFilters}>
          {t('expiry.windows')}: {settings.expiryWarningDays.join(' · ')}
        </span>
      </div>

      {error !== null && (
        <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
          {error}
        </Alert>
      )}

      {list.loading && list.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : totalShown === 0 ? (
        <EmptyState title={t('expiry.allClear')} />
      ) : (
        visibleGroups.map(({ bucket, titleKey }) => {
          const items = grouped.get(bucket) ?? [];
          if (items.length === 0) return null;

          return (
            <Card
              key={bucket}
              title={t(titleKey)}
              hint={t('common.itemCount', { count: items.length })}
            >
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
                {items.map((item) => (
                  <li key={item.id} className={screens.itemCardBottom}>
                    <div className={screens.nameCell}>
                      <span className={screens.itemName}>{item.name}</span>
                      <span className={screens.itemMeta}>
                        {item.categoryName ?? t('common.uncategorized')}
                        {' · '}
                        {item.locationName ?? t('common.noLocation')}
                        {' · '}
                        {item.quantity} {item.unit}
                      </span>
                      <span className={screens.badgeRow}>
                        <ExpiryBadge
                          bucket={item.expiryBucket}
                          daysUntil={item.daysUntilExpiry}
                          t={t}
                        />
                        <StockBadge status={item.stockStatus} t={t} />
                        <span className={screens.itemMeta}>
                          {formatCalendarDate(item.expirationDate, settings.dateFormat)}
                        </span>
                      </span>
                    </div>

                    <div className={screens.rowActions}>
                      <Button
                        size="small"
                        onClick={() => void consume(item)}
                        disabled={item.quantity <= 0}
                      >
                        −1
                      </Button>
                      <Button size="small" onClick={() => void archive(item)}>
                        {t('common.archive')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}
