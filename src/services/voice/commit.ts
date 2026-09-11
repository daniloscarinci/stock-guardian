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
import { CategoryInUseError } from '../../repositories/categories.repository';
import { LocationInUseError } from '../../repositories/locations.repository';
import type { Category, Contact, InventoryItem, Location } from '../../types/domain';
import type { VoiceDeps, PendingWrite, Destination } from './execute';

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
 * order they were written in. "Move the rice to the cellar" against a pantry
 * with no cellar makes the place and then moves the rice, so its receipt puts
 * the rice back and then takes the empty place away; an undo that took back
 * only the second half would leave a shelf nobody asked for.
 *
 * The item id sits on each action rather than beside them, because the two
 * actions of that sentence are not about the same row.
 */
export interface Receipt {
  readonly undo: readonly UndoAction[];
}

/**
 * What a sentence produced.
 *
 * A total union rather than a nullable item, so a write that makes something
 * new is a compile error everywhere that renders a receipt until it has been
 * given a sentence to say. Not yet true of the one production caller, which
 * takes the receipt and leaves `wrote` alone; it becomes true when the screen
 * that says what happened starts reading this to say it.
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

      /*
       * The place first, then the move, and the undo list in the reverse
       * order - put the rice back, then take the empty place away.
       *
       * There is a window between those two writes, and nothing here closes
       * it. `items.transfer` throws outright when the item is gone, and it can
       * be gone: this write was DESCRIBED when the phrase was executed, and
       * nothing stops the row being deleted before anybody presses Confirm -
       * the same gap every case above reads the item back to cover. The place
       * has been made by then, the sentence fails, and no receipt comes back
       * to take it away.
       *
       * The orphan is left on purpose, for the reason `undo` below gives about
       * a receipt that fails part-way: a compensating delete is another write
       * that can fail in its turn, and there is no transaction to reach for -
       * `VoiceDeps` hands out repositories rather than the driver, so this
       * module cannot open one around a sentence. What is left behind is an
       * EMPTY place carrying the name the user said, listed on the Locations
       * screen and deletable there like any other. And saying the sentence
       * again finds it, so the second attempt is an ordinary move onto a shelf
       * that exists.
       */
      const destination = await reach(deps, write.to);
      const item = await deps.items.transfer(write.item.id, destination.id, SPOKEN);

      return {
        wrote: { kind: 'item', item },
        receipt: {
          undo: [
            { kind: 'restoreLocation', itemId: item.id, to: before },
            ...undoMaking(destination.made),
          ],
        },
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
      /*
       * The place first again, for the reason MOVE gives, and null stays null:
       * a creation that named no shelf at all makes none, where one that named
       * a shelf nobody has made yet makes that.
       *
       * The same window is open here, and answered the same way. `items.create`
       * failing after the place was made leaves an empty shelf with no receipt
       * to remove it, which is a row the user can see and delete rather than a
       * second write this module has no transaction to guard.
       */
      const destination = write.location === null ? null : await reach(deps, write.location);

      const item = await deps.items.create({
        name: write.name,
        quantity: write.quantity,
        unit: write.unit,
        locationId: destination?.id ?? null,
        expirationDate: write.expirationDate,
      });

      // The item goes first, which is also what makes the place deletable:
      // `locations.remove` refuses a shelf that still holds something.
      return {
        wrote: { kind: 'item', item },
        receipt: {
          undo: [
            { kind: 'deleteItem', itemId: item.id },
            ...undoMaking(destination?.made ?? null),
          ],
        },
      };
    }
  }
}

/**
 * A destination, as an id a write can use - making the place first where the
 * sentence named one that does not exist.
 *
 * The row it made comes back beside the id rather than the caller asking the
 * destination a second time what kind it was. That is not tidiness: an undo
 * has to name the place that was CREATED, and its id exists nowhere until this
 * call returns it. A caller that re-read `to.kind` instead would be reading
 * what the sentence asked for in place of what happened.
 *
 * It is also what leaves no room for an id that is not one. Every arm of the
 * switch supplies a real id, so there is no branch in which the place was
 * neither found nor made and something has to stand in for it.
 */
async function reach(
  deps: VoiceDeps,
  to: Destination,
): Promise<{ readonly id: string; readonly made: Location | null }> {
  switch (to.kind) {
    case 'existing':
      return { id: to.id, made: null };
    case 'new': {
      const made = await deps.locations.create({ name: to.name });
      return { id: made.id, made };
    }
  }
}

/**
 * The way back from having made a place, or nothing where none was made.
 *
 * A list of none or one, which is what lets both cases above spread it without
 * first asking whether there was anything to spread. Its position in a receipt
 * is not a choice: the place is written before the row that goes in it, so its
 * deletion is always the last action back.
 */
function undoMaking(made: Location | null): readonly UndoAction[] {
  return made === null ? [] : [{ kind: 'deleteLocation', locationId: made.id }];
}

/**
 * A whole sentence, put back.
 *
 * One action at a time, in the order the receipt lists them, which is the
 * order that takes the last write back first. The two actions of a two-write
 * sentence are not independent - the item has to leave the new shelf before
 * the shelf can be deleted - so they are awaited in turn rather than started
 * together.
 *
 * A failure part-way through stops there and throws, leaving the sentence
 * half taken back. That is deliberate; neither alternative is better, and one
 * of them is not available at all:
 *
 *  - Carrying on would run actions whose precondition the failed one was. If
 *    the item never left the new place, deleting that place throws
 *    `LocationInUseError` - which the case below is right to swallow - and the
 *    sentence would be reported as taken back when none of it was.
 *  - Putting back what already succeeded needs a transaction, and there is
 *    none to be had here: `VoiceDeps` hands out repositories, not the driver,
 *    so this module cannot open one around a receipt.
 *
 * So the caller keeps the receipt - `useVoice` only clears it after `undo`
 * resolves - and the Undo button survives to be pressed again. Pressing it is
 * not free: `items.transfer` writes its transfer row unconditionally, so an
 * action that already succeeded and is run a second time leaves a second
 * "Por voz (desfeito)" row in the log. A duplicated line in the history is a
 * smaller lie than a sentence reported as undone that was not.
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
     * the guard this needs and it is already written: something moved into
     * the new place during the ten seconds Undo is on screen was put there on
     * purpose, and the place is now the user's rather than the sentence's.
     *
     * Swallowing it is not about finishing the receipt - the place a sentence
     * made is undone last, so nothing follows it. It is about what the user
     * is told. The item did go back, which is the change they asked to take
     * back; a shelf they have since filled is not a failed undo, and saying
     * so would send them looking for a problem that is not there.
     *
     * Only that one, and the narrowing is the point. A locked database or a
     * worker that died is a real failure and is rethrown, so `takeBack` can
     * show it. Catching everything here would make this the one path in the
     * feature that reports "Desfeito" over a row that is still there.
     */
    case 'deleteLocation':
      try {
        await deps.locations.remove(action.locationId);
      } catch (cause) {
        if (!(cause instanceof LocationInUseError)) throw cause;
      }
      return;

    /*
     * The same guard again, from `categories.remove`, which throws
     * `CategoryInUseError` while any item still carries the category. A
     * category something was filed under inside those ten seconds is one the
     * user has started to use, and taking it away would take the filing with
     * it. Everything else it can throw - `SystemCategoryError` above all -
     * is rethrown.
     */
    case 'deleteCategory':
      try {
        await deps.categories.remove(action.categoryId);
      } catch (cause) {
        if (!(cause instanceof CategoryInUseError)) throw cause;
      }
      return;

    /*
     * No guard, because nothing points at a contact. It is a name and a
     * number in a row of its own, so deleting it takes nothing else with it
     * and there is no in-use error to catch.
     */
    case 'deleteContact':
      await deps.contacts.remove(action.contactId);
      return;

    /*
     * The switch says it is total, because the compiler will not.
     *
     * `undoOne` returns void, so a kind with no case falls straight out and
     * undoes nothing - and the user is still told "Desfeito" over the row it
     * left behind. The union went from six members to nine in one change and
     * more are coming, so the gap is closed here the way the total records in
     * `VoiceSheet.tsx` and `MicNotice.tsx` close theirs: by making the next
     * member a compile error rather than a silent nothing.
     */
    default: {
      const impossible: never = action;
      throw new Error(`No way back from ${JSON.stringify(impossible)}.`);
    }
  }
}
