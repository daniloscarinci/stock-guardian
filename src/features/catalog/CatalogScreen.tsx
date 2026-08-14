/**
 * The reference catalog.
 *
 * 194 preparedness items carried over from the original application, searchable
 * in all three languages at once. The distinction the specification insists on
 * (§11) is enforced structurally: this screen never writes to `items`. Adding
 * something opens a form that creates an inventory item of the user's own, with
 * their quantity, their location and their expiry.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData, useDebounced } from '../../hooks/useAsyncData';
import { Alert, Badge, Button, Card, EmptyState, Loading } from '../../components/ui/primitives';
import { OptionChip } from '../../components/ui/Field';
import { ItemFormDialog } from '../inventory/ItemFormDialog';
import type { CatalogEntry } from '../../repositories/catalog.repository';
import screens from '../screens.module.css';

export function CatalogScreen() {
  const { t, repositories, settings, revision, invalidate } = useApp();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 220);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<CatalogEntry | null>(null);
  const [error] = useState<string | null>(null);

  const categories = useAsyncData(
    () => repositories.categories.list(),
    [repositories.categories, revision],
  );

  const locations = useAsyncData(
    () => repositories.locations.list(),
    [repositories.locations, revision],
  );

  const entries = useAsyncData(
    () =>
      repositories.catalog.search({
        search: debounced,
        categoryIds,
        lang: settings.language,
        limit: 400,
      }),
    [repositories.catalog, debounced, categoryIds, settings.language, revision],
  );

  const total = useAsyncData(() => repositories.catalog.total(), [repositories.catalog]);

  const categoryName = useMemo(() => {
    const byId = new Map(
      (categories.data ?? []).map((category) => [
        category.id,
        category.names[settings.language] ?? category.names.en ?? category.id,
      ]),
    );
    return (id: string) => byId.get(id) ?? id;
  }, [categories.data, settings.language]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>();
    for (const entry of entries.data ?? []) {
      const bucket = map.get(entry.categoryId) ?? [];
      bucket.push(entry);
      map.set(entry.categoryId, bucket);
    }
    return [...map.entries()];
  }, [entries.data]);

  const toggleCategory = (id: string, on: boolean) => {
    setCategoryIds((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));
  };

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('catalog.title')}</h1>
          <p className={screens.pageSubtitle}>
            {t('catalog.subtitle', { count: total.data ?? 0 })}
          </p>
        </div>
      </header>

      <Alert tone="info">{t('catalog.explanation')}</Alert>

      <div className={screens.toolbar}>
        <label className="sr-only" htmlFor="catalog-search">
          {t('common.search')}
        </label>
        <input
          id="catalog-search"
          className={screens.searchBox}
          type="search"
          placeholder={t('catalog.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>

      <div className={screens.toolbar}>
        {(categories.data ?? []).map((category) => (
          <OptionChip
            key={category.id}
            checked={categoryIds.includes(category.id)}
            onChange={(on) => {
              toggleCategory(category.id, on);
            }}
          >
            {categoryName(category.id)}
          </OptionChip>
        ))}
      </div>

      {error !== null && (
        <Alert tone="critical" role="alert">
          {error}
        </Alert>
      )}

      {entries.loading && entries.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : grouped.length === 0 ? (
        <EmptyState title={t('catalog.noResults', { query: debounced })} />
      ) : (
        grouped.map(([categoryId, items]) => (
          <Card
            key={categoryId}
            title={categoryName(categoryId)}
            hint={t('common.itemCount', { count: items.length })}
          >
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
                gap: 'var(--space-2)',
              }}
            >
              {items.map((entry) => (
                <li key={entry.id} className={screens.itemCardBottom}>
                  <span className={screens.nameCell}>
                    <span>{entry.displayName}</span>
                    {entry.inInventory > 0 && (
                      <Badge tone="ok" glyph="✓">
                        {t('catalog.alreadyInInventory', { count: entry.inInventory })}
                      </Badge>
                    )}
                  </span>
                  <Button
                    size="small"
                    aria-label={t('catalog.addDialogTitle', { name: entry.displayName })}
                    onClick={() => {
                      setAdding(entry);
                    }}
                  >
                    + {t('common.add')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      {/*
        The same form used everywhere else, pre-filled from the catalog entry.
        The catalog supplies a starting point; what gets stored is the user's.
      */}
      <ItemFormDialog
        open={adding !== null}
        item={null}
        catalogItemId={adding?.id ?? null}
        initial={
          adding === null
            ? undefined
            : {
                name: adding.displayName,
                categoryId: adding.categoryId,
                unit: adding.defaultUnit ?? '',
              }
        }
        categories={categories.data ?? []}
        locations={locations.data ?? []}
        onClose={() => {
          setAdding(null);
        }}
        onSaved={invalidate}
      />
    </div>
  );
}
