/**
 * The filter panel.
 *
 * Filters combine: "Medical + low stock + expiring within 30 days" is a single
 * query, which is what §15 asks for. Every filter is a real checkbox in a
 * labelled group, so the whole panel works from the keyboard.
 */
import { OptionChip } from '../../components/ui/Field';
import { Button } from '../../components/ui/primitives';
import { useApp } from '../../app/AppContext';
import type { Category, Location, Priority } from '../../types/domain';
import type { StockStatus } from '../../domain/stock';
import type { ExpiryBucket } from '../../domain/expiry';
import type { ArchivedFilter, ItemFilters } from '../../repositories/items.repository';
import screens from '../screens.module.css';

const STOCK_STATUSES: readonly StockStatus[] = ['critical', 'low', 'adequate', 'surplus'];
const EXPIRY_BUCKETS: readonly ExpiryBucket[] = ['expired', 'today', 'soon', 'valid', 'none'];
const PRIORITY_VALUES: readonly Priority[] = [1, 2, 3, 4];

function toggle<T>(list: readonly T[] | undefined, value: T, on: boolean): T[] {
  const current = list ?? [];
  return on ? [...current, value] : current.filter((entry) => entry !== value);
}

export function InventoryFilters({
  filters,
  onChange,
  categories,
  locations,
}: {
  readonly filters: ItemFilters;
  readonly onChange: (filters: ItemFilters) => void;
  readonly categories: readonly Category[];
  readonly locations: readonly Location[];
}) {
  const { t, settings } = useApp();

  const categoryName = (category: Category) =>
    category.names[settings.language] ?? category.names.en ?? category.id;

  return (
    <div className={screens.filterPanel}>
      <fieldset className={screens.filterGroup}>
        <legend className={screens.filterLabel}>{t('common.category')}</legend>
        <div className={screens.toolbar}>
          {categories.map((category) => (
            <OptionChip
              key={category.id}
              checked={filters.categoryIds?.includes(category.id) ?? false}
              onChange={(on) => {
                onChange({ ...filters, categoryIds: toggle(filters.categoryIds, category.id, on) });
              }}
            >
              {categoryName(category)}
            </OptionChip>
          ))}
        </div>
      </fieldset>

      {locations.length > 0 && (
        <fieldset className={screens.filterGroup}>
          <legend className={screens.filterLabel}>{t('common.location')}</legend>
          <div className={screens.toolbar}>
            {locations.map((location) => (
              <OptionChip
                key={location.id}
                checked={filters.locationIds?.includes(location.id) ?? false}
                onChange={(on) => {
                  onChange({
                    ...filters,
                    locationIds: toggle(filters.locationIds, location.id, on),
                    // Selecting a place means the things inside it too.
                    includeSublocations: true,
                  });
                }}
              >
                {location.name}
              </OptionChip>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className={screens.filterGroup}>
        <legend className={screens.filterLabel}>{t('stock.label')}</legend>
        <div className={screens.toolbar}>
          {STOCK_STATUSES.map((status) => (
            <OptionChip
              key={status}
              checked={filters.stockStatuses?.includes(status) ?? false}
              onChange={(on) => {
                onChange({ ...filters, stockStatuses: toggle(filters.stockStatuses, status, on) });
              }}
            >
              {t(`stock.${status}`)}
            </OptionChip>
          ))}
        </div>
      </fieldset>

      <fieldset className={screens.filterGroup}>
        <legend className={screens.filterLabel}>{t('expiry.label')}</legend>
        <div className={screens.toolbar}>
          {EXPIRY_BUCKETS.map((bucket) => (
            <OptionChip
              key={bucket}
              checked={filters.expiryBuckets?.includes(bucket) ?? false}
              onChange={(on) => {
                onChange({ ...filters, expiryBuckets: toggle(filters.expiryBuckets, bucket, on) });
              }}
            >
              {t(`expiry.${bucket}`)}
            </OptionChip>
          ))}
        </div>
      </fieldset>

      <fieldset className={screens.filterGroup}>
        <legend className={screens.filterLabel}>{t('common.priority')}</legend>
        <div className={screens.toolbar}>
          {PRIORITY_VALUES.map((priority) => (
            <OptionChip
              key={priority}
              checked={filters.priorities?.includes(priority) ?? false}
              onChange={(on) => {
                onChange({ ...filters, priorities: toggle(filters.priorities, priority, on) });
              }}
            >
              {t(`priority.${priority}`)}
            </OptionChip>
          ))}
        </div>
      </fieldset>

      <fieldset className={screens.filterGroup}>
        <legend className={screens.filterLabel}>{t('common.status')}</legend>
        <div className={screens.toolbar}>
          {(['active', 'archived', 'all'] as const).map((mode) => (
            <OptionChip
              key={mode}
              type="radio"
              name="archived-filter"
              checked={(filters.archived ?? 'active') === mode}
              onChange={() => {
                onChange({ ...filters, archived: mode as ArchivedFilter });
              }}
            >
              {mode === 'active'
                ? t('inventory.activeOnly')
                : mode === 'archived'
                  ? t('inventory.onlyArchived')
                  : t('common.all')}
            </OptionChip>
          ))}
        </div>
      </fieldset>

      <div>
        <Button
          size="small"
          onClick={() => {
            onChange({ search: filters.search });
          }}
        >
          {t('common.clearAll')}
        </Button>
      </div>
    </div>
  );
}

/** How many filters are narrowing the list, for the toolbar badge. */
export function countActiveFilters(filters: ItemFilters): number {
  return (
    (filters.categoryIds?.length ?? 0) +
    (filters.locationIds?.length ?? 0) +
    (filters.stockStatuses?.length ?? 0) +
    (filters.expiryBuckets?.length ?? 0) +
    (filters.priorities?.length ?? 0) +
    (filters.conditions?.length ?? 0) +
    (filters.archived !== undefined && filters.archived !== 'active' ? 1 : 0)
  );
}
