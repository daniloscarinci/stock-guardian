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
import type { Category, Contact, InventoryItem, Location } from '../../types/domain';
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
  | { readonly kind: 'restoreQuantity'; readonly itemId: string; readonly to: number }
  | { readonly kind: 'restoreExpiry'; readonly itemId: string; readonly to: string | null }
  /*
   * The shelf the item was on, by id, and null for "it was on none".
   *
   * The value again, not the inverse. There is no arithmetic to get wrong here,
   * but there is a fact to lose: an item moved out of nowhere has no previous
   * location, and an undo that could only say "move it back somewhere" would
   * have to invent one. Recording null puts back null.
   */
  | { readonly kind: 'restoreLocation'; readonly itemId: string; readonly to: string | null }
  /*
   * The thresholds, both of which are nullable and neither of which is zero
   * when it is absent.
   *
   * `null` means the user never set a minimum, and the replenishment list then
   * falls back to the global threshold; `0` means they set it to nothing and
   * the list never speaks up about this item. An undo that turned the first
   * into the second would silence a warning the user never asked to silence,
   * so the previous value is recorded exactly as it was found.
   */
  | { readonly kind: 'restoreMinimum'; readonly itemId: string; readonly to: number | null }
  | { readonly kind: 'restoreTarget'; readonly itemId: string; readonly to: number | null }
  | { readonly kind: 'deleteItem'; readonly itemId: string }
  /*
   * The rows a sentence made that were not items.
   *
   * Each one is deleted rather than archived, for the reason `deleteItem`
   * gives: a row created seconds ago by a misheard sentence was never real,
   * and leaving it behind would put something nobody asked for into a list
   * the user trusts.
   */
  | { readonly kind: 'deleteLocation'; readonly locationId: string }
  | { readonly kind: 'deleteCategory'; readonly categoryId: string }
  | { readonly kind: 'deleteContact'; readonly contactId: string };

/**
 * What it would take to put a whole sentence back.
 *
 * A LIST, in the order the actions must run, which is the reverse of the
 * order they were written in. One sentence can write twice - "move the rice
 * to the cellar" against a pantry with no cellar makes the place and then
 * moves the rice - and an undo that took back only the second half would
 * leave an empty place nobody asked for.
 *
 * The item id moved onto each action rather than sitting beside them, because
 * two actions in one receipt need not be about the same row.
 */
export interface Receipt {
  readonly undo: readonly UndoAction[];
}

/**
 * What a sentence produced.
 *
 * A total union rather than a nullable item, so a write that makes something
 * new is a compile error everywhere that renders a receipt until it has been
 * given a sentence to say.
 */
export type Wrote =
  | { readonly kind: 'item'; readonly item: InventoryItem }
  | { readonly kind: 'location'; readonly location: Location }
  | { readonly kind: 'category'; readonly category: Category }
  | { readonly kind: 'contact'; readonly contact: Contact };

/** A write that happened, and the way back from it. */
export interface Committed {
  readonly wrote: Wrote;
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
      return {
        wrote: { kind: 'item', item },
        receipt: { undo: [{ kind: 'restoreQuantity', itemId: item.id, to: before }] },
      };
    }

    case 'EXPIRY': {
      const current = await deps.items.getById(write.item.id);
      const before = current === undefined ? write.before : current.expirationDate;

      const item = await deps.items.update(write.item.id, { expirationDate: write.after });
      return {
        wrote: { kind: 'item', item },
        receipt: { undo: [{ kind: 'restoreExpiry', itemId: item.id, to: before }] },
      };
    }

    /*
     * `items.transfer` rather than `items.update({ locationId })`.
     *
     * Both change the column. Only one of them writes the transfer row, and
     * the repository's rule is the same rule the quantity follows: a location
     * that changed with no record of the change makes the transaction log
     * untrustworthy. The row it writes carries the shelf it came from and the
     * shelf it went to, which is what makes "where was this before" answerable
     * at all.
     */
    case 'MOVE': {
      const current = await deps.items.getById(write.item.id);
      const before = current === undefined ? write.fromLocationId : current.locationId;

      const item = await deps.items.transfer(write.item.id, write.toLocationId, SPOKEN);
      return {
        wrote: { kind: 'item', item },
        receipt: { undo: [{ kind: 'restoreLocation', itemId: item.id, to: before }] },
      };
    }

    /*
     * Read back before writing, exactly as ADJUST and EXPIRY do. The view on
     * the write was built when the phrase was executed, and the Inventory
     * screen can have edited the same field since; the receipt has to name the
     * value this write actually replaced.
     */
    case 'MINIMUM': {
      const current = await deps.items.getById(write.item.id);
      const before = current === undefined ? write.before : current.minimumQuantity;

      const item = await deps.items.update(write.item.id, { minimumQuantity: write.after });
      return {
        wrote: { kind: 'item', item },
        receipt: { undo: [{ kind: 'restoreMinimum', itemId: item.id, to: before }] },
      };
    }

    case 'TARGET': {
      const current = await deps.items.getById(write.item.id);
      const before = current === undefined ? write.before : current.idealQuantity;

      const item = await deps.items.update(write.item.id, { idealQuantity: write.after });
      return {
        wrote: { kind: 'item', item },
        receipt: { undo: [{ kind: 'restoreTarget', itemId: item.id, to: before }] },
      };
    }

    case 'CREATE': {
      const item = await deps.items.create({
        name: write.name,
        quantity: write.quantity,
        unit: write.unit,
        locationId: write.locationId,
        expirationDate: write.expirationDate,
      });
      return {
        wrote: { kind: 'item', item },
        receipt: { undo: [{ kind: 'deleteItem', itemId: item.id }] },
      };
    }
  }
}

/**
 * A whole sentence, put back.
 *
 * One action at a time, in the order the receipt lists them, which is the
 * order that takes the last write back first. The two actions of a two-write
 * sentence are not independent - the item has to leave the new shelf before
 * the shelf can be deleted - so they are awaited in turn rather than started
 * together.
 */
export async function undo(deps: VoiceDeps, receipt: Receipt): Promise<void> {
  for (const action of receipt.undo) await undoOne(deps, action);
}

async function undoOne(deps: VoiceDeps, action: UndoAction): Promise<void> {
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
      const current = await deps.items.getById(action.itemId);
      // Gone already. Nothing to restore, and nothing to complain about: undo
      // is offered for a few seconds and the row can be deleted inside them.
      if (current === undefined) return;

      const delta = action.to - current.quantity;
      // `adjustQuantity` returns early on a zero delta and writes no history
      // for it, so this is the same no-op said out loud.
      if (delta === 0) return;

      await deps.items.adjustQuantity(action.itemId, delta, {
        type: 'correction',
        notes: UNDONE,
      });
      return;
    }

    case 'restoreExpiry':
      await deps.items.update(action.itemId, { expirationDate: action.to });
      return;

    /*
     * Another transfer, for the reason `restoreQuantity` gives about history:
     * the way back from a recorded move is a recorded move, not a silent
     * column edit that leaves the log claiming the item is still where it was
     * sent.
     */
    case 'restoreLocation':
      await deps.items.transfer(action.itemId, action.to, UNDONE);
      return;

    case 'restoreMinimum':
      await deps.items.update(action.itemId, { minimumQuantity: action.to });
      return;

    case 'restoreTarget':
      await deps.items.update(action.itemId, { idealQuantity: action.to });
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
      await deps.items.remove(action.itemId);
      return;

    /*
     * Deleted only while it is still empty.
     *
     * `locations.remove` throws `LocationInUseError` when the place holds
     * items or child places and no reassignment was named. That is exactly
     * the guard this needs and it is already written: if something else was
     * moved into the new place during the ten seconds Undo is on screen,
     * the place stays and the rest of the undo still runs.
     */
    case 'deleteLocation':
      try {
        await deps.locations.remove(action.locationId);
      } catch {
        return;
      }
      return;

    /*
     * The same guard again, from `categories.remove`, which throws
     * `CategoryInUseError` while any item still carries the category. A
     * category something was filed under inside those ten seconds is one the
     * user has started to use, and taking it away would take the filing with
     * it.
     */
    case 'deleteCategory':
      try {
        await deps.categories.remove(action.categoryId);
      } catch {
        return;
      }
      return;

    /*
     * No guard, because nothing points at a contact. It is a name and a
     * number in a row of its own, so deleting it takes nothing else with it
     * and there is no in-use error to catch.
     */
    case 'deleteContact':
      await deps.contacts.remove(action.contactId);
  }
}
