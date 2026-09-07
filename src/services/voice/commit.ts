/**
 * The only module in the voice feature that writes.
 *
 * Called by the confirmation card's button and by nothing else, which is what
 * makes "nothing is stored until you tap Confirmar" a structural property
 * rather than a promise about the interface.
 */
import type { InventoryItem } from '../../types/domain';
import type { VoiceDeps, PendingWrite } from './execute';

export async function commit(deps: VoiceDeps, write: PendingWrite): Promise<InventoryItem> {
  switch (write.kind) {
    case 'ADJUST':
      return deps.items.adjustQuantity(write.item.id, write.delta, {
        type: write.transaction,
        notes: 'Por voz',
      });

    case 'EXPIRY':
      return deps.items.update(write.item.id, { expirationDate: write.after });

    case 'CREATE':
      return deps.items.create({
        name: write.name,
        quantity: write.quantity,
        unit: write.unit,
        locationId: write.locationId,
        expirationDate: write.expirationDate,
      });
  }
}
