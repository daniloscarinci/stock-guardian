/**
 * The inventory screen.
 *
 * Everything the original application did - add, edit, delete, search, sort by
 * expiry, low-stock threshold - plus the things it could not: filters that
 * combine, archive and restore, moving between locations, and quantity changes
 * that do not require opening a form.
 *
 * On a phone the table becomes a list of cards, so nothing scrolls sideways.
 */
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useAsyncData, useDebounced } from '../../hooks/useAsyncData';
import { Button, EmptyState, Loading, Alert } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { ExpiryBadge, PriorityBadge, StockBadge } from '../../components/StatusBadges';
import { ItemFormDialog } from './ItemFormDialog';
import { InventoryFilters, countActiveFilters } from './InventoryFilters';
import { MoveItemDialog } from './MoveItemDialog';
import {
  ArchiveIcon,
  DeleteIcon,
  DuplicateIcon,
  EditIcon,
  MinusIcon,
  PlusIcon,
  RestoreIcon,
  MoveIcon,
} from '../../components/ui/icons';
import { formatCalendarDate } from '../../domain/dates';
import type { InventoryItem, InventoryItemView } from '../../types/domain';
import type { ItemFilters, ItemSort, ItemSortField } from '../../repositories/items.repository';
import screens from '../screens.module.css';

const PAGE_SIZE = 50;

const SORT_LABEL: Record<ItemSortField, string> = {
  name: 'inventory.sortName',
  quantity: 'inventory.sortQuantity',
  expiration: 'inventory.sortExpiration',
  updated: 'inventory.sortUpdated',
  created: 'inventory.sortCreated',
  priority: 'inventory.sortPriority',
  category: 'inventory.sortCategory',
  location: 'inventory.sortLocation',
};

export function InventoryScreen() {
  const { t, repositories, itemContext, settings, revision, invalidate } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 220);
  const [filters, setFilters] = useState<ItemFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<ItemSort>({ field: 'name', direction: 'asc' });
  const [pages, setPages] = useState(1);

  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [formOpen, setFormOpen] = useState(searchParams.get('new') === '1');
  const [deleting, setDeleting] = useState<InventoryItemView | null>(null);
  const [moving, setMoving] = useState<InventoryItemView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const effectiveFilters = useMemo<ItemFilters>(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const categories = useAsyncData(() => repositories.categories.list(), [repositories.categories, revision]);
  const locations = useAsyncData(() => repositories.locations.list(), [repositories.locations, revision]);

  // Pages accumulate rather than replace, so "load more" appends. Asking for
  // `pages * PAGE_SIZE` in one query keeps the cursor logic out of component
  // state, where a stale cursor would silently skip rows.
  const list = useAsyncData(
    () =>
      repositories.items.list(itemContext, {
        filters: effectiveFilters,
        sort,
        limit: pages * PAGE_SIZE,
        lang: settings.language,
      }),
    [repositories.items, itemContext, effectiveFilters, sort, pages, settings.language, revision],
  );

  const refresh = useCallback(() => {
    invalidate();
  }, [invalidate]);

  const adjust = useCallback(
    async (item: InventoryItemView, delta: number) => {
      setActionError(null);
      try {
        await repositories.items.adjustQuantity(item.id, delta);
        refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [repositories.items, refresh],
  );

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await action();
        refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [refresh],
  );

  const toggleSort = (field: ItemSortField) => {
    setPages(1);
    setSort((current) =>
      current.field === field
        ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' },
    );
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    if (searchParams.get('new') === '1') {
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const hasMore = list.data?.nextCursor !== null && list.data !== undefined;
  const activeFilterCount = countActiveFilters(filters);

  const formatQuantity = (item: InventoryItemView) =>
    `${new Intl.NumberFormat(settings.language, { maximumFractionDigits: 3 }).format(item.quantity)} ${item.unit}`;

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('inventory.title')}</h1>
          <p className={screens.pageSubtitle}>{t('common.itemCount', { count: total })}</p>
        </div>
        <div className={screens.pageActions}>
          <Button variant="primary" onClick={openNew}>
            + {t('inventory.addItem')}
          </Button>
        </div>
      </header>

      <div className={screens.toolbar}>
        <label className="sr-only" htmlFor="inventory-search">
          {t('common.search')}
        </label>
        <input
          id="inventory-search"
          className={screens.searchBox}
          type="search"
          placeholder={t('common.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPages(1);
          }}
        />
        <Button
          onClick={() => {
            setShowFilters((open) => !open);
          }}
          aria-expanded={showFilters}
        >
          {t('common.filters')}
          {activeFilterCount > 0 ? ` (${String(activeFilterCount)})` : ''}
        </Button>
      </div>

      {showFilters && (
        <InventoryFilters
          filters={filters}
          onChange={(next) => {
            setFilters(next);
            setPages(1);
          }}
          categories={categories.data ?? []}
          locations={locations.data ?? []}
        />
      )}

      {actionError !== null && (
        <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
          {actionError}
        </Alert>
      )}

      {list.loading && rows.length === 0 ? (
        <Loading label={t('common.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            debouncedSearch === '' ? t('inventory.emptyTitle') : t('inventory.noSearchResults', { query: debouncedSearch })
          }
          body={debouncedSearch === '' ? t('inventory.emptyBody') : undefined}
          actions={
            <Button variant="primary" onClick={openNew}>
              + {t('inventory.addItem')}
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop: a table. */}
          <div className={screens.tableWrap}>
            <table className={screens.table}>
              <thead>
                <tr>
                  {(['name', 'category', 'location'] as const).map((field) => (
                    <th key={field} scope="col" aria-sort={ariaSort(sort, field)}>
                      <button
                        type="button"
                        className={screens.sortButton}
                        onClick={() => {
                          toggleSort(field);
                        }}
                      >
                        {t(SORT_LABEL[field])}
                        <SortGlyph sort={sort} field={field} />
                      </button>
                    </th>
                  ))}
                  <th scope="col" className={screens.numeric} aria-sort={ariaSort(sort, 'quantity')}>
                    <button
                      type="button"
                      className={screens.sortButton}
                      onClick={() => {
                        toggleSort('quantity');
                      }}
                    >
                      {t('common.quantity')}
                      <SortGlyph sort={sort} field="quantity" />
                    </button>
                  </th>
                  <th scope="col">{t('stock.label')}</th>
                  <th scope="col" aria-sort={ariaSort(sort, 'expiration')}>
                    <button
                      type="button"
                      className={screens.sortButton}
                      onClick={() => {
                        toggleSort('expiration');
                      }}
                    >
                      {t('expiry.label')}
                      <SortGlyph sort={sort} field="expiration" />
                    </button>
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className={screens.nameCell}>
                        <span className={screens.itemName}>{item.name}</span>
                        <span className={screens.badgeRow}>
                          <PriorityBadge priority={item.priority} t={t} />
                          {item.archivedAt !== null && (
                            <span className={screens.itemMeta}>{t('inventory.archivedNotice')}</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td>
                      {item.categoryName ?? (
                        <span className={screens.emptyValue} title={t('common.uncategorized')}>
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      {item.locationName ?? (
                        <span className={screens.emptyValue} title={t('common.noLocation')}>
                          —
                        </span>
                      )}
                    </td>
                    <td className={screens.numeric}>
                      <div className={screens.stepperCell}>
                        <Button
                          size="small"
                          iconOnly
                          aria-label={t('a11y.decreaseFor', { name: item.name })}
                          disabled={item.quantity <= 0}
                          onClick={() => void adjust(item, -1)}
                        >
                          <MinusIcon />
                        </Button>
                        <span className={screens.quantityValue}>{formatQuantity(item)}</span>
                        <Button
                          size="small"
                          iconOnly
                          aria-label={t('a11y.increaseFor', { name: item.name })}
                          onClick={() => void adjust(item, 1)}
                        >
                          <PlusIcon />
                        </Button>
                      </div>
                    </td>
                    <td>
                      <StockBadge status={item.stockStatus} t={t} />
                    </td>
                    <td>
                      <div className={screens.nameCell}>
                        <ExpiryBadge bucket={item.expiryBucket} daysUntil={item.daysUntilExpiry} t={t} />
                        {item.expirationDate !== null && (
                          <span className={screens.itemMeta}>
                            {formatCalendarDate(item.expirationDate, settings.dateFormat)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <RowActions
                        item={item}
                        onEdit={() => {
                          setEditing(item);
                          setFormOpen(true);
                        }}
                        onMove={() => {
                          setMoving(item);
                        }}
                        onDuplicate={() => void runAction(() => repositories.items.duplicate(item.id))}
                        onArchive={() =>
                          void runAction(() =>
                            item.archivedAt === null
                              ? repositories.items.archive(item.id)
                              : repositories.items.restore(item.id),
                          )
                        }
                        onDelete={() => {
                          setDeleting(item);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: cards, with the +/- controls large enough to hit. */}
          <div className={screens.cardList}>
            {rows.map((item) => (
              <article key={item.id} className={screens.itemCard}>
                <div className={screens.itemCardTop}>
                  <div className={screens.nameCell}>
                    <span className={screens.itemName}>{item.name}</span>
                    <span className={screens.itemMeta}>
                      {item.categoryName ?? t('common.uncategorized')}
                      {' · '}
                      {item.locationName ?? t('common.noLocation')}
                    </span>
                  </div>
                  <RowActions
                    item={item}
                    onEdit={() => {
                      setEditing(item);
                      setFormOpen(true);
                    }}
                    onMove={() => {
                      setMoving(item);
                    }}
                    onDuplicate={() => void runAction(() => repositories.items.duplicate(item.id))}
                    onArchive={() =>
                      void runAction(() =>
                        item.archivedAt === null
                          ? repositories.items.archive(item.id)
                          : repositories.items.restore(item.id),
                      )
                    }
                    onDelete={() => {
                      setDeleting(item);
                    }}
                  />
                </div>

                <div className={screens.badgeRow}>
                  <StockBadge status={item.stockStatus} t={t} />
                  <ExpiryBadge bucket={item.expiryBucket} daysUntil={item.daysUntilExpiry} t={t} />
                  <PriorityBadge priority={item.priority} t={t} />
                </div>

                <div className={screens.itemCardBottom}>
                  <span className={screens.itemMeta}>
                    {item.expirationDate === null
                      ? t('expiry.none')
                      : formatCalendarDate(item.expirationDate, settings.dateFormat)}
                  </span>
                  <div className={screens.stepperCell}>
                    <Button
                      iconOnly
                      aria-label={t('a11y.decreaseFor', { name: item.name })}
                      disabled={item.quantity <= 0}
                      onClick={() => void adjust(item, -1)}
                    >
                      <MinusIcon />
                    </Button>
                    <span className={screens.quantityValue}>{formatQuantity(item)}</span>
                    <Button
                      iconOnly
                      aria-label={t('a11y.increaseFor', { name: item.name })}
                      onClick={() => void adjust(item, 1)}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className={screens.listFooter}>
            <span>
              {t('common.itemCount', { count: rows.length })} {t('common.of')} {total}
            </span>
            {hasMore && (
              <Button
                onClick={() => {
                  setPages((value) => value + 1);
                }}
                disabled={list.loading}
              >
                {list.loading ? t('common.loading') : t('common.loadMore')}
              </Button>
            )}
          </div>
        </>
      )}

      <ItemFormDialog
        open={formOpen}
        item={editing}
        categories={categories.data ?? []}
        locations={locations.data ?? []}
        onClose={closeForm}
        onSaved={refresh}
      />

      <MoveItemDialog
        item={moving}
        locations={locations.data ?? []}
        onClose={() => {
          setMoving(null);
        }}
        onMoved={refresh}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('inventory.deleteConfirmTitle')}
        body={t('inventory.deleteConfirmBody', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        alternative={
          <Button
            onClick={() => {
              const item = deleting;
              setDeleting(null);
              if (item !== null) void runAction(() => repositories.items.archive(item.id));
            }}
          >
            {t('inventory.archiveInstead')}
          </Button>
        }
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          const item = deleting;
          setDeleting(null);
          if (item !== null) void runAction(() => repositories.items.remove(item.id));
        }}
      />
    </div>
  );
}

function ariaSort(sort: ItemSort, field: ItemSortField): 'ascending' | 'descending' | 'none' {
  if (sort.field !== field) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function SortGlyph({ sort, field }: { readonly sort: ItemSort; readonly field: ItemSortField }) {
  if (sort.field !== field) return null;
  return <span aria-hidden="true">{sort.direction === 'asc' ? '↑' : '↓'}</span>;
}

function RowActions({
  item,
  onEdit,
  onMove,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  readonly item: InventoryItemView;
  readonly onEdit: () => void;
  readonly onMove: () => void;
  readonly onDuplicate: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}) {
  const { t } = useApp();
  return (
    <div className={screens.rowActions} role="group" aria-label={t('a11y.itemActions', { name: item.name })}>
      <Button size="small" iconOnly aria-label={t('common.edit')} title={t('common.edit')} onClick={onEdit}>
        <EditIcon />
      </Button>
      <Button size="small" iconOnly aria-label={t('common.transfer')} title={t('common.transfer')} onClick={onMove}>
        <MoveIcon />
      </Button>
      <Button
        size="small"
        iconOnly
        aria-label={t('common.duplicate')}
        title={t('common.duplicate')}
        onClick={onDuplicate}
      >
        <DuplicateIcon />
      </Button>
      <Button
        size="small"
        iconOnly
        aria-label={item.archivedAt === null ? t('common.archive') : t('common.restore')}
        title={item.archivedAt === null ? t('common.archive') : t('common.restore')}
        onClick={onArchive}
      >
        {item.archivedAt === null ? <ArchiveIcon /> : <RestoreIcon />}
      </Button>
      <Button
        size="small"
        iconOnly
        variant="danger"
        aria-label={t('common.delete')}
        title={t('common.delete')}
        onClick={onDelete}
      >
        <DeleteIcon />
      </Button>
    </div>
  );
}
