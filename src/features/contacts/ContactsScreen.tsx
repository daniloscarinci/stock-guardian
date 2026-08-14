/**
 * Emergency contacts.
 *
 * Ordered by priority, then name. In the situation this application exists for,
 * the person you need first should be at the top of the list rather than
 * wherever the alphabet happens to put them.
 *
 * Phone numbers and email addresses are links. `tel:` and `mailto:` hand off to
 * the device's own dialler and mail app - they are not network requests, and
 * they work with no connection.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData, useDebounced } from '../../hooks/useAsyncData';
import { Alert, Badge, Button, Card, EmptyState, Loading } from '../../components/ui/primitives';
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { DeleteIcon, EditIcon } from '../../components/ui/icons';
import { createContactsRepository } from '../../repositories/contacts.repository';
import { PRIORITIES, type Contact, type Priority } from '../../types/domain';
import screens from '../screens.module.css';

interface FormState {
  id: string | null;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  location: string;
  notes: string;
  priority: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  relationship: '',
  phone: '',
  email: '',
  location: '',
  notes: '',
  priority: '3',
};

const PRIORITY_TONE: Record<number, 'critical' | 'warning' | 'neutral'> = {
  1: 'critical',
  2: 'warning',
  3: 'neutral',
  4: 'neutral',
};

export function ContactsScreen() {
  const { t, db, revision, invalidate } = useApp();

  const contacts = useMemo(() => createContactsRepository(db), [db]);

  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 220);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const list = useAsyncData(() => contacts.search(debounced), [contacts, debounced, revision]);

  const save = async () => {
    if (form === null) return;
    setFormError(null);

    const name = form.name.trim();
    if (name === '') {
      setFormError(t('errors.validationRequired', { field: t('contacts.contactName') }));
      return;
    }

    const payload = {
      name,
      relationship: form.relationship.trim() === '' ? null : form.relationship.trim(),
      phone: form.phone.trim() === '' ? null : form.phone.trim(),
      email: form.email.trim() === '' ? null : form.email.trim(),
      location: form.location.trim() === '' ? null : form.location.trim(),
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
      priority: Number(form.priority) as Priority,
    };

    try {
      if (form.id === null) await contacts.create(payload);
      else await contacts.update(form.id, payload);
      setForm(null);
      invalidate();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async (contact: Contact) => {
    setError(null);
    try {
      await contacts.remove(contact.id);
      setDeleting(null);
      invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const rows = list.data ?? [];

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('contacts.title')}</h1>
          <p className={screens.pageSubtitle}>{t('contacts.subtitle')}</p>
        </div>
        <div className={screens.pageActions}>
          <Button
            variant="primary"
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError(null);
            }}
          >
            + {t('contacts.addContact')}
          </Button>
        </div>
      </header>

      {rows.length > 0 && (
        <div className={screens.toolbar}>
          <label className="sr-only" htmlFor="contacts-search">
            {t('common.search')}
          </label>
          <input
            id="contacts-search"
            className={screens.searchBox}
            type="search"
            placeholder={t('contacts.searchPlaceholder')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
      )}

      {error !== null && (
        <Alert tone="critical" role="alert" title={t('errors.genericTitle')}>
          {error}
        </Alert>
      )}

      {list.loading && list.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={debounced === '' ? t('contacts.emptyTitle') : t('contacts.noResults', { query: debounced })}
          body={debounced === '' ? t('contacts.emptyBody') : undefined}
          actions={
            debounced === '' ? (
              <Button
                variant="primary"
                onClick={() => {
                  setForm(EMPTY_FORM);
                }}
              >
                + {t('contacts.addContact')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
            {rows.map((contact) => (
              <li key={contact.id} className={screens.itemCardBottom}>
                <div className={screens.nameCell}>
                  <span className={screens.itemName}>{contact.name}</span>

                  <span className={screens.badgeRow}>
                    {contact.priority <= 2 && (
                      <Badge tone={PRIORITY_TONE[contact.priority] ?? 'neutral'} glyph="!">
                        {t(`priority.${contact.priority}`)}
                      </Badge>
                    )}
                    {contact.relationship !== null && (
                      <span className={screens.itemMeta}>{contact.relationship}</span>
                    )}
                  </span>

                  <span className={screens.itemMeta}>
                    {/* tel: and mailto: hand off to the device; neither is a network request. */}
                    {contact.phone !== null && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
                    {contact.phone !== null && contact.email !== null && ' · '}
                    {contact.email !== null && (
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    )}
                    {contact.location !== null && ` · ${contact.location}`}
                  </span>

                  {contact.notes !== null && (
                    <span className={screens.itemMeta}>{contact.notes}</span>
                  )}
                </div>

                <div className={screens.rowActions}>
                  <Button
                    size="small"
                    iconOnly
                    aria-label={t('common.edit')}
                    title={t('common.edit')}
                    onClick={() => {
                      setForm({
                        id: contact.id,
                        name: contact.name,
                        relationship: contact.relationship ?? '',
                        phone: contact.phone ?? '',
                        email: contact.email ?? '',
                        location: contact.location ?? '',
                        notes: contact.notes ?? '',
                        priority: String(contact.priority),
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
                    title={t('common.delete')}
                    onClick={() => {
                      setDeleting(contact);
                    }}
                  >
                    <DeleteIcon />
                  </Button>
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
        title={form?.id === null ? t('contacts.newContact') : t('contacts.editContact')}
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
          <form
            className={screens.formGrid}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className={screens.formGridFull}>
              <TextField
                label={t('contacts.contactName')}
                value={form.name}
                error={formError ?? undefined}
                autoFocus
                required
                onChange={(event) => {
                  setForm({ ...form, name: event.target.value });
                }}
              />
            </div>

            <TextField
              label={t('contacts.relationship')}
              placeholder={t('contacts.relationshipPlaceholder')}
              value={form.relationship}
              optionalLabel={t('common.optional')}
              onChange={(event) => {
                setForm({ ...form, relationship: event.target.value });
              }}
            />

            <SelectField
              label={t('common.priority')}
              help={t('contacts.priorityHelp')}
              value={form.priority}
              onChange={(event) => {
                setForm({ ...form, priority: event.target.value });
              }}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={String(priority)}>
                  {t(`priority.${priority}`)}
                </option>
              ))}
            </SelectField>

            <TextField
              label={t('contacts.phone')}
              type="tel"
              inputMode="tel"
              value={form.phone}
              optionalLabel={t('common.optional')}
              onChange={(event) => {
                setForm({ ...form, phone: event.target.value });
              }}
            />

            <TextField
              label={t('contacts.email')}
              type="email"
              inputMode="email"
              value={form.email}
              optionalLabel={t('common.optional')}
              onChange={(event) => {
                setForm({ ...form, email: event.target.value });
              }}
            />

            <div className={screens.formGridFull}>
              <TextField
                label={t('contacts.whereTheyAre')}
                value={form.location}
                optionalLabel={t('common.optional')}
                onChange={(event) => {
                  setForm({ ...form, location: event.target.value });
                }}
              />
            </div>

            <div className={screens.formGridFull}>
              <TextAreaField
                label={t('common.notes')}
                value={form.notes}
                optionalLabel={t('common.optional')}
                onChange={(event) => {
                  setForm({ ...form, notes: event.target.value });
                }}
              />
            </div>

            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
              {t('common.save')}
            </button>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={t('contacts.deleteTitle')}
        body={t('contacts.deleteBody', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting !== null) void remove(deleting);
        }}
      />
    </div>
  );
}
