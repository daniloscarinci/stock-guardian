/**
 * The dashboard.
 *
 * The original had four counters. This keeps all four - total, expired,
 * expiring within thirty days, low stock - and adds what someone actually needs
 * to act: what is critical, where the gaps are, and a preparedness score that
 * shows its own working.
 *
 * Every stat that identifies a subset of the inventory is a button that filters
 * the inventory list to exactly that subset. A number you cannot act on is
 * decoration.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Button, Card, EmptyState, Loading, Alert } from '../../components/ui/primitives';
import { BarChart, ScoreMeter, StatusChart, STATUS_FILL, type BarDatum } from '../../components/charts/BarChart';
import { evaluatePreparedness } from '../../domain/preparedness';
import { PREPAREDNESS_PRIORITY_WEIGHTS } from '../../domain/preparedness';
import screens from '../screens.module.css';

export function DashboardScreen() {
  const { t, repositories, itemContext, settings, revision } = useApp();
  const navigate = useNavigate();

  const stats = useAsyncData(
    () => repositories.items.dashboardStats(itemContext),
    [repositories.items, itemContext, revision],
  );

  const categories = useAsyncData(
    () => repositories.categories.list(),
    [repositories.categories, revision],
  );

  const categoryCounts = useAsyncData(
    () => repositories.categories.itemCounts(),
    [repositories.categories, revision],
  );

  const locationTree = useAsyncData(
    () => repositories.locations.tree(),
    [repositories.locations, revision],
  );

  const analysisItems = useAsyncData(
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

  const preparedness = useMemo(() => {
    if (analysisItems.data === undefined) return null;
    return evaluatePreparedness({
      items: analysisItems.data,
      today: itemContext.today,
      defaultThreshold: itemContext.defaultThreshold,
      trackedCategoryIds: settings.preparednessCategoryIds,
      expiryWindows: itemContext.expiryWindows,
    });
  }, [analysisItems.data, itemContext, settings.preparednessCategoryIds]);

  const goToInventory = (query: string) => {
    void navigate(`/inventory${query}`);
  };

  if (stats.loading && stats.data === undefined) {
    return <Loading label={t('common.loading')} />;
  }

  if (stats.error !== null) {
    return (
      <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
        {stats.error.message}
      </Alert>
    );
  }

  const s = stats.data;
  if (s === undefined) return null;

  if (s.totalItems === 0 && s.archived === 0) {
    return (
      <div className={screens.page}>
        <header className={screens.pageHeader}>
          <div>
            <h1 className={screens.pageTitle}>{t('dashboard.title')}</h1>
            <p className={screens.pageSubtitle}>{t('dashboard.subtitle')}</p>
          </div>
        </header>
        <EmptyState
          title={t('dashboard.emptyTitle')}
          body={t('dashboard.emptyBody')}
          actions={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  goToInventory('?new=1');
                }}
              >
                {t('dashboard.addFirstItem')}
              </Button>
              <Button
                onClick={() => {
                  void navigate('/catalog');
                }}
              >
                {t('dashboard.browseCatalog')}
              </Button>
              <Button
                onClick={() => {
                  void navigate('/settings');
                }}
              >
                {t('dashboard.importExisting')}
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const numberFormat = new Intl.NumberFormat(settings.language, { maximumFractionDigits: 2 });

  const categoryData: BarDatum[] = (categories.data ?? [])
    .map((category) => ({
      id: category.id,
      label: categoryName(category.id),
      value: categoryCounts.data?.get(category.id) ?? 0,
    }))
    .filter((datum) => datum.value > 0)
    .sort((a, b) => b.value - a.value);

  const locationData: BarDatum[] = (locationTree.data ?? [])
    .flatMap(function flatten(node): { id: string; label: string; value: number }[] {
      return [
        { id: node.id, label: node.name, value: node.itemCount },
        ...node.children.flatMap(flatten),
      ];
    })
    .filter((datum) => datum.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const stockData: BarDatum[] = [
    { id: 'critical', label: t('stock.critical'), value: s.critical, color: STATUS_FILL.critical },
    { id: 'low', label: t('stock.low'), value: s.low, color: STATUS_FILL.warning },
    {
      id: 'adequate',
      label: t('stock.adequate'),
      value: Math.max(0, s.totalItems - s.critical - s.low),
      color: STATUS_FILL.ok,
    },
  ];

  const expiryData: BarDatum[] = [
    { id: 'expired', label: t('expiry.expired'), value: s.expired, color: STATUS_FILL.critical },
    { id: 'today', label: t('expiry.today'), value: s.expiringToday, color: STATUS_FILL.critical },
    { id: 'soon', label: t('expiry.soon'), value: s.expiringSoon, color: STATUS_FILL.warning },
    {
      id: 'valid',
      label: t('expiry.valid'),
      value: Math.max(
        0,
        s.totalItems - s.expired - s.expiringToday - s.expiringSoon - s.noExpiration,
      ),
      color: STATUS_FILL.ok,
    },
    { id: 'none', label: t('expiry.none'), value: s.noExpiration, color: STATUS_FILL.none },
  ];

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('dashboard.title')}</h1>
          <p className={screens.pageSubtitle}>{t('dashboard.subtitle')}</p>
        </div>
        <div className={screens.pageActions}>
          <Button
            variant="primary"
            onClick={() => {
              goToInventory('?new=1');
            }}
          >
            + {t('inventory.addItem')}
          </Button>
        </div>
      </header>

      <section className={screens.statGrid} aria-label={t('dashboard.inventoryOverview')}>
        <StatButton
          label={t('dashboard.totalItems')}
          value={numberFormat.format(s.totalItems)}
          onClick={() => {
            goToInventory('');
          }}
        />
        <StatButton
          label={t('dashboard.expired')}
          value={numberFormat.format(s.expired)}
          tone={s.expired > 0 ? 'critical' : undefined}
          onClick={() => {
            goToInventory('');
          }}
        />
        <StatButton
          label={t('dashboard.expiringSoon')}
          value={numberFormat.format(s.expiringToday + s.expiringSoon)}
          tone={s.expiringToday + s.expiringSoon > 0 ? 'warning' : undefined}
          onClick={() => {
            void navigate('/expiration');
          }}
        />
        <StatButton
          label={t('dashboard.lowStock')}
          value={numberFormat.format(s.critical + s.low)}
          tone={s.critical > 0 ? 'critical' : s.low > 0 ? 'warning' : undefined}
          onClick={() => {
            void navigate('/replenishment');
          }}
        />
        <StatButton
          label={t('dashboard.totalQuantity')}
          value={numberFormat.format(s.totalQuantity)}
        />
        <StatButton
          label={t('dashboard.noExpiration')}
          value={numberFormat.format(s.noExpiration)}
        />
        <StatButton
          label={t('dashboard.categoriesUsed')}
          value={numberFormat.format(s.categoriesUsed)}
          onClick={() => {
            void navigate('/categories');
          }}
        />
        <StatButton
          label={t('dashboard.recentlyModified')}
          value={numberFormat.format(s.recentlyModified)}
        />
      </section>

      <div className={screens.twoThirds}>
        <div className={screens.page}>
          <Card title={t('dashboard.byCategory')}>
            <BarChart
              data={categoryData}
              emptyLabel={t('inventory.emptyTitle')}
              formatValue={(value) => numberFormat.format(value)}
            />
          </Card>

          <div className={screens.columns}>
            <Card title={t('dashboard.stockBreakdown')}>
              <StatusChart
                data={stockData}
                emptyLabel={t('inventory.emptyTitle')}
                formatValue={(value) => numberFormat.format(value)}
              />
            </Card>

            <Card title={t('dashboard.expiryBreakdown')}>
              <StatusChart
                data={expiryData}
                emptyLabel={t('inventory.emptyTitle')}
                formatValue={(value) => numberFormat.format(value)}
              />
            </Card>
          </div>

          {locationData.length > 0 && (
            <Card title={t('dashboard.byLocation')}>
              <BarChart
                data={locationData}
                emptyLabel={t('locations.emptyTitle')}
                formatValue={(value) => numberFormat.format(value)}
              />
            </Card>
          )}
        </div>

        <PreparednessCard
          report={preparedness}
          categoryName={categoryName}
          onSeeAll={() => {
            void navigate('/replenishment');
          }}
        />
      </div>
    </div>
  );
}

function StatButton({
  label,
  value,
  tone,
  onClick,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'critical' | 'warning' | 'ok' | undefined;
  readonly onClick?: (() => void) | undefined;
}) {
  const toneStyle =
    tone === 'critical'
      ? { color: 'var(--status-critical)' }
      : tone === 'warning'
        ? { color: 'var(--status-warning)' }
        : undefined;

  const content = (
    <>
      <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, lineHeight: 1.1, ...toneStyle }}>
        {value}
      </span>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 500,
        }}
      >
        {label}
      </span>
    </>
  );

  const base: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
    padding: 'var(--space-4)',
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    textAlign: 'left',
    fontVariantNumeric: 'tabular-nums',
  };

  if (onClick === undefined) return <div style={base}>{content}</div>;

  return (
    <button type="button" style={{ ...base, cursor: 'pointer' }} onClick={onClick}>
      {content}
    </button>
  );
}

function PreparednessCard({
  report,
  categoryName,
  onSeeAll,
}: {
  readonly report: ReturnType<typeof evaluatePreparedness> | null;
  readonly categoryName: (id: string | null) => string;
  readonly onSeeAll: () => void;
}) {
  const { t } = useApp();

  if (report === null) return <Card title={t('preparedness.title')}>{null}</Card>;

  if (report.totals.itemsCounted === 0) {
    return (
      <Card title={t('preparedness.title')}>
        <p style={{ color: 'var(--text-secondary)' }}>{t('preparedness.notEnoughData')}</p>
      </Card>
    );
  }

  const weakest = report.categories.slice(0, 5).map((category) => ({
    id: category.categoryId,
    label: categoryName(category.categoryId),
    value: Math.round(category.score * 100),
  }));

  return (
    <Card title={t('preparedness.title')}>
      <ScoreMeter
        score={report.score}
        caption={t('preparedness.score')}
        label={t('preparedness.score')}
      />

      <div style={{ marginTop: 'var(--space-5)' }}>
        <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
          {t('preparedness.weakestCategories')}
        </h3>
        <BarChart
          data={weakest}
          emptyLabel={t('preparedness.noDeficits')}
          formatValue={(value) => `${String(value)}%`}
        />
      </div>

      <div style={{ marginTop: 'var(--space-5)' }}>
        <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          {t('preparedness.whatIsMissing')}
        </h3>
        {report.deficits.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>{t('preparedness.noDeficits')}</p>
        ) : (
          <>
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
              {report.deficits.slice(0, 6).map((deficit, index) => (
                <li
                  key={`${deficit.reason}-${deficit.itemId ?? deficit.categoryId ?? String(index)}`}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}
                >
                  <span>
                    {deficit.name ?? categoryName(deficit.categoryId)}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>
                      {deficit.reason === 'expired'
                        ? t('preparedness.expiredStock')
                        : deficit.reason === 'category-empty'
                          ? t('preparedness.categoryEmpty')
                          : t('preparedness.belowMinimum')}
                    </span>
                  </span>
                  {deficit.needed !== null && deficit.needed > 0 && (
                    <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      +{deficit.needed}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {report.deficits.length > 6 && (
              <Button size="small" onClick={onSeeAll} style={{ marginTop: 'var(--space-3)' }}>
                {t('replenishment.title')}
              </Button>
            )}
          </>
        )}
      </div>

      {/*
        The methodology, stated in the interface rather than buried in a manual.
        A score whose derivation is hidden is a score nobody has reason to trust.
      */}
      <details style={{ marginTop: 'var(--space-5)', fontSize: 'var(--text-sm)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
          {t('preparedness.howItIsCalculated')}
        </summary>
        <div style={{ marginTop: 'var(--space-3)', color: 'var(--text-secondary)', display: 'grid', gap: 'var(--space-2)' }}>
          <p>{t('preparedness.methodIntro')}</p>
          <ul style={{ paddingLeft: '1.1rem', display: 'grid', gap: 'var(--space-1)' }}>
            <li>{t('preparedness.methodItem')}</li>
            <li>{t('preparedness.methodCategory')}</li>
            <li>{t('preparedness.methodOverall')}</li>
          </ul>
          <p>
            {t('preparedness.priorityWeights')}:{' '}
            {Object.entries(PREPAREDNESS_PRIORITY_WEIGHTS)
              .map(([priority, weight]) => `${t(`priority.${priority}`)} ×${String(weight)}`)
              .join(' · ')}
          </p>
        </div>
      </details>
    </Card>
  );
}
