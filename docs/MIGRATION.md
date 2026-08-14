# Migration from the original application

The original `End_of_world_V11-Pro_Upgraded.html` exported a bare JSON array of
records with five string fields:

```json
[{ "name": "Arroz", "qty": "10", "loc": "Despensa",
   "expiry": "2026-12-31", "cat": "Alimentos" }]
```

No identifier, no unit, no timestamps — and a `cat` holding the *localized
category label* in whichever language happened to be active when the item was
saved. Getting that last one right is most of the work.

**The governing rule: nothing is discarded.** A field that cannot be mapped is
kept in `migration_notes` rather than dropped, so you can always see what your old
data said even where this code could not interpret it.

---

## Doing it

1. Open the original `End_of_world_V11-Pro_Upgraded.html`.
2. Press **Export**. It writes `stock_guardian_backup.json`.
3. In Stock Guardian: **Settings → Backup → Import**, and choose that file.
4. Read the summary. It reports the format, the record count, how many items you
   already have that match, and anything that could not be read cleanly.
5. Choose **Merge** or **Replace**.

Nothing is written before step 5.

---

## Field by field

| Original | Becomes | When it cannot be mapped |
|---|---|---|
| `name` | `items.name`, trimmed | Empty → the record is rejected and counted in the summary |
| `qty` | `items.quantity` | Unreadable → `0`, original text kept in `migration_notes` |
| `loc` | A row in `locations`, matched or created | Empty → no location |
| `expiry` | `items.expiration_date` | Not a real calendar date → NULL, original kept in `migration_notes` |
| `cat` | `categories.id`, via a 23-label lookup | Unrecognised → a new category named after the original label |
| anything else | — | Kept verbatim in `migration_notes` as JSON |

Legacy exports carried no unit, so `unit` becomes `un`.

---

## The category problem

The original stored a display label, so the same category arrived as `Alimentos`,
`Food` or `Alimentos` depending on the language at save time. Worse, the
application offered category options in the *current* language, so opening an
English-saved record in a Portuguese interface silently blanked its category on
the next save.

The importer folds each label — NFD, marks stripped, lowercased — and looks it up
against every label the original shipped, in all three languages:

| Folded label | Category |
|---|---|
| `alimentos`, `food` | `food` |
| `agua`, `water` | `water` |
| `medico`, `medical` | `medical` |
| `energia`, `power`, `energy` | `power` |
| `ferramentas`, `tools`, `herramientas` | `tools` |
| `abrigo`, `shelter`, `refugio` | `shelter` |
| `fogo`, `fire`, `fuego` | `fire` |
| `higiene`, `hygiene` | `hygiene` |
| `comunicacao`, `communication`, `comunicacion` | `communication` |

Twenty-three entries rather than twenty-seven, because folding collapses `Água`
with `Agua`, `Energia` with `Energía`, and `Médico`/`Higiene`/`Alimentos` with
their identical Spanish forms. `energy` is included because this version renames
that category in English while keeping the same slug.

Anything else becomes a real category named after the label, with the id
`imported-<folded-label>`. Your `Horta do Sítio` items keep their classification.

---

## Locations

The original had free text, so `Despensa`, `despensa` and `DESPENSA` were three
different places. The importer folds them and creates each location once, reusing
one you already have if the folded names match.

---

## Duplicates

An item is judged already present when its folded name, category and expiry all
match an existing one. **Merge** skips those and reports how many; **Replace**
clears your inventory, locations and contacts first, then restores from the file.
The reference catalog and system categories survive either way — they ship with
the application and are re-seeded.

Replace happens inside the same transaction as the inserts. If anything fails
partway, the whole thing rolls back and you keep what you had. That case is a
test, because the alternative — losing both the old data and the new — is the
single worst outcome this design exists to prevent.

---

## What improves in the move

Some of your old data becomes *more* correct on the way in.

- **Items that never expired.** The original required an expiry date, so a
  hammer, a compass and an axe all needed invented ones — and a blank date sorted
  as *expired*. Here NULL means "does not expire", and such items stop being
  flagged.
- **Categories stop being language-dependent.** Switch to Portuguese and nothing
  is orphaned.
- **Search finds accented names.** `agua` finds `Água Mineral` immediately.
- **Quantities become numbers.** They were strings, and `parseFloat('')` is NaN,
  which the original's own low-stock counter silently skipped.

---

## Seeing it for yourself

`fixtures/legacy-stock-guardian-backup.json` is a worked example in the exact
original format. Import it into an empty database and you can watch every case
above: two spellings of the same category, three cases of the same location, a
blank expiry, a missing expiry field, `"cerca de 3"` as a quantity, `2026-02-30`
as a date, an unknown category, extra fields, and one nameless record that is
correctly rejected.

`src/services/backup/fixtures.test.ts` imports that same file from disk and
asserts every claim on this page. If the documentation and the code ever
disagree, that test fails.

---

## Backup format

Exports use a v2 envelope:

```json
{
  "format": "stock-guardian-backup",
  "formatVersion": 2,
  "schemaVersion": 1,
  "appVersion": "2.0.0",
  "exportedAt": "2026-08-14T09:00:00.000Z",
  "counts": { "items": 17, "categories": 21, "locations": 8 },
  "checksum": "sha256:…",
  "data": { "items": [], "categories": [], "locations": [],
            "contacts": [], "transactions": [], "settings": {} }
}
```

The checksum is SHA-256 over a canonical (key-sorted) rendering of `data`, so the
same content always hashes the same. A mismatch is reported as a warning, not a
refusal — a hand-edited backup is still your data, and refusing outright could
strand your only copy.

A backup from a *newer* schema than the application supports is refused outright,
before anything is touched.

`fixtures/sample-backup.json` is a complete example, generated by actually
running the migration and exporting the result — so it cannot describe a format
the code does not produce.
