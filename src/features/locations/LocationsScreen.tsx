/**
 * Location management.
 *
 * The original had a free-text `loc` string on each item, so "Pantry" and
 * "pantry" were different places and nothing could be totalled. Locations are
 * now records that nest to any depth.
 *
 * Deleting one that still holds things is refused until the user says where
 * those things should go. Silently orphaning forty items to save a dialog is
 * not a trade worth making.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Button, Card, EmptyState, Loading } from '../../components/ui/primitives';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { DeleteIcon, EditIcon } from '../../components/ui/icons';
import { LocationCycleError, LocationInUseError } from '../../repositories/locations.repository';
import type { Location, LocationNode } from '../../types/domain';
import screens from '../screens.module.css';

interface FormState {
  id: string | null;
  name: string;
  parentId: string;
  description: string;
  notes: string;
}

const EMPTY_FORM: FormState = { id: null, name: '', parentId: '', description: '', notes: '' };

export function LocationsScreen() {
  const { t, repositories, revision, invalidate } = useApp();
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<LocationNode | null>(null);
  const [reassignItems, setReassignItems] = useState('');
  const [reparentChildren, setReparentChildren] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const tree = useAsyncData(() => repositories.locations.tree(), [repositories.locations, revision]);
  const flat = useAsyncData(() => repositories.locations.list(), [repositories.locations, revision]);

  const save = async () => {
    if (form === null) return;
    setFormError(null);
    const name = form.name.trim();
    if (name === '') {
      setFormError(t('errors.validationRequired', { field: t('locations.locationName') }));
      return;
    }

    try {
      const payload = {
        name,
        parentId: form.parentId === '' ? null : form.parentId,
        description: form.description.trim() === '' ? null : form.description.trim(),
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
      };
      if (form.id === null) await repositories.locations.create(payload);
      else await repositories.locations.update(form.id, payload);
      setForm(null);
      invalidate();
    } catch (cause) {
      setFormError(
        cause instanceof LocationCycleError
          ? t('locations.cycleError')
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    }
  };

  const remove = async (node: LocationNode, force: boolean) => {
    setError(null);
    try {
      await repositories.locations.remove(
        node.id,
        force
          ? {
              reassignItemsTo: reassignItems === '' ? null : reassignItems,
              reparentChildrenTo: reparentChildren === '' ? null : reparentChildren,
            }
          : {},
      );
      setDeleting(null);
      invalidate();
    } catch (cause) {
      if (cause instanceof LocationInUseError) {
        setDeleting(node);
        setReassignItems('');
        setReparentChildren('');
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const renderNode = (node: LocationNode): React.ReactNode => (
    <li key={node.id}>
      <div className={screens.itemCardBottom} style={{ paddingLeft: `${String(node.depth * 1.25)}rem` }}>
        <div className={screens.nameCell}>
          <span className={screens.itemName}>{node.name}</span>
          <span className={screens.itemMeta}>
            {t('locations.itemsHere', { count: node.itemCount })}
            {node.description !== null && node.description !== '' ? ` · ${node.description}` : ''}
          </span>
        </div>
        <div className={screens.rowActions}>
          <Button
            size="small"
            onClick={() => {
              setForm({ ...EMPTY_FORM, parentId: node.id });
              setFormError(null);
            }}
          >
            + {t('common.add')}
          </Button>
          <Button
            size="small"
            iconOnly
            aria-label={t('common.edit')}
            onClick={() => {
              setForm({
                id: node.id,
                name: node.name,
                parentId: node.parentId ?? '',
                description: node.description ?? '',
                notes: node.notes ?? '',
              });
              setFormError(null);
            }}
          >
            <EditIcon />
          </Button>
          <Button
            size="small"
            iconOnly
            variant="danger"
            aria-label={t('common.delete')}
            onClick={() => void remove(node, false)}
          >
            <DeleteIcon />
          </Button>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {node.children.map(renderNode)}
        </ul>
      )}
    </li>
  );

  /** Every location except the one being edited and its own descendants. */
  const parentOptions = (excludeId: string | null): Location[] => {
    const all = flat.data ?? [];
    if (excludeId === null) return [...all];
    const blocked = new Set<string>([excludeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const location of all) {
        if (location.parentId !== null && blocked.has(location.parentId) && !blocked.has(location.id)) {
          blocked.add(location.id);
          changed = true;
        }
      }
    }
    return all.filter((location) => !blocked.has(location.id));
  };

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('locations.title')}</h1>
          <p className={screens.pageSubtitle}>{t('locations.subtitle')}</p>
        </div>
        <div className={screens.pageActions}>
          <Button
            variant="primary"
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError(null);
            }}
          >
            + {t('locations.addLocation')}
          </Button>
        </div>
      </header>

      {error !== null && (
        <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
          {error}
        </Alert>
      )}

      {tree.loading && tree.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : (tree.data ?? []).length === 0 ? (
        <EmptyState
          title={t('locations.emptyTitle')}
          body={t('locations.emptyBody')}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setForm(EMPTY_FORM);
              }}
            >
              + {t('locations.addLocation')}
            </Button>
          }
        />
      ) : (
        <Card>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {(tree.data ?? []).map(renderNode)}
          </ul>
        </Card>
      )}

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        title={form?.id === null ? t('locations.newLocation') : t('locations.editLocation')}
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
            <TextField
              label={t('locations.locationName')}
              placeholder={t('locations.locationNamePlaceholder')}
              value={form.name}
              autoFocus
              error={formError ?? undefined}
              onChange={(event) => {
                setForm({ ...form, name: event.target.value });
              }}
            />
            <SelectField
              label={t('locations.parentLocation')}
              value={form.parentId}
              onChange={(event) => {
                setForm({ ...form, parentId: event.target.value });
              }}
            >
              <option value="">{t('locations.noParent')}</option>
              {parentOptions(form.id).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t('locations.description')}
              optionalLabel={t('common.optional')}
              value={form.description}
              onChange={(event) => {
                setForm({ ...form, description: event.target.value });
              }}
            />
            <TextAreaField
              label={t('common.notes')}
              optionalLabel={t('common.optional')}
              value={form.notes}
              onChange={(event) => {
                setForm({ ...form, notes: event.target.value });
              }}
            />
          </div>
        )}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={t('locations.deleteTitle', { name: deleting?.name ?? '' })}
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
              {t('locations.deleteInUse', {
                items: deleting.itemCount,
                children: deleting.children.length,
              })}
            </p>
            <SelectField
              label={t('locations.moveItemsTo')}
              value={reassignItems}
              onChange={(event) => {
                setReassignItems(event.target.value);
              }}
            >
              <option value="">{t('common.noLocation')}</option>
              {(flat.data ?? [])
                .filter((location) => location.id !== deleting.id)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </SelectField>
            <SelectField
              label={t('locations.moveChildrenTo')}
              value={reparentChildren}
              onChange={(event) => {
                setReparentChildren(event.target.value);
              }}
            >
              <option value="">{t('locations.noParent')}</option>
              {(flat.data ?? [])
                .filter((location) => location.id !== deleting.id)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </SelectField>
          </div>
        )}
      </Dialog>
    </div>
  );
}
