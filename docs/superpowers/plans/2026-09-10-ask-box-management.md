# Ask Box Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ask box make the three things nothing can make today — a place, a category, an emergency contact — give Claude the three writes only the offline grammar has, and show the example phrases when the sheet opens.

**Architecture:** The ask box has two engines behind one sheet: a deterministic grammar in `src/voice/` executed by `src/services/voice/`, and an optional Claude tool loop in `src/services/ai/`. Every power added here lands on both, so the box behaves the same with or without an API key. Two type widenings come first because everything else depends on them: `Receipt` becomes a list of undo actions (a move into a place that had to be created writes twice and must come back in one press), and a `Destination` union lets a write name a place that does not exist yet.

**Tech Stack:** TypeScript (strict), React 19, Vitest, SQLite via wa-sqlite/OPFS, Capacitor for Android. No new dependency.

---

## Scope

**In:** `CREATE_LOCATION`, `CREATE_CATEGORY`, `CREATE_CONTACT` intents in `en`/`es`/`pt-BR`; the Claude tools `move_item`, `set_minimum`, `set_target`, `create_location`, `create_category`, `create_contact`; creating a place inline when a move or an item-creation names one that does not exist; grammar examples rendered when the sheet opens.

**Out, and deliberately:** renaming anything, changing an item's unit, category or notes, archiving, restoring, duplicating, deleting; autocomplete while typing; next-step buttons after an answer; unprompted suggestions; settings by voice. Nothing in this plan can remove a row except an undo taking back a row it just made.

## File structure

| File | Change | Responsible for |
|---|---|---|
| `src/voice/intents.ts` | modify | Three new intent interfaces, added to `Intent` and `WRITING_INTENTS` |
| `src/voice/numbers.ts` | modify | `spokenDigits` — a run of digit words to a literal string, never a quantity |
| `src/voice/grammar/en.ts` | modify | Three rules + new examples |
| `src/voice/grammar/es.ts` | modify | Three rules + new examples |
| `src/voice/grammar/pt-BR.ts` | modify | Three rules + new examples |
| `src/services/voice/execute.ts` | modify | `Destination`, three new `PendingWrite` variants, three new `AssumptionReason`s, the unknown-destination path |
| `src/services/voice/commit.ts` | modify | `UndoAction` list, `Wrote` union, writing and unwinding places/categories/contacts |
| `src/features/voice/useVoice.ts` | modify | `receiptIntent` for the new writes |
| `src/features/voice/ConfirmCard.tsx` | modify | Rendering the three new writes and three new assumptions |
| `src/features/voice/VoiceSheet.tsx` | modify | Example chips when the history is empty |
| `src/features/voice/Voice.module.css` | modify | Chip styles |
| `src/i18n/locales/{en,es,pt-BR}.ts` | modify | New strings |
| `src/services/ai/tools.ts` | modify | Six new tool definitions and their runners |

---

## Task 1: Widen the receipt to a list of undo actions

A move into a place that had to be created writes twice. `Receipt` holds one action and one `itemId`, so it cannot describe that, and `Committed.item` is typed `InventoryItem`, which a place is not. This task changes only shapes — no new behaviour, and every existing test must still pass.

**Files:**
- Modify: `src/services/voice/commit.ts`
- Modify: `src/features/voice/useVoice.ts`
- Test: `src/services/voice/commit.undo.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/voice/commit.undo.test.ts`:

```ts
it('unwinds a receipt newest action first', async () => {
  const order: string[] = [];
  const deps = {
    ...baseDeps,
    items: {
      ...baseDeps.items,
      transfer: async (id: string) => { order.push(`transfer:${id}`); return itemFixture; },
    },
    locations: {
      ...baseDeps.locations,
      remove: async (id: string) => { order.push(`removeLocation:${id}`); },
    },
  } as unknown as VoiceDeps;

  await undo(deps, {
    undo: [
      { kind: 'restoreLocation', itemId: 'item-1', to: null },
      { kind: 'deleteLocation', locationId: 'loc-new' },
    ],
  });

  expect(order).toEqual(['transfer:item-1', 'removeLocation:loc-new']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/voice/commit.undo.test.ts`

Expected: FAIL to compile — `Object literal may only specify known properties, and 'undo' does not exist in type 'Receipt'` (`Receipt` still requires `itemId`).

- [ ] **Step 3: Change the types**

In `src/services/voice/commit.ts`, replace the `UndoAction`, `Receipt` and `Committed` declarations. Keep every existing explanatory comment on the action variants — they record why each one stores a value rather than an inverse, and that reasoning is unchanged.

All four types live in `src/types/domain.ts` — the repository modules import them from there rather than exporting them.

```ts
import type { Category, Contact, InventoryItem, Location } from '../../types/domain';

export type UndoAction =
  | { readonly kind: 'restoreQuantity'; readonly itemId: string; readonly to: number }
  | { readonly kind: 'restoreExpiry'; readonly itemId: string; readonly to: string | null }
  | { readonly kind: 'restoreLocation'; readonly itemId: string; readonly to: string | null }
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

export interface Committed {
  readonly wrote: Wrote;
  readonly receipt: Receipt;
}
```

- [ ] **Step 4: Update every `return` in `commit`**

Each existing case wraps its result. `ADJUST` becomes:

```ts
      return {
        wrote: { kind: 'item', item },
        receipt: { undo: [{ kind: 'restoreQuantity', itemId: item.id, to: before }] },
      };
```

Apply the same shape to `EXPIRY` (`restoreExpiry`), `MOVE` (`restoreLocation`), `MINIMUM` (`restoreMinimum`), `TARGET` (`restoreTarget`) and `CREATE` (`deleteItem`, which now carries `itemId: item.id`).

- [ ] **Step 5: Split `undo` into a loop and a single-action switch**

```ts
export async function undo(deps: VoiceDeps, receipt: Receipt): Promise<void> {
  for (const action of receipt.undo) await undoOne(deps, action);
}

async function undoOne(deps: VoiceDeps, action: UndoAction): Promise<void> {
  switch (action.kind) {
    // ... every existing case, reading `action.itemId` where it read
    // `receipt.itemId`. The comments on each case stay as they are.

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

    case 'deleteCategory':
      try {
        await deps.categories.remove(action.categoryId);
      } catch {
        return;
      }
      return;

    case 'deleteContact':
      await deps.contacts.remove(action.contactId);
  }
}
```

- [ ] **Step 6: Follow the type through `useVoice`**

`src/features/voice/useVoice.ts:420` destructures `const { receipt } = await commit(deps, write)` — unchanged, `receipt` is still a field. No other line reads `.item` off the result. Run `npx tsc --noEmit` and fix whatever it names.

- [ ] **Step 7: Rewrite the existing undo tests to the new shape**

Every `{ itemId: 'x', undo: { kind: 'restoreQuantity', to: 2 } }` becomes `{ undo: [{ kind: 'restoreQuantity', itemId: 'x', to: 2 }] }`. The assertions themselves do not change.

- [ ] **Step 8: Run the whole suite**

Run: `npx vitest run && npx tsc --noEmit`

Expected: PASS. This task added one behaviour — ordered unwinding — and changed no other.

- [ ] **Step 9: Commit**

```bash
git add src/services/voice/commit.ts src/services/voice/commit.undo.test.ts src/features/voice/useVoice.ts
git commit -m "Let one sentence's undo take back more than one write"
```

---

## Task 2: Let a write name a place that does not exist yet

`PendingWrite.MOVE` carries `toLocationId: string`, which cannot say "the cellar, which I will have to make". A union says it in the type rather than in a flag.

**Files:**
- Modify: `src/services/voice/execute.ts`
- Modify: `src/services/voice/commit.ts`
- Test: `src/services/voice/execute.writes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('proposes making the place when the destination is not found', async () => {
  const outcome = await execute(depsWithNoCellar, {
    kind: 'MOVE_ITEM', item: 'rice', location: 'cellar',
  });

  expect(outcome).toMatchObject({
    kind: 'pending',
    write: {
      kind: 'MOVE',
      to: { kind: 'new', name: 'cellar' },
      certainty: 'assumed',
      assumptions: ['newLocation'],
    },
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/voice/execute.writes.test.ts -t "proposes making the place"`

Expected: FAIL — the outcome is `{ kind: 'notFound' }`, from `execute.ts:591`.

- [ ] **Step 3: Add the `Destination` union and the new assumption reasons**

In `src/services/voice/execute.ts`, beside `AssumptionReason`:

```ts
/**
 * Where a write is sending something.
 *
 * `new` is not an error state. `findLocation` matches on contains and returns
 * nothing for a place that was never made, and until now that ended the
 * sentence. It carries the phrase as spoken, and the card says the place will
 * be made before anything is written.
 */
export type Destination =
  | { readonly kind: 'existing'; readonly id: string; readonly name: string }
  | { readonly kind: 'new'; readonly name: string };
```

Add three members to `AssumptionReason`, each with the comment style the existing ones use:

```ts
  /** No place is called this. Confirming makes it. */
  | 'newLocation'
  /** No category is called this. Confirming makes it. */
  | 'newCategory'
  /**
   * A phone number that was heard rather than typed.
   *
   * The only slot in this application where a recognizer's mistake is
   * invisible: a wrong item name reads as the wrong item, and a wrong digit
   * reads as a number. So it is always shown back before it is stored.
   */
  | 'heardDigits'
```

- [ ] **Step 4: Change the `MOVE` and `CREATE` variants**

```ts
  | (Certainty & {
      readonly kind: 'MOVE';
      readonly item: InventoryItemView;
      readonly fromLocationId: string | null;
      readonly fromLocationName: string | null;
      readonly to: Destination;
    })
```

and on `CREATE`, replace `locationId` and `locationName` with `readonly location: Destination | null;`.

- [ ] **Step 5: Change the `MOVE_ITEM` case in `execute`**

Replace the early return at `execute.ts:590-592`:

```ts
      const destination = await findLocation(deps, intent.location);
      const assumptions: AssumptionReason[] = [];
      if (!found.exact) assumptions.push('item');

      if (destination === undefined) {
        return {
          kind: 'pending',
          write: {
            kind: 'MOVE',
            item: found.item,
            fromLocationId: found.item.locationId,
            fromLocationName: found.item.locationName,
            to: { kind: 'new', name: intent.location },
            ...certaintyOf([...assumptions, 'newLocation']),
          },
        };
      }

      if (found.item.locationId === destination.id) {
        return { kind: 'answer', answer: { kind: 'WHERE_ITEM', item: found.item } };
      }

      if (foldText(destination.name) !== foldText(intent.location)) assumptions.push('location');

      return {
        kind: 'pending',
        write: {
          kind: 'MOVE',
          item: found.item,
          fromLocationId: found.item.locationId,
          fromLocationName: found.item.locationName,
          to: { kind: 'existing', id: destination.id, name: destination.name },
          ...certaintyOf(assumptions),
        },
      };
```

Do the same in the `CREATE_ITEM` case: an unresolved `intent.location` becomes `{ kind: 'new', name: intent.location }` with `newLocation` pushed, rather than being dropped.

- [ ] **Step 6: Make `commit` write the place first**

In the `MOVE` case:

```ts
    case 'MOVE': {
      const current = await deps.items.getById(write.item.id);
      const before = current === undefined ? write.fromLocationId : current.locationId;

      /*
       * The place first, then the move, and the undo list in the reverse
       * order - put the rice back, then take the empty place away.
       */
      const madeLocation =
        write.to.kind === 'new' ? await deps.locations.create({ name: write.to.name }) : null;
      const toId = madeLocation?.id ?? (write.to.kind === 'existing' ? write.to.id : '');

      const item = await deps.items.transfer(write.item.id, toId, SPOKEN);

      return {
        wrote: { kind: 'item', item },
        receipt: {
          undo: [
            { kind: 'restoreLocation', itemId: item.id, to: before },
            ...(madeLocation === null
              ? []
              : [{ kind: 'deleteLocation' as const, locationId: madeLocation.id }]),
          ],
        },
      };
    }
```

Apply the same `madeLocation` handling to the `CREATE` case, where `write.location` may be `{ kind: 'new' }`.

- [ ] **Step 7: Run the test**

Run: `npx vitest run src/services/voice/execute.writes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/voice/execute.ts src/services/voice/commit.ts src/services/voice/execute.writes.test.ts
git commit -m "Offer to make the place a move is sending something to"
```

---

## Task 3: `CREATE_LOCATION` — the intent and the English rule

**Files:**
- Modify: `src/voice/intents.ts`
- Modify: `src/voice/grammar/en.ts`
- Test: `src/voice/grammar/en.phrases.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('reads "new place, cellar" as a place to create', () => {
  expect(parse(enGrammar, 'new place, cellar', { today: '2026-09-10' })).toEqual({
    kind: 'CREATE_LOCATION', name: 'cellar',
  });
});

it('drops the article from "add a place called the cellar"', () => {
  expect(parse(enGrammar, 'add a place called the cellar', { today: '2026-09-10' })).toEqual({
    kind: 'CREATE_LOCATION', name: 'cellar',
  });
});

it('still reads "place the rice in the cellar" as a move', () => {
  expect(parse(enGrammar, 'place the rice in the cellar', { today: '2026-09-10' }))
    .toMatchObject({ kind: 'MOVE_ITEM' });
});
```

The third test is the one that matters: `place` is in `MOVE_VERBS`, and this rule must not steal it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/voice/grammar/en.phrases.test.ts -t "place"`

Expected: FAIL to compile — `Type '"CREATE_LOCATION"' is not comparable to type 'IntentKind'`.

- [ ] **Step 3: Add the intent**

In `src/voice/intents.ts`:

```ts
/**
 * "new place, cellar".
 *
 * A name and nothing else. `CreateLocationInput` takes a description, a parent
 * and a sort order too, and none of them belong in a sentence: a place said
 * out loud is a name, and the Locations screen is where a hierarchy is built.
 */
export interface CreateLocation {
  readonly kind: 'CREATE_LOCATION';
  readonly name: string;
}
```

Add `CreateLocation` to the `Intent` union and `'CREATE_LOCATION'` to `WRITING_INTENTS`. Do **not** add it to `CREATABLE_INTENTS` — that list answers "the item was not found, offer to make it", which is a different question.

- [ ] **Step 4: Add the rule to `en.ts`, immediately before `CREATE_ITEM`**

```ts
  {
    /*
     * Before CREATE_ITEM, whose noun list ends in "thing" and would otherwise
     * read "new place cellar" as an item called "place cellar". Safe beside
     * MOVE_ITEM, which owns "place" as a VERB: a move starts with the verb
     * and this needs the noun after a creating one, so "place the rice in the
     * cellar" never reaches here.
     */
    name: 'CREATE_LOCATION',
    pattern:
      /^(?:create|add|new|make)\s+(?:an?\s+)?(?:new\s+)?(?:place|location|spot|area|room)\s*(?:called\s+|named\s+)?:?\s*(.+)$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_LOCATION', name };
    },
  },
```

with, near the other helpers in the file:

```ts
/** "the cellar" is a cellar. An article a speaker used is not part of the name. */
function stripLeadingArticle(name: string): string {
  return name.replace(/^(?:the|a|an)\s+/, '').trim();
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/voice/grammar/en.phrases.test.ts`

Expected: PASS, all three.

- [ ] **Step 6: Commit**

```bash
git add src/voice/intents.ts src/voice/grammar/en.ts src/voice/grammar/en.phrases.test.ts
git commit -m "Read a spoken place to create, in English"
```

---

## Task 4: `CREATE_LOCATION` in Spanish and Portuguese

**Files:**
- Modify: `src/voice/grammar/es.ts`, `src/voice/grammar/pt-BR.ts`
- Test: `src/voice/grammar/es.phrases.test.ts`, `src/voice/grammar/pt-BR.phrases.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// es.phrases.test.ts
it('reads "nuevo lugar, sotano" as a place to create', () => {
  expect(parse(esGrammar, 'nuevo lugar, sótano', { today: '2026-09-10' })).toEqual({
    kind: 'CREATE_LOCATION', name: 'sotano',
  });
});

// pt-BR.phrases.test.ts
it('reads "novo lugar, porao" as a place to create', () => {
  expect(parse(ptBRGrammar, 'novo lugar, porão', { today: '2026-09-10' })).toEqual({
    kind: 'CREATE_LOCATION', name: 'porao',
  });
});
```

Note the expectation is folded — `parse` folds before matching, so the captured name arrives unaccented. That is what every other intent in this grammar already does with a captured phrase.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/voice/grammar/es.phrases.test.ts src/voice/grammar/pt-BR.phrases.test.ts -t "place to create"`

Expected: FAIL — both return `{ kind: 'UNKNOWN' }`.

- [ ] **Step 3: Add the Spanish rule, before `CREATE_ITEM` in `es.ts`**

Patterns match folded text, so write them unaccented: `añadir` is `anadir`, `ubicación` is `ubicacion`.

```ts
  {
    name: 'CREATE_LOCATION',
    pattern:
      /^(?:crear|crea|agregar|agrega|anadir|anade|nuevo|nueva)\s+(?:un\s+|una\s+)?(?:nuevo\s+|nueva\s+)?(?:lugar|sitio|ubicacion|zona|habitacion)\s*(?:llamado\s+|llamada\s+)?:?\s*(.+)$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_LOCATION', name };
    },
  },
```

with `stripLeadingArticle` in `es.ts` stripping `el|la|los|las|un|una`.

- [ ] **Step 4: Add the Portuguese rule, before `CREATE_ITEM` in `pt-BR.ts`**

```ts
  {
    name: 'CREATE_LOCATION',
    pattern:
      /^(?:criar|cria|adicionar|adiciona|novo|nova)\s+(?:um\s+|uma\s+)?(?:novo\s+|nova\s+)?(?:lugar|local|area|comodo|prateleira)\s*(?:chamado\s+|chamada\s+)?:?\s*(.+)$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_LOCATION', name };
    },
  },
```

with `stripLeadingArticle` in `pt-BR.ts` stripping `o|a|os|as|um|uma`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/voice/grammar/`

Expected: PASS, including `registry.test.ts`, which checks every grammar carries the same shape.

- [ ] **Step 6: Commit**

```bash
git add src/voice/grammar/
git commit -m "Read a spoken place to create, in Spanish and Portuguese"
```

---

## Task 5: Execute and commit a created place

**Files:**
- Modify: `src/services/voice/execute.ts`, `src/services/voice/commit.ts`
- Test: `src/services/voice/execute.writes.test.ts`, `src/services/voice/commit.undo.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// execute.writes.test.ts
it('refuses a place whose name is already taken', async () => {
  const outcome = await execute(depsWithCellar, { kind: 'CREATE_LOCATION', name: 'cellar' });
  expect(outcome).toMatchObject({ kind: 'answer', answer: { kind: 'WHERE_LOCATION' } });
});

it('proposes a place that does not exist yet', async () => {
  const outcome = await execute(depsWithNoCellar, { kind: 'CREATE_LOCATION', name: 'cellar' });
  expect(outcome).toMatchObject({
    kind: 'pending',
    write: { kind: 'NEW_LOCATION', name: 'cellar', certainty: 'assumed' },
  });
});

// commit.undo.test.ts
it('takes back a place it made', async () => {
  const { wrote, receipt } = await commit(deps, {
    kind: 'NEW_LOCATION', name: 'cellar', certainty: 'assumed', assumptions: ['newLocation'],
  });
  expect(wrote).toMatchObject({ kind: 'location' });
  expect(receipt.undo).toEqual([{ kind: 'deleteLocation', locationId: expect.any(String) }]);
});
```

Saying an existing place back rather than making a second one is the point of the first test: two places called "cellar" is worse than being told there is one.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/services/voice/`

Expected: FAIL — `'CREATE_LOCATION' is not handled` in `execute`'s exhaustive switch.

- [ ] **Step 3: Add the `PendingWrite` variant**

```ts
  | (Certainty & {
      readonly kind: 'NEW_LOCATION';
      readonly name: string;
    })
```

- [ ] **Step 4: Add the `execute` case**

```ts
    case 'CREATE_LOCATION': {
      /*
       * An existing place is answered, not duplicated. `findLocation` matches
       * on contains, so "cellar" finds "Back cellar" - and a second place with
       * a name the user cannot tell apart from the first is a worse outcome
       * than being shown what is already there.
       */
      const existing = await findLocation(deps, intent.name);
      if (existing !== undefined) {
        const items = await itemsIn(deps, existing.id);
        return {
          kind: 'answer',
          answer: { kind: 'WHERE_LOCATION', locationName: existing.name, items },
        };
      }

      return {
        kind: 'pending',
        write: { kind: 'NEW_LOCATION', name: intent.name, ...certaintyOf(['newLocation']) },
      };
    }
```

Reuse whatever helper the existing `QUERY_WHERE` case already uses to list a place's items; do not write a second one.

- [ ] **Step 5: Add the `commit` case**

```ts
    case 'NEW_LOCATION': {
      const location = await deps.locations.create({ name: write.name });
      return {
        wrote: { kind: 'location', location },
        receipt: { undo: [{ kind: 'deleteLocation', locationId: location.id }] },
      };
    }
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/services/voice/ && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/voice/
git commit -m "Make a place the ask box was told to make"
```

---

## Task 6: `CREATE_CATEGORY`, end to end

Same shape as Tasks 3–5, with one difference worth knowing: a category's names live in a per-language record, so a spoken name is stored under the interface language only.

**Files:**
- Modify: `src/voice/intents.ts`, `src/voice/grammar/{en,es,pt-BR}.ts`, `src/services/voice/execute.ts`, `src/services/voice/commit.ts`
- Test: `src/voice/grammar/*.phrases.test.ts`, `src/services/voice/execute.writes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('reads "new category, tools" as a category to create', () => {
  expect(parse(enGrammar, 'new category, tools', { today: '2026-09-10' })).toEqual({
    kind: 'CREATE_CATEGORY', name: 'tools',
  });
});
```

and the Spanish (`nueva categoria, herramientas`) and Portuguese (`nova categoria, ferramentas`) equivalents, plus:

```ts
it('names a created category in the interface language only', async () => {
  const { wrote } = await commit({ ...deps, language: 'es' }, {
    kind: 'NEW_CATEGORY', name: 'herramientas', certainty: 'assumed', assumptions: ['newCategory'],
  });
  expect(wrote).toMatchObject({ kind: 'category', category: { names: { es: 'herramientas' } } });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/voice/grammar/ src/services/voice/`

Expected: FAIL — `CREATE_CATEGORY` is not an `IntentKind`.

- [ ] **Step 3: Add the intent**

```ts
/** "new category, tools". */
export interface CreateCategory {
  readonly kind: 'CREATE_CATEGORY';
  readonly name: string;
}
```

Into the `Intent` union and `WRITING_INTENTS`.

- [ ] **Step 4: Add the three rules**

Place each one beside its file's `CREATE_LOCATION` rule.

- `en.ts`: `/^(?:create|add|new|make)\s+(?:an?\s+)?(?:new\s+)?(?:category|group)\s*(?:called\s+|named\s+)?:?\s*(.+)$/`
- `es.ts`: `/^(?:crear|crea|agregar|agrega|anadir|anade|nuevo|nueva)\s+(?:un\s+|una\s+)?(?:nuevo\s+|nueva\s+)?(?:categoria|grupo)\s*(?:llamado\s+|llamada\s+)?:?\s*(.+)$/`
- `pt-BR.ts`: `/^(?:criar|cria|adicionar|adiciona|novo|nova)\s+(?:um\s+|uma\s+)?(?:novo\s+|nova\s+)?(?:categoria|grupo)\s*(?:chamado\s+|chamada\s+)?:?\s*(.+)$/`

Each `build` mirrors `CREATE_LOCATION`'s, returning `{ kind: 'CREATE_CATEGORY', name }`.

- [ ] **Step 5: Add the `PendingWrite` variant and the `execute` case**

```ts
  | (Certainty & { readonly kind: 'NEW_CATEGORY'; readonly name: string })
```

The case mirrors `CREATE_LOCATION`'s: an existing category found by `findCategory` is answered with `{ kind: 'CATEGORY', ... }` rather than duplicated; otherwise a pending `NEW_CATEGORY` with `certaintyOf(['newCategory'])`.

- [ ] **Step 6: Add the `commit` case**

```ts
    case 'NEW_CATEGORY': {
      /*
       * One language, the one the interface is in. `CreateCategoryInput.names`
       * is a record because the built-in categories are named in all three,
       * and a name somebody said aloud is a fact about one of them. The
       * Categories screen is where the other two get filled in.
       */
      const category = await deps.categories.create({ names: { [deps.language]: write.name } });
      return {
        wrote: { kind: 'category', category },
        receipt: { undo: [{ kind: 'deleteCategory', categoryId: category.id }] },
      };
    }
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/voice/ src/services/voice/
git commit -m "Make a category the ask box was told to make"
```

---

## Task 7: `CREATE_CONTACT`, and reading digits as digits

The one place a recognizer's mistake is invisible. A wrong item name reads as the wrong item; a wrong digit reads as a number.

**Files:**
- Modify: `src/voice/numbers.ts`, `src/voice/intents.ts`, `src/voice/grammar/{en,es,pt-BR}.ts`, `src/services/voice/execute.ts`, `src/services/voice/commit.ts`
- Test: `src/voice/numbers.test.ts`, `src/voice/grammar/*.phrases.test.ts`

- [ ] **Step 1: Write the failing test for `spokenDigits`**

```ts
// src/voice/numbers.test.ts
describe('spokenDigits', () => {
  it('joins digit words without adding them up', () => {
    expect(spokenDigits('five five five one two three four', EN_NUMBERS)).toBe('5551234');
  });

  it('keeps digits that arrived as digits', () => {
    expect(spokenDigits('555 1234', EN_NUMBERS)).toBe('5551234');
  });

  it('returns null when a word is not a digit', () => {
    expect(spokenDigits('five hundred', EN_NUMBERS)).toBeNull();
  });
});
```

The third case is the guard: "five hundred" is a quantity, not a phone number, and reading it as `5100` would invent a number nobody said.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/voice/numbers.test.ts`

Expected: FAIL — `spokenDigits` is not exported.

- [ ] **Step 3: Write `spokenDigits`**

```ts
/**
 * A run of digit words to the string of digits it names.
 *
 * NOT `parseNumber`, and that is the whole point. "five five five" is 555 to a
 * reader and 15 to anything that adds; a phone number is a string that happens
 * to be written in digits, and the moment it goes through arithmetic it stops
 * being the number somebody said.
 *
 * Returns null on any word that is not a single digit, which is what keeps
 * "five hundred" out: it is a quantity, and a phone number it is not.
 */
export function spokenDigits(text: string, numbers: NumberWords): string | null {
  const words = text.trim().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return null;

  let out = '';
  for (const word of words) {
    if (/^\d+$/.test(word)) { out += word; continue; }
    const digit = numbers.units[word];
    if (digit === undefined || digit > 9) return null;
    out += String(digit);
  }
  return out === '' ? null : out;
}
```

Check the real field name on `NumberWords` in `src/voice/numbers.ts` before writing `numbers.units` — use whichever map holds the nought-to-nine words.

- [ ] **Step 4: Add the intent**

```ts
/**
 * "add contact my doctor Ana phone 555 1234".
 *
 * Three slots of the six a contact has. Email and place are typed on the
 * Contacts screen: neither survives being spoken - an address heard aloud is a
 * guess at spelling, and a place is a free-text field this grammar has no way
 * to tell from a name.
 */
export interface CreateContact {
  readonly kind: 'CREATE_CONTACT';
  readonly name: string;
  readonly relationship: string | null;
  /** Digits as a string, never a quantity. See `spokenDigits`. */
  readonly phone: string | null;
}
```

Into the `Intent` union and `WRITING_INTENTS`.

- [ ] **Step 5: Write the failing grammar tests**

```ts
it('reads a contact with a relationship and a spoken number', () => {
  expect(parse(enGrammar, 'add contact my doctor Ana phone five five five one two three four', ctx))
    .toEqual({ kind: 'CREATE_CONTACT', name: 'ana', relationship: 'doctor', phone: '5551234' });
});

it('reads a contact that is only a name', () => {
  expect(parse(enGrammar, 'add contact Ana', ctx))
    .toEqual({ kind: 'CREATE_CONTACT', name: 'ana', relationship: null, phone: null });
});
```

- [ ] **Step 6: Add the three rules**

`en.ts`:

```ts
  {
    name: 'CREATE_CONTACT',
    pattern:
      /^(?:create|add|new|save)\s+(?:an?\s+)?(?:new\s+)?contact\s+(?:my\s+([a-z]+)\s+)?(.+?)(?:\s+(?:phone|number|tel|telephone)\s+(.+))?$/,
    build: (match, tools): Intent | null => {
      const name = (match[2] ?? '').trim();
      if (name === '') return null;

      const spoken = match[3];
      // A phone slot that was said but could not be read as digits fails the
      // whole rule rather than storing the contact without it. Somebody who
      // said a number expects the number.
      const phone = spoken === undefined ? null : spokenDigits(spoken, tools.numbers);
      if (spoken !== undefined && phone === null) return null;

      return { kind: 'CREATE_CONTACT', name, relationship: match[1] ?? null, phone };
    },
  },
```

`es.ts` uses `contacto`, `mi`, and `telefono|numero`; `pt-BR.ts` uses `contato`, `meu|minha`, and `telefone|numero|fone`.

- [ ] **Step 7: Add the `PendingWrite` variant, the `execute` case and the `commit` case**

```ts
  | (Certainty & {
      readonly kind: 'NEW_CONTACT';
      readonly name: string;
      readonly relationship: string | null;
      readonly phone: string | null;
      /*
       * Two fields the grammar always leaves null and Claude may fill.
       *
       * They are declared here rather than added in Task 11 so the variant is
       * settled once. An address heard aloud is a guess at spelling and a
       * place is free text this grammar cannot tell from a name, so no spoken
       * rule sets either - but a typed sentence through Claude can, and a
       * write type that changed shape halfway through the feature would make
       * every reader check which half they were in.
       */
      readonly email: string | null;
      readonly location: string | null;
    })
```

Read `certaintyOf` before writing the `execute` case. If it derives `explicit` from an empty assumption list, a contact with no phone would be stored without asking — and nothing reads a contact's name back to catch a mishearing. Give `NEW_CONTACT` an explicit `certainty: 'assumed'` rather than letting the empty list decide, and add `'heardDigits'` to the assumptions whenever `phone !== null`.

```ts
    case 'NEW_CONTACT': {
      const contact = await deps.contacts.create({
        name: write.name,
        relationship: write.relationship,
        phone: write.phone,
        email: write.email,
        location: write.location,
      });
      return {
        wrote: { kind: 'contact', contact },
        receipt: { undo: [{ kind: 'deleteContact', contactId: contact.id }] },
      };
    }
```

- [ ] **Step 8: Correct the comment that stops being true**

`src/services/voice/execute.ts` says of `VoiceDeps.contacts`: *"The emergency contacts, read and never written… QUERY_CONTACT has no write path at all, here or in `commit.ts`."* Replace it with what is now true — that contacts are created here and never edited or deleted, and that the Contacts screen owns the rest.

- [ ] **Step 9: Run everything**

Run: `npx vitest run && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/voice/ src/services/voice/
git commit -m "Add an emergency contact by voice, and read its number back"
```

---

## Task 8: Show the three new writes on the confirmation card

Nothing is stored until this card is pressed, so a write it cannot render is a write nobody can make.

**Files:**
- Modify: `src/features/voice/ConfirmCard.tsx`
- Modify: `src/i18n/locales/{en,es,pt-BR}.ts`
- Test: `src/features/voice/VoiceSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it('shows a place it is about to make, and makes nothing until it is confirmed', async () => {
  const { user, locations } = renderSheetWith({ locations: [] });
  await user.type(screen.getByLabelText(/type/i), 'new place, cellar');
  await user.click(screen.getByRole('button', { name: /send/i }));

  expect(await screen.findByText(/cellar/)).toBeInTheDocument();
  expect(locations.created).toHaveLength(0);

  await user.click(screen.getByRole('button', { name: /confirm/i }));
  expect(locations.created).toHaveLength(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/voice/VoiceSheet.test.tsx`

Expected: FAIL — the card renders nothing for `NEW_LOCATION`.

- [ ] **Step 3: Add the strings**

To `src/i18n/locales/en.ts`, inside `voice:`:

```ts
    newLocation: 'New place: {name}',
    newCategory: 'New category: {name}',
    newContact: 'New contact: {name}',
    contactRelationship: 'Relationship',
    contactPhone: 'Phone',
    assumedNewLocation: 'No place is called {location}. Confirming makes it.',
    assumedNewCategory: 'No category is called {category}. Confirming makes it.',
    assumedHeardDigits: 'The number was heard, not typed. Check it before confirming.',
```

Spanish and Portuguese equivalents go in the matching files. `en.ts` defines `TranslationKey`, so a missing key in either fails the build rather than rendering blank — that is the check, and it needs no test of its own.

- [ ] **Step 4: Render the three writes**

In `ConfirmCard.tsx`'s `switch`, beside `case 'CREATE'`:

```ts
    case 'NEW_LOCATION':
      return t('voice.newLocation', { name: write.name });
    case 'NEW_CATEGORY':
      return t('voice.newCategory', { name: write.name });
    case 'NEW_CONTACT':
      return t('voice.newContact', { name: write.name });
```

and in `assumed`, three more reasons:

```ts
      case 'newLocation':
        return t('voice.assumedNewLocation', { location: place });
      case 'newCategory':
        return t('voice.assumedNewCategory', { category: name });
      case 'heardDigits':
        return t('voice.assumedHeardDigits');
```

For `NEW_CONTACT`, show the relationship and the phone under the name, using `voice.contactRelationship` and `voice.contactPhone`. The `heardDigits` warning tells the reader to check a number, and a warning to check something the card does not show is not one.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/features/voice/`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/voice/ src/i18n/
git commit -m "Show what is about to be made before it is made"
```

---

## Task 9: Say what was made

`receiptIntent` reads a fact back out of the database so the sentence the user hears describes what is stored. It currently assumes every write was about an item.

**Files:**
- Modify: `src/features/voice/useVoice.ts:243-257`
- Test: `src/features/voice/VoiceSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it('reads a new contact back, number included', async () => {
  const { user } = renderSheetWith({ contacts: [] });
  await user.type(screen.getByLabelText(/type/i), 'add contact my doctor Ana phone 555 1234');
  await user.click(screen.getByRole('button', { name: /send/i }));
  await user.click(screen.getByRole('button', { name: /confirm/i }));

  expect(await screen.findByText(/5551234/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/voice/VoiceSheet.test.tsx -t "reads a new contact back"`

Expected: FAIL — `receiptIntent` returns `QUERY_QUANTITY` for an item named "Ana", which finds nothing.

- [ ] **Step 3: Extend `receiptIntent`**

The three creates each have an existing query intent that reads exactly the row just written, so no new `Answer` variant is needed:

```ts
function receiptIntent(write: PendingWrite): Intent {
  switch (write.kind) {
    case 'EXPIRY':
      return { kind: 'QUERY_EXPIRY_OF', item: write.item.name };
    // A move changed where the thing is, so the sentence that confirms it has
    // to be about where the thing is.
    case 'MOVE':
      return { kind: 'QUERY_WHERE', item: write.item.name, location: null };
    /*
     * Each of these reads back the row that was just made, using a question
     * the user could have asked themselves. The contact one matters most: it
     * says the phone number out loud, which is the only check there is on a
     * number that was heard rather than typed.
     */
    case 'NEW_LOCATION':
      return { kind: 'QUERY_WHERE', item: null, location: write.name };
    case 'NEW_CATEGORY':
      return { kind: 'QUERY_CATEGORY', category: write.name };
    case 'NEW_CONTACT':
      return { kind: 'QUERY_CONTACT', query: write.name };
    case 'CREATE':
      return { kind: 'QUERY_QUANTITY', item: write.name };
    default:
      return { kind: 'QUERY_QUANTITY', item: write.item.name };
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/voice/ && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/voice/useVoice.ts src/features/voice/VoiceSheet.test.tsx
git commit -m "Say back what was made, reading the number aloud"
```

---

## Task 10: Give Claude the three writes it never had

`move_item`, `set_minimum` and `set_target` work offline and do not work through Claude. This closes that rather than widening it.

**Files:**
- Modify: `src/services/ai/tools.ts`
- Test: `src/services/ai/tools.writes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('proposes a move without writing it', async () => {
  const run = await runTool(deps, 'move_item', { item: 'rice', location: 'cellar' });
  expect(run).toMatchObject({ proposal: { kind: 'MOVE' } });
  expect(deps.items.transferred).toHaveLength(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/ai/tools.writes.test.ts`

Expected: FAIL — `runTool` returns an unknown-tool result for `move_item`.

- [ ] **Step 3: Add the three definitions**

Follow the wording of the four writes already there — every description opens with `PROPOSE` and says `THIS DOES NOT CHANGE ANYTHING`, because that sentence is what keeps the model from believing it has written something.

```ts
  {
    name: 'move_item',
    description:
      'PROPOSE moving an item to a place. THIS DOES NOT CHANGE ANYTHING - it only proposes. ' +
      'The place must come from list_locations; if none matches, propose create_location or ' +
      'say so, rather than choosing the nearest one.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        location: { type: 'string', description: 'A place from list_locations.' },
      },
      required: ['item', 'location'],
    },
  },
  {
    name: 'set_minimum',
    description:
      'PROPOSE the level below which the replenishment list speaks up about an item. THIS DOES ' +
      'NOT CHANGE ANYTHING - it only proposes. The number must be one the user stated.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        minimum: { type: 'number', description: 'The level the user stated. Never one they did not.' },
      },
      required: ['item', 'minimum'],
    },
  },
  {
    name: 'set_target',
    description:
      'PROPOSE the level the user is stocking towards. THIS DOES NOT CHANGE ANYTHING - it only ' +
      'proposes. The number must be one the user stated.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The item as the user said it.' },
        target: { type: 'number', description: 'The level the user stated. Never one they did not.' },
      },
      required: ['item', 'target'],
    },
  },
```

- [ ] **Step 4: Add the runners**

Each resolves the item the way `adjust_quantity` already does and returns the matching `PendingWrite` as a proposal. Every proposal is `assumed` and carries `'assistant'` — the file explains at length why a model's choice is never `explicit`, and that rule holds for these three unchanged. `move_item` builds a `Destination`: `{ kind: 'existing', … }` when `findLocation` matches, `{ kind: 'new', name }` otherwise, with `'newLocation'` added to the assumptions.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/services/ai/`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/ai/
git commit -m "Let Claude propose a move, a minimum and a target"
```

---

## Task 11: Let Claude make a place, a category and a contact

**Files:**
- Modify: `src/services/ai/tools.ts`
- Test: `src/services/ai/tools.writes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('proposes a place without writing it', async () => {
  const run = await runTool(deps, 'create_location', { name: 'cellar' });
  expect(run).toMatchObject({ proposal: { kind: 'NEW_LOCATION', name: 'cellar' } });
  expect(deps.locations.created).toHaveLength(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/ai/tools.writes.test.ts -t "proposes a place"`

Expected: FAIL — unknown tool.

- [ ] **Step 3: Add the three definitions**

```ts
  {
    name: 'create_location',
    description:
      'PROPOSE a new place to keep things. THIS DOES NOT CHANGE ANYTHING - it only proposes. ' +
      'Call list_locations first: if a place with this name already exists, say so instead of ' +
      'proposing a second one.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'create_category',
    description:
      'PROPOSE a new category. THIS DOES NOT CHANGE ANYTHING - it only proposes. Call ' +
      'list_categories first. The name is stored in the language the interface is set to.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'create_contact',
    description:
      'PROPOSE a new emergency contact. THIS DOES NOT CHANGE ANYTHING - it only proposes. Only ' +
      'the name is required. Never invent a phone number, and never reformat one the user gave.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        relationship: { type: 'string', description: 'Doctor, neighbour, and so on.' },
        phone: { type: 'string', description: 'Exactly as the user gave it.' },
        email: { type: 'string' },
        location: { type: 'string', description: 'Free text: where this person is.' },
      },
      required: ['name'],
    },
  },
```

Claude gets `email` and `location` where the grammar does not: a typed sentence can spell an address, and a spoken one cannot.

- [ ] **Step 4: Add the runners and their zod input schemas**

Follow `itemNameInput`'s pattern at `tools.ts:429`. Each returns the matching `PendingWrite` as a proposal, `assumed`, carrying `'assistant'`. `NEW_CONTACT` already carries `email` and `location` from Task 7 — this is the only path that ever fills them.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/ai/
git commit -m "Let Claude propose a place, a category and a contact"
```

---

## Task 12: Show the examples when the sheet opens

Nine phrases per language already exist on `Grammar.examples` and are already translated. Nothing renders them until you fail or ask.

**Files:**
- Modify: `src/features/voice/VoiceSheet.tsx`, `src/features/voice/Voice.module.css`
- Modify: `src/voice/grammar/{en,es,pt-BR}.ts`
- Test: `src/features/voice/VoiceSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it('offers examples before anything has been asked, and fills the box with one', async () => {
  const { user } = renderSheet();
  const example = screen.getByRole('button', { name: /how much rice/i });

  await user.click(example);
  expect(screen.getByLabelText(/type/i)).toHaveValue('how much rice do i have?');
});

it('drops the examples once there is a history', async () => {
  const { user } = renderSheet();
  await user.type(screen.getByLabelText(/type/i), 'how many items do i have?');
  await user.click(screen.getByRole('button', { name: /send/i }));

  expect(screen.queryByRole('button', { name: /how much rice/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/features/voice/VoiceSheet.test.tsx -t "examples"`

Expected: FAIL — no such buttons.

- [ ] **Step 3: Add the new phrases to each grammar's `examples`**

Three per language, matching what the grammar now understands. English:

```ts
    'new place, cellar',
    'new category, tools',
    'add contact my doctor Ana phone 555 1234',
```

Spanish: `'nuevo lugar, sótano'`, `'nueva categoría, herramientas'`, `'agregar contacto mi médico Ana teléfono 555 1234'`.

Portuguese: `'novo lugar, porão'`, `'nova categoria, ferramentas'`, `'adicionar contato meu médico Ana telefone 555 1234'`.

Write the examples accented, as the existing Portuguese ones are — they are shown to a reader, and `parse` folds them on the way in.

- [ ] **Step 4: Render them in `VoiceSheet`**

Above the `<ol className={styles.history}>`, and only when there is no history:

```tsx
      {/*
        Shown before anything has been asked, and never again. The whole
        difficulty with a box you can say anything into is knowing what to say,
        and the answer was already written - `Grammar.examples`, in the user's
        own language. It was reachable only by asking for help or getting
        something wrong, which is the wrong order.
      */}
      {voice.history.length === 0 && (
        <div className={styles.examples}>
          <p className={styles.examplesTitle}>{t('voice.examplesTitle')}</p>
          <ul className={styles.chips}>
            {voice.examples.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => {
                    setTyped(example);
                    formRef.current?.querySelector('input')?.focus();
                  }}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
```

`voice.examples` is already on the hook's return — `useVoice.ts:753`. Filling the box rather than sending it is deliberate: a first-time reader gets to see the shape of a sentence and change the noun before pressing anything.

- [ ] **Step 5: Style the chips**

In `Voice.module.css`, using the existing tokens — `--surface-sunken`, `--border-subtle`, `--radius-full`, `--text-sm` — and honouring `--tap-target` so a chip is pressable with a thumb.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/voice/`

Expected: PASS, both.

- [ ] **Step 7: Commit**

```bash
git add src/features/voice/ src/voice/grammar/
git commit -m "Show what can be said, before it has to be guessed"
```

---

## Task 13: Documentation

The project's "not built" lists are trustworthy by design. Three of them stop being accurate in this branch.

**Files:**
- Modify: `docs/VOICE.md`, `README.md`, `docs/CHANGELOG.md`

- [ ] **Step 1: Update `docs/VOICE.md`**

Add the three new intents to the list of what the grammar understands, in all three languages. Add the six new tools to the AI section. State plainly that a move to a place that does not exist offers to make it, and that a spoken phone number is read back aloud.

- [ ] **Step 2: Update `README.md`**

The **What it does** section describes the ask box. Say that it now makes places, categories and contacts, and that nothing it makes is written before the card is confirmed.

- [ ] **Step 3: Update `docs/CHANGELOG.md`**

A new version heading, and — this is the part that matters — correct any "not built" line this branch falsifies.

- [ ] **Step 4: Commit**

```bash
git add docs/ README.md
git commit -m "Say in the documentation what the ask box can now be told to make"
```

---

## Task 14: Full verification

The standard this project already holds itself to. Claims cite these, not assertions.

- [ ] **Step 1:** `npx vitest run` — every test, expected PASS
- [ ] **Step 2:** `npx tsc --noEmit` — expected no output
- [ ] **Step 3:** `npx eslint .` — expected no output
- [ ] **Step 4:** `npm run build` — runs the offline audit, which fails on any external URL. Nothing in this plan adds a network request; if this fails, something reached for one.
- [ ] **Step 5:** `npm run smoke` — drives the production build in Edge, including a cold start with the network cut
- [ ] **Step 6:** By hand, in `npm run dev` — open the ask box and confirm the examples are there; say "new place, cellar"; then "move the rice to the cellar" against a fresh database and check that Undo takes back both the move and the place
- [ ] **Step 7:** Commit anything the runs changed

---

## Task 15: Finish the branch

- [ ] **Step 1:** Use the `superpowers:finishing-a-development-branch` skill to choose between merge, PR and cleanup.
