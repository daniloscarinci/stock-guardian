/**
 * The only module in the voice feature that writes.
 *
 * Called by the confirmation card's button, and by the caller that decides an
 * explicit write needs no confirmation at all - and by nothing else, which is
 * what keeps "nothing is stored unless something asked for it" a structural
 * property rather than a promise about the interface.
 *
 * Every write hands back a `Receipt`, so the caller that stored a change
 * without asking can offer to take it back.
 */
import type { InventoryItem } from '../../types/domain';
import type { VoiceDeps, PendingWrite } from './execute';

/**
 * What it would take to put a write back.
 *
 * The VALUE that was there, never the inverse of the change. `adjustQuantity`
 * clamps at zero, so an item holding 2 that is told to remove 5 lands on 0 -
 * and a +5 undo would leave 5, inventing three of something out of a mistake
 * the user was trying to correct. Recording 2 puts back 2.
 */
export type UndoAction =
  | { readonly kind: 'restoreQuantity'; readonly to: number }
  | { readonly kind: 'restoreExpiry'; readonly to: string | null }
  | { readonly kind: 'deleteItem' };

export interface Receipt {
  readonly itemId: string;
  readonly undo: UndoAction;
}

/** A write that happened, and the way back from it. */
export interface Committed {
  readonly item: InventoryItem;
  readonly receipt: Receipt;
}

/** The note left on every stock transaction this feature records. */
const SPOKEN = 'Por voz';

/** And on the one that takes it back, so the log says what happened. */
const UNDONE = 'Por voz (desfeito)';

export async function commit(deps: VoiceDeps, write: PendingWrite): Promise<Committed> {
  switch (write.kind) {
    case 'ADJUST': {
      // Read rather than taken from `write.item`, which is a view built when
      // the phrase was executed and may be a `+` tap out of date by now. The
      // receipt has to name the quantity this write actually replaced.
      const current = await deps.items.getById(write.item.id);
      const before = current === undefined ? write.item.quantity : current.quantity;

      const item = await deps.items.adjustQuantity(write.item.id, write.delta, {
        type: write.transaction,
        notes: SPOKEN,
      });
      return { item, receipt: { itemId: item.id, undo: { kind: 'restoreQuantity', to: before } } };
    }

    case 'EXPIRY': {
      const current = await deps.items.getById(write.item.id);
      const before = current === undefined ? write.before : current.expirationDate;

      const item = await deps.items.update(write.item.id, { expirationDate: write.after });
      return { item, receipt: { itemId: item.id, undo: { kind: 'restoreExpiry', to: before } } };
    }

    case 'CREATE': {
      const item = await deps.items.create({
        name: write.name,
        quantity: write.quantity,
        unit: write.unit,
        locationId: write.locationId,
        expirationDate: write.expirationDate,
      });
      return { item, receipt: { itemId: item.id, undo: { kind: 'deleteItem' } } };
    }
  }
}

/**
 * A write, put back.
 *
 * It takes the whole receipt rather than the action alone, because an action
 * cannot name the row it belongs to and an undo aimed at no item is not one.
 */
export async function undo(deps: VoiceDeps, receipt: Receipt): Promise<void> {
  const action = receipt.undo;

  switch (action.kind) {
    /*
     * A compensating adjustment, not a deleted history row.
     *
     * `items.repository.ts` says the quantity and its history move together,
     * and it means it: a count that changed with no record of the change makes
     * the whole transaction log untrustworthy. So the way back is another
     * entry, typed 'correction', which is what this is - the user said one
     * thing, the application heard it, and the number is being put right.
     */
    case 'restoreQuantity': {
      const current = await deps.items.getById(receipt.itemId);
      // Gone already. Nothing to restore, and nothing to complain about: undo
      // is offered for a few seconds and the row can be deleted inside them.
      if (current === undefined) return;

      const delta = action.to - current.quantity;
      // `adjustQuantity` returns early on a zero delta and writes no history
      // for it, so this is the same no-op said out loud.
      if (delta === 0) return;

      await deps.items.adjustQuantity(receipt.itemId, delta, {
        type: 'correction',
        notes: UNDONE,
      });
      return;
    }

    case 'restoreExpiry':
      await deps.items.update(receipt.itemId, { expirationDate: action.to });
      return;

    /*
     * Deleted, not archived.
     *
     * Archiving is for stock that existed and is finished with - it stays in
     * the archived list, in the counts and in an export, where it is a record
     * of something real. An item created seconds ago by a misheard sentence
     * was never real: leaving it archived would put a row nobody asked for
     * into all three places, and saying the same sentence again would create a
     * duplicate rather than bring it back.
     *
     * Nothing is lost by deleting. The row is that old, and its only history
     * is its own creation, which the schema cascades away with it.
     */
    case 'deleteItem':
      await deps.items.remove(receipt.itemId);
  }
}
