# Database

SQLite. In the browser it is SQLite compiled to WebAssembly, stored in the Origin
Private File System through the `opfs-sahpool` VFS. On the desktop it is a file
in the application data directory. The schema and the SQL are the same.

Schema version lives in `PRAGMA user_version`. The current version is **1**.

---

## Conventions

These hold everywhere, and two of them exist because the original application got
them wrong.

**Identifiers are TEXT.** Slugs for reference data, UUIDv4 for user data. Never
autoincrement integers — stable ids make de-duplication on import meaningful and
keep every value inside the JavaScript safe-integer range.

**`*_at` columns are instants**: ISO-8601 UTC with milliseconds.

**`*_date` columns are calendar dates**: `YYYY-MM-DD`, no time, no zone. An
expiry is a date printed on a package. The original compared it against a UTC
instant from `toISOString()`, which in Brazil reported items expired a day early
every evening after 21:00.

**`*_norm` columns hold folded text**: Unicode NFD, combining marks stripped,
lowercased. This is what makes `agua` match `Água`. The application maintains
them, not triggers, so writes and queries fold identically.

**NULL means absent, and absence has meaning.** A NULL `expiration_date` means
the item does not expire — a first-class state, not missing data.

---

## Tables

### `items` — what the household actually has

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUIDv4 |
| `name` | TEXT NOT NULL | |
| `name_norm` | TEXT NOT NULL | Folded, indexed |
| `category_id` | TEXT → `categories` | `ON DELETE SET NULL` |
| `location_id` | TEXT → `locations` | `ON DELETE SET NULL` |
| `quantity` | REAL NOT NULL DEFAULT 0 | `CHECK (quantity >= 0)` |
| `unit` | TEXT NOT NULL DEFAULT `'un'` | |
| `minimum_quantity` | REAL NULL | NULL uses the global threshold. **0 is valid** |
| `ideal_quantity` | REAL NULL | The restock target |
| `expiration_date` | TEXT NULL | **NULL = does not expire** |
| `purchase_date` | TEXT NULL | |
| `opened_date` | TEXT NULL | |
| `condition` | TEXT NULL | `new`/`good`/`fair`/`poor`/`unusable` |
| `priority` | INTEGER NOT NULL DEFAULT 3 | 1 critical … 4 low |
| `notes` | TEXT NULL | |
| `barcode` | TEXT NULL | |
| `photo_id` | TEXT NULL | |
| `catalog_item_id` | TEXT → `catalog_items` | Provenance, when added from the catalog |
| `archived_at` | TEXT NULL | NULL = active |
| `migration_notes` | TEXT NULL | JSON. What an import could not map |
| `created_at`, `updated_at` | TEXT NOT NULL | |

Indexes cover active items, category, location, expiration, folded name, barcode,
and a `(name_norm, id)` covering index for keyset pagination.

### `categories` and `category_names`

The identifier is a stable slug; every label lives in `category_names`, one row
per language. This is the structural fix for the original application's worst
bug: it stored the localized label on each record, so switching from English to
Portuguese orphaned everything and blanked the category on the next save.

`is_system` marks the twenty categories that ship with the application. They can
be renamed, recoloured and hidden, but not deleted.

### `locations`

Self-referencing through `parent_id`, to any depth. `ON DELETE RESTRICT` rather
than CASCADE: deleting a shelf must never silently delete everything on it.
Cycle prevention lives in the application layer, which is the only place that can
report a usable error.

### `catalog_items` and `catalog_item_names`

The 194 reference items from the original application, in three languages each.
Reference data, strictly separate from `items`. Adding a catalog entry to
inventory copies it and records `catalog_item_id`; browsing changes nothing.

### `stock_transactions`

Append-only history. Every quantity change records what it was before and after,
so a mistake can be traced rather than guessed at. `ON DELETE CASCADE` from
`items`.

### `contacts`

Emergency contacts, ordered by priority then folded name. Only `name` has a
`name_norm` sibling; the other fields are searched in memory with the same
`foldText`, because `LOWER()` in SQLite lowercases ASCII and leaves accents
alone — so a SQL search for "medico" would silently miss a relationship recorded
as "Médico". For a list of tens of rows, filtering in memory is the honest fix.

### `photos`

Image bytes stored as BLOBs in the database, so a single backup file is
genuinely complete and a restore cannot land with dangling references. The table
exists and is carried by backups; the interface for adding photographs is not
built yet.

### `settings`

Key/value with JSON values, so a setting can grow from a scalar into an object
without a schema change.

### `_schema_migrations`

Version, name, checksum and timestamp per applied migration. `user_version` is
the authority; this table is for diagnostics and for catching a shipped migration
edited after the fact.

---

## Migrations

Plain `.sql` files in `src/database/migrations/`, named `NNNN_description.sql`,
loaded through `import.meta.glob` so tests execute the literal production files.

The runner applies each one inside a transaction that also bumps `user_version`.
SQLite executes DDL transactionally, so **a partially applied migration is not a
reachable state**: either the schema change and the version bump both committed,
or neither did. A crash mid-commit leaves a hot journal, the next open rolls it
back, and the migration simply runs again.

`PRAGMA foreign_keys` is toggled *outside* the transaction, because it is a no-op
inside one, and a `foreign_key_check` runs before each migration commits.

A database whose `user_version` exceeds what the code supports throws
`SchemaTooNewError` **before touching a single byte**, and the interface offers
only "export a backup" and "close". Never "reset".

### Adding one

1. Create `src/database/migrations/0002_your_change.sql`.
2. Write forward-only SQL.
3. Add a test.

Never edit a shipped migration. Devices that already ran it will silently keep
the old schema forever; the checksum column exists to catch exactly that, and a
development-mode assertion fails loudly when it happens.

---

## Seeding

Reference data — twenty system categories, the 194 catalog items, default
settings — is seeded on every start-up, outside the migration sequence. A
corrected catalog can then ship without inventing a schema version for it.

Seeding is **INSERT-only**. New categories, items and languages appear on update;
nothing the user renamed, recoloured or reorganised is ever overwritten. The
trade is deliberate and worth stating: a corrected translation will not reach
devices that already seeded. The alternative — an update overwriting whatever the
user changed, to fix a typo — is worse.

---

## Search

Every searchable string has a folded `*_norm` sibling. Queries hit that column
with `LIKE '%…%' ESCAPE '\'`.

FTS5 is compiled into both engines and was deliberately not used. The
specification requires *partial* matches, and `unicode61` FTS5 matches whole
tokens with prefixes — `cuc` would not find `Açúcar`, while `LIKE '%cuc%'` does.
At sixty thousand short indexed strings a LIKE scan is well under a frame. If the
catalog ever grows enough to change that, FTS5 with the `trigram` tokenizer is
the route, and it is available.

---

## Integrity and recovery

`PRAGMA quick_check(1)` runs on every open — cheap enough to always do, and it
catches damage before a write can compound it.

On failure the application quarantines rather than deletes: the bytes are
exported to `stock-guardian-backups/` in OPFS, and the user is offered the
damaged copy and any rolling backup. `wipeFiles()` and `clearOnInit: true` appear
nowhere outside tests.

Settings → Diagnostics runs the full `PRAGMA integrity_check` on demand, and
reports the storage engine, journal mode, database size and whether the browser
has granted persistent storage.
