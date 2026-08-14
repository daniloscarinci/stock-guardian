/**
 * The replenishment centre.
 *
 * "Mark as bought" adds the outstanding quantity to the item rather than ticking
 * a checkbox somewhere. The item then leaves the list because it is genuinely
 * stocked, and the purchase appears in its history. A tick that only hid the row
 * would drift out of step with reality within a week.
 *
 * "Bought some" does the same for a partial amount. "Dismiss" is the only state
 * kept separately, because it is a decision rather than an event.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Button, Card, EmptyState, Loading } from '../../components/ui/primitives';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/Field';
import { buildReplenishmentList, type ReplenishmentLine } from '../../domain/replenishment';
import { formatCalendarDate } from '../../domain/dates';
import { downloadText, toCsv } from '../../services/download';
import screens from '../screens.module.css';

export function ReplenishmentScreen() {
  const { t, repositories, itemContext, settings, revision, invalidate, updateSettings } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<ReplenishmentLine | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  const items = useAsyncData(
    () => repositories.items.listForAnalysis(),
    [repositories.items, revision],
  );

  const categories = useAsyncData(
    () => repositories.categories.list(),
    [repositories.categories, revision],
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

  const lines = useMemo(() => {
    if (items.data === undefined) return [];
    return buildReplenishmentList({
      items: items.data,
      today: itemContext.today,
      defaultThreshold: itemContext.defaultThreshold,
      expiryWindows: itemContext.expiryWindows,
      dismissedItemIds: settings.replenishmentDismissed,
    });
  }, [items.data, itemContext, settings.replenishmentDismissed]);

  const dismissedLines = useMemo(() => {
    if (items.data === undefined || settings.replenishmentDismissed.length === 0) return [];
    const dismissed = new Set(settings.replenishmentDismissed);
    return buildReplenishmentList({
      items: items.data.filter((item) => dismissed.has(item.id)),
      today: itemContext.today,
      defaultThreshold: itemContext.defaultThreshold,
      expiryWindows: itemContext.expiryWindows,
    });
  }, [items.data, itemContext, settings.replenishmentDismissed]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const buyAll = (line: ReplenishmentLine) =>
    run(() =>
      repositories.items.adjustQuantity(line.itemId, line.needed, { type: 'purchase' }),
    );

  const dismiss = (line: ReplenishmentLine) =>
    run(() =>
      updateSettings({
        replenishmentDismissed: [...settings.replenishmentDismissed, line.itemId],
      }),
    );

  const undismiss = (itemId: string) =>
    run(() =>
      updateSettings({
        replenishmentDismissed: settings.replenishmentDismissed.filter((id) => id !== itemId),
      }),
    );

  const exportList = () => {
    const csv = toCsv(
      [
        t('common.name'),
        t('common.category'),
        t('stock.current'),
        t('stock.minimum'),
        t('stock.target'),
        t('stock.needed'),
        t('common.unit'),
        t('common.priority'),
        t('common.status'),
      ],
      lines.map((line) => [
        line.name,
        categoryName(line.categoryId),
        line.current,
        line.minimum,
        line.target,
        line.needed,
        line.unit,
        t(`priority.${line.priority}`),
        line.reason === 'expired' ? t('replenishment.reasonExpired') : t('replenishment.reasonBelowTarget'),
      ]),
    );
    downloadText(`stock-guardian-shopping-list-${itemContext.today}.csv`, csv, 'text/csv');
  };

  const numberFormat = new Intl.NumberFormat(settings.language, { maximumFractionDigits: 3 });

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('replenishment.title')}</h1>
          <p className={screens.pageSubtitle}>{t('replenishment.subtitle')}</p>
        </div>
        {lines.length > 0 && (
          <div className={screens.pageActions}>
            <Button onClick={exportList}>{t('replenishment.exportList')}</Button>
            <Button
              onClick={() => {
                window.print();
              }}
            >
              {t('common.print')}
            </Button>
          </div>
        )}
      </header>

      {error !== null && (
        <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
          {error}
        </Alert>
      )}

      {items.loading && items.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : lines.length === 0 ? (
        <EmptyState title={t('replenishment.listEmpty')} />
      ) : (
        <Card
          title={t('replenishment.totalLines', { count: lines.length })}
          hint={t('replenishment.subtitle')}
        >
          <div className={screens.tableWrap}>
            <table className={screens.table}>
              <thead>
                <tr>
                  <th scope="col">{t('common.name')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col" className={screens.numeric}>
                    {t('stock.current')}
                  </th>
                  <th scope="col" className={screens.numeric}>
                    {t('stock.target')}
                  </th>
                  <th scope="col" className={screens.numeric}>
                    {t('stock.needed')}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.itemId}>
                    <td>
                      <div className={screens.nameCell}>
                        <span className={screens.itemName}>{line.name}</span>
                        <span className={screens.itemMeta}>{categoryName(line.categoryId)}</span>
                      </div>
                    </td>
                    <td>
                      <span className={screens.itemMeta}>
                        {line.reason === 'expired'
                          ? t('replenishment.reasonExpired')
                          : t('replenishment.reasonBelowTarget')}
                        {line.expirationDate !== null && line.reason === 'expired'
                          ? ` · ${formatCalendarDate(line.expirationDate, settings.dateFormat)}`
                          : ''}
                      </span>
                    </td>
                    <td className={screens.numeric}>
                      {numberFormat.format(line.current)} {line.unit}
                    </td>
                    <td className={screens.numeric}>
                      {numberFormat.format(line.target)} {line.unit}
                    </td>
                    <td className={screens.numeric}>
                      <strong>
                        +{numberFormat.format(line.needed)} {line.unit}
                      </strong>
                    </td>
                    <td>
                      <div className={screens.rowActions}>
                        <Button size="small" variant="primary" onClick={() => void buyAll(line)}>
                          {t('replenishment.markPurchased')}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setPartial(line);
                            setPartialAmount('');
                          }}
                        >
                          {t('replenishment.markPartial')}
                        </Button>
                        <Button size="small" onClick={() => void dismiss(line)}>
                          {t('replenishment.dismiss')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={screens.cardList}>
            {lines.map((line) => (
              <article key={line.itemId} className={screens.itemCard}>
                <div className={screens.nameCell}>
                  <span className={screens.itemName}>{line.name}</span>
                  <span className={screens.itemMeta}>
                    {categoryName(line.categoryId)} ·{' '}
                    {line.reason === 'expired'
                      ? t('replenishment.reasonExpired')
                      : t('replenishment.reasonBelowTarget')}
                  </span>
                  <span className={screens.itemMeta}>
                    {t('stock.current')} {numberFormat.format(line.current)} {line.unit} ·{' '}
                    {t('stock.target')} {numberFormat.format(line.target)} {line.unit}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
                  +{numberFormat.format(line.needed)} {line.unit}
                </p>
                <div className={screens.rowActions}>
                  <Button size="small" variant="primary" onClick={() => void buyAll(line)}>
                    {t('replenishment.markPurchased')}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setPartial(line);
                      setPartialAmount('');
                    }}
                  >
                    {t('replenishment.markPartial')}
                  </Button>
                  <Button size="small" onClick={() => void dismiss(line)}>
                    {t('replenishment.dismiss')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}

      {dismissedLines.length > 0 && (
        <Card title={t('replenishment.dismissed')}>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {dismissedLines.map((line) => (
              <li key={line.itemId} className={screens.itemCardBottom}>
                <span>
                  {line.name}{' '}
                  <span className={screens.itemMeta}>
                    +{numberFormat.format(line.needed)} {line.unit}
                  </span>
                </span>
                <Button size="small" onClick={() => void undismiss(line.itemId)}>
                  {t('replenishment.restore')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog
        open={partial !== null}
        onClose={() => {
          setPartial(null);
        }}
        title={t('replenishment.markPartial')}
        description={partial?.name}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button
              onClick={() => {
                setPartial(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const line = partial;
                const amount = Number(partialAmount);
                setPartial(null);
                if (line !== null && Number.isFinite(amount) && amount > 0) {
                  void run(() =>
                    repositories.items.adjustQuantity(line.itemId, amount, { type: 'purchase' }),
                  );
                }
              }}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <TextField
          label={t('common.quantity')}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          autoFocus
          value={partialAmount}
          help={
            partial === null
              ? undefined
              : t('replenishment.boughtSoFar', { purchased: 0, needed: partial.needed })
          }
          onChange={(event) => {
            setPartialAmount(event.target.value);
          }}
        />
      </Dialog>
    </div>
  );
}
