/**
 * Moves an item to another location and records the move.
 *
 * A separate dialog rather than a field buried in the edit form: relocating
 * stock is a common, standalone action, and it produces a history entry that
 * editing a field would not.
 */
import { useEffect, useState } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/primitives';
import { SelectField, TextField } from '../../components/ui/Field';
import { useApp } from '../../app/AppContext';
import type { InventoryItemView, Location } from '../../types/domain';

export function MoveItemDialog({
  item,
  locations,
  onClose,
  onMoved,
}: {
  readonly item: InventoryItemView | null;
  readonly locations: readonly Location[];
  readonly onClose: () => void;
  readonly onMoved: () => void;
}) {
  const { t, repositories } = useApp();
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDestination(item?.locationId ?? '');
    setNotes('');
    setError(null);
  }, [item]);

  const handleMove = async () => {
    if (item === null) return;
    setSaving(true);
    setError(null);
    try {
      await repositories.items.transfer(
        item.id,
        destination === '' ? null : destination,
        notes.trim() === '' ? null : notes.trim(),
      );
      onMoved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      title={t('inventory.moveItem')}
      description={item?.name}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void handleMove()} disabled={saving}>
            {saving ? t('common.loading') : t('common.transfer')}
          </Button>
        </>
      }
    >
      <SelectField
        label={t('inventory.moveTo')}
        value={destination}
        onChange={(event) => {
          setDestination(event.target.value);
        }}
      >
        <option value="">{t('common.noLocation')}</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </SelectField>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <TextField
          label={t('common.notes')}
          optionalLabel={t('common.optional')}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </div>

      {error !== null && (
        <p role="alert" style={{ marginTop: 'var(--space-3)', color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
    </Dialog>
  );
}
