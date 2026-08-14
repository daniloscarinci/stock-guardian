/**
 * Category management.
 *
 * Categories can be renamed in any language without touching a single item,
 * because the identifier is a slug and the labels live in a side table. That is
 * the structural fix for the original application's worst bug: it stored the
 * localized label on every record, so switching language orphaned everything.
 *
 * Built-in categories cannot be deleted - they anchor the reference catalog -
 * but they can be hidden, which keeps them off new items while leaving existing
 * ones intact.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Badge, Button, Card, Loading } from '../../components/ui/primitives';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { CategoryInUseError, SystemCategoryError } from '../../repositories/categories.repository';
import { LANGUAGES } from '../../domain/settings';
import type { Category } from '../../types/domain';
import screens from '../screens.module.css';

interface FormState {
  id: string | null;
  names: Record<string, string>;
}

export function CategoriesScreen() {
  const { t, repositories, settings, revision, invalidate } = useApp();
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const categories = useAsyncData(
    () => repositories.categories.list(true),
    [repositories.categories, revision],
  );
  const counts = useAsyncData(
    () => repositories.categories.itemCounts(),
    [repositories.categories, revision],
  );
  const catalogCounts = useAsyncData(
    () => repositories.catalog.countByCategory(),
    [repositories.catalog, revision],
  );

  const label = (category: Category) =>
    category.names[settings.language] ?? category.names.en ?? category.id;

  const save = async () => {
    if (form === null) return;
    setFormError(null);

    const names = Object.fromEntries(
      Object.entries(form.names).filter(([, value]) => value.trim() !== ''),
    );
    if (Object.keys(names).length === 0) {
      setFormError(t('errors.validationRequired', { field: t('categories.categoryName') }));
      return;
    }

    try {
      if (form.id === null) await repositories.categories.create({ names });
      else await repositories.categories.update(form.id, { names });
      setForm(null);
      invalidate();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async (category: Category, force: boolean) => {
    setError(null);
    try {
      await repositories.categories.remove(
        category.id,
        force ? { reassignTo: reassignTo === '' ? null : reassignTo } : {},
      );
      setDeleting(null);
      invalidate();
    } catch (cause) {
      if (cause instanceof CategoryInUseError) {
        setDeleting(category);
        setReassignTo('');
        return;
      }
      setError(
        cause instanceof SystemCategoryError
          ? t('categories.cannotDeleteBuiltIn')
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    }
  };

  const toggleActive = async (category: Category) => {
    setError(null);
    try {
      await repositories.categories.update(category.id, { active: !category.active });
      invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('categories.title')}</h1>
          <p className={screens.pageSubtitle}>{t('categories.subtitle')}</p>
        </div>
        <div className={screens.pageActions}>
          <Button
            variant="primary"
            onClick={() => {
              setForm({ id: null, names: {} });
              setFormError(null);
            }}
          >
            + {t('categories.addCategory')}
          </Button>
        </div>
      </header>

      {error !== null && (
        <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
          {error}
        </Alert>
      )}

      {categories.loading && categories.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : (
        <Card>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
            {(categories.data ?? []).map((category) => (
              <li key={category.id} className={screens.itemCardBottom}>
                <div className={screens.nameCell}>
                  <span className={screens.itemName}>{label(category)}</span>
                  <span className={screens.badgeRow}>
                    <Badge tone={category.isSystem ? 'info' : 'neutral'}>
                      {category.isSystem ? t('categories.builtIn') : t('categories.custom')}
                    </Badge>
                    {!category.active && <Badge tone="neutral">{t('categories.hidden')}</Badge>}
                  </span>
                  <span className={screens.itemMeta}>
                    {t('categories.itemsInCategory', { count: counts.data?.get(category.id) ?? 0 })}
                    {' · '}
                    {t('categories.catalogItems', {
                      count: catalogCounts.data?.get(category.id) ?? 0,
                    })}
                  </span>
                </div>

                <div className={screens.rowActions}>
                  <Button
                    size="small"
                    onClick={() => {
                      setForm({ id: category.id, names: { ...category.names } });
                      setFormError(null);
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button size="small" onClick={() => void toggleActive(category)}>
                    {category.active ? t('categories.hide') : t('categories.show')}
                  </Button>
                  {!category.isSystem && (
                    <Button
                      size="small"
                      variant="danger"
                      onClick={() => void remove(category, false)}
                    >
                      {t('common.delete')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        title={form?.id === null ? t('categories.newCategory') : t('categories.editCategory')}
        description={t('categories.hideHelp')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button
              onClick={() => {
                setForm(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {form !== null && (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {/* A field per language: renaming one never affects the others. */}
            {LANGUAGES.map((language, index) => (
              <TextField
                key={language}
                label={t('categories.nameInLanguage', { language: t(`languages.${language}`) })}
                value={form.names[language] ?? ''}
                autoFocus={index === 0}
                error={index === 0 ? (formError ?? undefined) : undefined}
                onChange={(event) => {
                  setForm({ ...form, names: { ...form.names, [language]: event.target.value } });
                }}
              />
            ))}
          </div>
        )}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={t('categories.deleteTitle', { name: deleting === null ? '' : label(deleting) })}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button
              onClick={() => {
                setDeleting(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting !== null) void remove(deleting, true);
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        {deleting !== null && (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p>
              {t('categories.deleteInUse', { count: counts.data?.get(deleting.id) ?? 0 })}
            </p>
            <SelectField
              label={t('categories.moveItemsTo')}
              value={reassignTo}
              onChange={(event) => {
                setReassignTo(event.target.value);
              }}
            >
              <option value="">{t('common.uncategorized')}</option>
              {(categories.data ?? [])
                .filter((category) => category.id !== deleting.id)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {label(category)}
                  </option>
                ))}
            </SelectField>
          </div>
        )}
      </Dialog>
    </div>
  );
}
