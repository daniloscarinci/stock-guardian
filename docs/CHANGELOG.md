# Changelog

## 2.0.0

A rebuild of the original single-file application. Everything it did, this does.
The original is kept at `backup/End_of_world_V11-Pro_Upgraded.html`, untouched,
as the baseline and the provenance record for the reference catalog.

---

### Defects fixed

Each of these was in the original, and each is now pinned by a test.

**Categories were stored as localized labels.** An item saved in English carried
`"Food"`; the Portuguese interface offered `"Alimentos"`. Switching language
orphaned every record, and re-saving one silently blanked its category.
Categories now have stable identifiers, with labels in a side table. Renaming a
category in any language touches no item.

**User text went into `innerHTML` unescaped.** Item names, locations and
categories were interpolated straight into markup on every render, and the
importer checked only `Array.isArray` before replacing the entire inventory — so
a crafted backup was a code-execution path that persisted to `localStorage` and
re-fired on every load. React escapes by default, every import is validated
against a schema, and a name like `<img src=x onerror=alert(1)>` is now stored
and displayed as the text it is.

**Items were required to expire.** `saveItem` refused to save without a date, so
a hammer, an axe and a compass all needed invented ones. Worse, a blank date
compared as less than today, so every dateless item was reported *expired*. A
missing expiry now means the item does not expire, and is a first-class state.

**Expiry was computed in the wrong timezone.** `new Date().toISOString()` yields
a UTC calendar date, while `<input type="date">` yields a local one. In Brazil,
at UTC−3, every evening after 21:00 reported items as expiring a day early. All
date comparisons now use the local calendar date, and the arithmetic runs in UTC
so daylight-saving transitions cannot shift it.

**Editing could overwrite the wrong item.** The pending edit index lived in a
hidden input and was never cleared on delete, sort, language change or import.
Edit row five, delete row two, save — and row four was overwritten. Items now
have stable identifiers.

**Import destroyed data with one click.** No validation, no preview, no
confirmation, no undo; the next render persisted the result. Import now reads and
validates first, reports what the file contains, and writes only after the user
chooses merge or replace — in a single transaction, so a failure halfway leaves
the original data intact.

**A low-stock threshold of zero was impossible.**
`parseFloat(stored) || 5` turned zero back into five on every render.

**Search ignored accents.** `toLowerCase().includes()` meant `agua` never found
`Água` and `acucar` never found `Açúcar`, in an application whose interface and
catalog are Portuguese-first. Search now folds diacritics, matches partway
through words, covers notes, barcodes, locations and category names, and searches
all three languages at once.

**The interface was unusable with a screen reader.** No `<label>` anywhere, no
ARIA, action buttons that were bare glyphs, catalog entries that were
`<span onclick>` — unreachable by keyboard. Every control now has a real label,
dialogs use the native `<dialog>` element, and status is never conveyed by colour
alone.

**It did not work on a phone.** No viewport meta tag, and a form grid fixed at
six columns that never collapsed. The layout is now responsive, with the table
becoming cards and a quick-action bar within thumb reach.

**Every keystroke rebuilt everything.** Typing in the search box re-rendered the
table, rebuilt all 194 catalog entries with their inline handlers, and wrote to
`localStorage`. Search is debounced and queries are indexed.

**Two translation keys existed but were never read.** `exportBtn` and
`importBtn` were defined in all three languages while the buttons stayed
hard-coded English. Translation keys are now derived from the English tree, so a
missing one is a compile error, and tests assert that no locale has an unused or
untranslated entry.

**Language reset on every reload.** It now persists, and `document.lang` follows
it.

---

### Added

- **A real database.** SQLite — WebAssembly with OPFS storage in the browser,
  native on the desktop — with a versioned, atomic migration system, replacing
  two `localStorage` keys.
- **Minimum and target quantities**, per item, with Critical/Low/Adequate/Surplus
  status and a replenishment list that says how much to buy.
- **A preparedness score** that shows its own method and lists what is missing.
- **An expiration centre** with configurable warning windows, replacing a single
  hard-coded 30 days.
- **Locations** as real records, nesting to any depth, replacing free text.
- **Movement history.** Every quantity change records what it was before and
  after.
- **Quantity changes without a form** — `+` and `−` in the list.
- **Archive and restore**, so removing something from view no longer means
  destroying it.
- **Twenty categories**, user-extensible, replacing nine fixed ones.
- **Filters that combine** — category, location, stock status, expiry, priority,
  condition, archived.
- **CSV export** and a print stylesheet, alongside JSON backup.
- **Backups with integrity checking**: format and schema versions, record counts,
  and a SHA-256 checksum.
- **Installable as an app**, with a hand-written service worker and verified cold
  offline start.
- **Light and dark themes**, following the system by default.
- **Diagnostics**: storage engine, journal mode, database size, integrity check,
  and whether the browser has promised to keep your data.

---

### Preserved deliberately

- **All 194 reference items**, in all three languages, with their original
  category assignments. Nothing was reclassified, even where a different category
  now looks like a better fit — a compass sits in Communication, not Navigation.
  Reference data is not ours to quietly rewrite.
- **The low-stock rule.** `quantity <= threshold`, inclusive, with a default of
  5 — but only as the fallback for items carrying no minimum of their own.
- **An item expiring today is not yet expired**, matching the original.
- **Thirty days** remains a default warning window.
- **The legacy export format** is still readable.

---

### Not built

Listed because the alternative is an interface full of controls that do nothing.
None of these appears in the application as a disabled button or a "coming soon"
panel.

Photographs (stored by the schema, no interface), barcode scanning (manual entry
works), emergency contacts (stored and backed up, no screen), application lock,
notifications, a dedicated reports screen, and the desktop build — whose
configuration is complete and reviewed but has never been compiled, because this
machine has no Rust toolchain.
