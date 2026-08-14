/**
 * Create and edit an inventory item.
 *
 * One form for both, because they are the same fields. Validation is inline and
 * specific - the original application's save button simply did nothing when the
 * name or date was missing, with no message at all, which is indistinguishable
 * from the app being broken.
 */
import { useEffect, useState } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/primitives';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { useApp } from '../../app/AppContext';
import { isValidCalendarDate } from '../../domain/dates';
import { CONDITIONS, PRIORITIES, type InventoryItem, type Priority } from '../../types/domain';
import type { Category, Location } from '../../types/domain';
import type { CreateItemInput } from '../../repositories/items.repository';
import screens from '../screens.module.css';

export interface ItemFormValues {
  name: string;
  categoryId: string;
  locationId: string;
  quantity: string;
  unit: string;
  minimumQuantity: string;
  idealQuantity: string;
  expirationDate: string;
  purchaseDate: string;
  openedDate: string;
  condition: string;
  priority: string;
  barcode: string;
  notes: string;
}

const EMPTY: ItemFormValues = {
  name: '',
  categoryId: '',
  locationId: '',
  quantity: '0',
  unit: '',
  minimumQuantity: '',
  idealQuantity: '',
  expirationDate: '',
  purchaseDate: '',
  openedDate: '',
  condition: '',
  priority: '3',
  barcode: '',
  notes: '',
};

function toFormValues(item: InventoryItem): ItemFormValues {
  return {
    name: item.name,
    categoryId: item.categoryId ?? '',
    locationId: item.locationId ?? '',
    quantity: String(item.quantity),
    unit: item.unit,
    minimumQuantity: item.minimumQuantity === null ? '' : String(item.minimumQuantity),
    idealQuantity: item.idealQuantity === null ? '' : String(item.idealQuantity),
    expirationDate: item.expirationDate ?? '',
    purchaseDate: item.purchaseDate ?? '',
    openedDate: item.openedDate ?? '',
    condition: item.condition ?? '',
    priority: String(item.priority),
    barcode: item.barcode ?? '',
    notes: item.notes ?? '',
  };
}

/** Empty means "not set"; a real value must be a non-negative number. */
function parseOptionalNumber(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return 'invalid';
  return value;
}

export interface ItemFormDialogProps {
  readonly open: boolean;
  readonly item: InventoryItem | null;
  readonly initial?: Partial<ItemFormValues> | undefined;
  /**
   * Set when the item is being created from a reference catalog entry. Recorded
   * on the row so the catalog can report how many inventory items came from it,
   * and so provenance survives an export.
   */
  readonly catalogItemId?: string | null | undefined;
  readonly categories: readonly Category[];
  readonly locations: readonly Location[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function ItemFormDialog({
  open,
  item,
  initial,
  catalogItemId,
  categories,
  locations,
  onClose,
  onSaved,
}: ItemFormDialogProps) {
  const { t, repositories, settings } = useApp();
  const [values, setValues] = useState<ItemFormValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof ItemFormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaveError(null);
    setValues(
      item !== null
        ? toFormValues(item)
        : {
            ...EMPTY,
            locationId: settings.defaultLocationId ?? '',
            ...initial,
          },
    );
  }, [open, item, initial, settings.defaultLocationId]);

  const set = <K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): CreateItemInput | null => {
    const found: Partial<Record<keyof ItemFormValues, string>> = {};

    const name = values.name.trim();
    if (name === '') {
      found.name = t('errors.validationRequired', { field: t('inventory.itemName') });
    }

    const quantity = parseOptionalNumber(values.quantity);
    if (quantity === 'invalid') {
      found.quantity = t('errors.validationNegative', { field: t('common.quantity') });
    }

    const minimum = parseOptionalNumber(values.minimumQuantity);
    if (minimum === 'invalid') {
      found.minimumQuantity = t('errors.validationNegative', {
        field: t('inventory.minimumQuantity'),
      });
    }

    const ideal = parseOptionalNumber(values.idealQuantity);
    if (ideal === 'invalid') {
      found.idealQuantity = t('errors.validationNegative', { field: t('inventory.idealQuantity') });
    }

    for (const key of ['expirationDate', 'purchaseDate', 'openedDate'] as const) {
      const raw = values[key].trim();
      if (raw !== '' && !isValidCalendarDate(raw)) found[key] = t('errors.validationDate');
    }

    // Checked explicitly rather than inferred from `found` being non-empty, so
    // the compiler can narrow the parse results away from the 'invalid' marker.
    if (quantity === 'invalid' || minimum === 'invalid' || ideal === 'invalid') {
      setErrors(found);
      return null;
    }

    if (Object.values(found).some((value) => value !== undefined)) {
      setErrors(found);
      return null;
    }

    return {
      name,
      categoryId: values.categoryId === '' ? null : values.categoryId,
      locationId: values.locationId === '' ? null : values.locationId,
      quantity: quantity === null ? 0 : quantity,
      unit: values.unit.trim() === '' ? 'un' : values.unit.trim(),
      minimumQuantity: minimum === null ? null : minimum,
      idealQuantity: ideal === null ? null : ideal,
      expirationDate: values.expirationDate.trim() === '' ? null : values.expirationDate.trim(),
      purchaseDate: values.purchaseDate.trim() === '' ? null : values.purchaseDate.trim(),
      openedDate: values.openedDate.trim() === '' ? null : values.openedDate.trim(),
      condition: values.condition === '' ? null : (values.condition as CreateItemInput['condition']),
      priority: Number(values.priority) as Priority,
      barcode: values.barcode.trim() === '' ? null : values.barcode.trim(),
      notes: values.notes.trim() === '' ? null : values.notes.trim(),
      catalogItemId: catalogItemId ?? null,
    };
  };

  const handleSubmit = async () => {
    const input = validate();
    if (input === null) return;

    setSaving(true);
    setSaveError(null);
    try {
      if (item === null) await repositories.items.create(input);
      else await repositories.items.update(item.id, input);
      onSaved();
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const categoryName = (category: Category) =>
    category.names[settings.language] ?? category.names.en ?? category.id;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item === null ? t('inventory.newItem') : t('inventory.editItem')}
      closeLabel={t('common.close')}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className={screens.formGrid}
        onSubmit={(event) => {
          // A real form, so Enter submits. The original had no <form> element,
          // so the only way to save was to click the button.
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className={screens.formGridFull}>
          <TextField
            label={t('inventory.itemName')}
            placeholder={t('inventory.itemNamePlaceholder')}
            value={values.name}
            error={errors.name}
            autoFocus
            required
            onChange={(event) => {
              set('name', event.target.value);
            }}
          />
        </div>

        <SelectField
          label={t('common.category')}
          value={values.categoryId}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('categoryId', event.target.value);
          }}
        >
          <option value="">{t('common.uncategorized')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {categoryName(category)}
            </option>
          ))}
        </SelectField>

        <SelectField
          label={t('common.location')}
          value={values.locationId}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('locationId', event.target.value);
          }}
        >
          <option value="">{t('common.noLocation')}</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </SelectField>

        <TextField
          label={t('common.quantity')}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={values.quantity}
          error={errors.quantity}
          onChange={(event) => {
            set('quantity', event.target.value);
          }}
        />

        <TextField
          label={t('common.unit')}
          placeholder={t('inventory.unitPlaceholder')}
          value={values.unit}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('unit', event.target.value);
          }}
        />

        <div className={screens.sectionTitle}>{t('stock.label')}</div>

        <TextField
          label={t('inventory.minimumQuantity')}
          help={t('inventory.minimumHelp')}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={values.minimumQuantity}
          error={errors.minimumQuantity}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('minimumQuantity', event.target.value);
          }}
        />

        <TextField
          label={t('inventory.idealQuantity')}
          help={t('inventory.idealHelp')}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={values.idealQuantity}
          error={errors.idealQuantity}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('idealQuantity', event.target.value);
          }}
        />

        <SelectField
          label={t('common.priority')}
          value={values.priority}
          onChange={(event) => {
            set('priority', event.target.value);
          }}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={String(priority)}>
              {t(`priority.${priority}`)}
            </option>
          ))}
        </SelectField>

        <div className={screens.sectionTitle}>{t('expiry.label')}</div>

        <TextField
          label={t('inventory.expirationDate')}
          help={t('inventory.expirationHelp')}
          type="date"
          value={values.expirationDate}
          error={errors.expirationDate}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('expirationDate', event.target.value);
          }}
        />

        <TextField
          label={t('inventory.purchaseDate')}
          type="date"
          value={values.purchaseDate}
          error={errors.purchaseDate}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('purchaseDate', event.target.value);
          }}
        />

        <TextField
          label={t('inventory.openedDate')}
          type="date"
          value={values.openedDate}
          error={errors.openedDate}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('openedDate', event.target.value);
          }}
        />

        <div className={screens.sectionTitle}>{t('common.notes')}</div>

        <SelectField
          label={t('common.condition')}
          value={values.condition}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('condition', event.target.value);
          }}
        >
          <option value="">{t('common.none')}</option>
          {CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {t(`condition.${condition}`)}
            </option>
          ))}
        </SelectField>

        <TextField
          label={t('common.barcode')}
          value={values.barcode}
          optionalLabel={t('common.optional')}
          onChange={(event) => {
            set('barcode', event.target.value);
          }}
        />

        <div className={screens.formGridFull}>
          <TextAreaField
            label={t('common.notes')}
            placeholder={t('inventory.notesPlaceholder')}
            value={values.notes}
            optionalLabel={t('common.optional')}
            onChange={(event) => {
              set('notes', event.target.value);
            }}
          />
        </div>

        {saveError !== null && (
          <p className={screens.formGridFull} role="alert">
            {saveError}
          </p>
        )}

        {/* Lets Enter submit while the visible buttons live in the footer. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
          {t('common.save')}
        </button>
      </form>
    </Dialog>
  );
}
