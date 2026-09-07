/**
 * An item phrase to an item.
 *
 * Reuses the existing search rather than growing a second one: `items.list`
 * already folds accents and ANDs across terms, which is exactly the matching a
 * garbled transcript needs.
 *
 * Ties matter more here than in a text search, because the user is not looking
 * at a list. A phrase that fits two items raises a choice; it never guesses.
 */
import { foldText } from '../../domain/normalize';
import type { InventoryItemView } from '../../types/domain';
import type { ItemContext, ItemsRepository } from '../../repositories/items.repository';
import type { Language } from '../../domain/settings';

export type Resolution =
  | { readonly kind: 'one'; readonly item: InventoryItemView }
  | {
      readonly kind: 'many';
      readonly items: readonly InventoryItemView[];
      /**
       * How many actually tied, before the slice down to `MAX_CHOICES`.
       *
       * Without it, a phrase matching forty items and a phrase matching five
       * arrive at the caller identically, and the interface offers an arbitrary
       * five as if they were the shortlist. `total > items.length` is the
       * signal to ask for a clearer phrase rather than to read a list.
       */
      readonly total: number;
    }
  | { readonly kind: 'none'; readonly phrase: string };

/**
 * Higher wins. The gap between tiers is what makes a clear winner clear.
 *
 * The floor is 1, never 0: every row here came back from the search, so it
 * matches the phrase somewhere. Some of those places - the per-language names a
 * backup import writes, the category, the location, the barcode - are not on
 * `InventoryItemView` and so cannot be scored. Dropping those rows would report
 * "nothing found" for an item the user can see under exactly the name they
 * said. They rank last instead, where any name match beats them outright.
 */
function score(phrase: string, item: InventoryItemView): number {
  const name = foldText(item.name);
  if (name === phrase) return 100;
  if (name.startsWith(phrase)) return 60;

  const tokens = phrase.split(' ').filter((token) => token !== '');
  const inName = tokens.filter((token) => name.includes(token)).length;
  if (inName === tokens.length) return 40;

  const notes = item.notes === null ? '' : foldText(item.notes);
  const inNotes = tokens.filter((token) => notes.includes(token)).length;
  return Math.max(1, inName * 4 + inNotes);
}

/**
 * At most this many are offered as a choice.
 *
 * A spoken list longer than five is not a choice, it is a recital; the caller
 * asks for a clearer phrase instead of reading the rest.
 */
const MAX_CHOICES = 5;

/** How many rows the search may return before scoring. Well past MAX_CHOICES. */
const SEARCH_LIMIT = 50;

export async function resolveItem(
  items: ItemsRepository,
  context: ItemContext,
  language: Language,
  phrase: string,
): Promise<Resolution> {
  const folded = foldText(phrase);
  if (folded === '') return { kind: 'none', phrase };

  const page = await items.list(context, {
    filters: { search: folded, archived: 'active' },
    limit: SEARCH_LIMIT,
    lang: language,
  });

  // No filter: the search is the filter, and `score` only ranks what it returned.
  const scored = page.rows
    .map((item) => ({ item, value: score(folded, item) }))
    .sort((a, b) => b.value - a.value || a.item.name.localeCompare(b.item.name));

  const best = scored[0];
  if (best === undefined) return { kind: 'none', phrase };

  const tied = scored.filter((entry) => entry.value === best.value);
  if (tied.length === 1) return { kind: 'one', item: best.item };

  return {
    kind: 'many',
    items: tied.slice(0, MAX_CHOICES).map((entry) => entry.item),
    total: tied.length,
  };
}
