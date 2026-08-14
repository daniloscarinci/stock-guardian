-- Stock Guardian initial schema.
--
-- DATE AND TIME CONVENTIONS - the original application got this wrong and it
-- matters, so it is stated once here and followed everywhere:
--
--   *_at columns  : instants. TEXT, ISO-8601 UTC with milliseconds,
--                   e.g. '2026-08-14T09:15:00.000Z'.
--   *_date columns: calendar dates with no time and no zone, 'YYYY-MM-DD'.
--                   An expiry is a date printed on a package, not a moment.
--                   Comparing it against a UTC instant is what made the
--                   original app report items expired a day early for anyone
--                   west of UTC. All comparisons happen against the user's
--                   LOCAL calendar date.
--
-- IDENTIFIERS are TEXT (slugs or UUIDv4), never autoincrement integers. This
-- keeps merge-import de-duplication meaningful across devices and keeps every
-- value comfortably inside the JS safe-integer range.
--
-- *_norm columns hold search-normalized text: Unicode NFD, combining marks
-- stripped, lowercased. They are what makes 'agua' match 'Água' and 'acucar'
-- match 'Açúcar'. They are maintained by the application, not by triggers, so
-- the exact same normalizer runs for writes and for queries.

-- Applied migrations. PRAGMA user_version is the authoritative gate; this table
-- exists for diagnostics and to detect a shipped migration being edited after
-- the fact.
CREATE TABLE _schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- Key/value application settings. Values are JSON so a setting can grow from a
-- scalar into an object without a schema change.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Categories
--
-- The identifier is a stable slug, NEVER a display string. The original app
-- keyed categories by their localized label, so saving in English and then
-- switching to Portuguese orphaned every record and silently blanked the
-- category on the next save. Labels live in category_names; the id never moves.
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  icon        TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- System categories ship with the app and are kept in step by the seeder.
  -- User-created categories are never touched by it.
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE category_names (
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (category_id, lang)
);

CREATE INDEX idx_category_names_norm ON category_names(name_norm);

-- ---------------------------------------------------------------------------
-- Locations - an arbitrary-depth hierarchy (Property > House > Pantry).
--
-- ON DELETE RESTRICT rather than CASCADE: deleting a shelf must never silently
-- delete everything stored on it. The application re-parents or refuses.
-- Cycle prevention is enforced in the application layer, which is the only
-- place that can report a usable error.
-- ---------------------------------------------------------------------------
CREATE TABLE locations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  description TEXT,
  parent_id   TEXT REFERENCES locations(id) ON DELETE RESTRICT,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_locations_parent ON locations(parent_id);
CREATE INDEX idx_locations_norm ON locations(name_norm);

-- ---------------------------------------------------------------------------
-- Reference catalog - what a well-prepared household could hold.
--
-- Strictly separate from `items`, which is what this household actually holds.
-- Browsing the catalog never changes the user's inventory; adding from it
-- copies a row into `items` and records the provenance.
-- ---------------------------------------------------------------------------
CREATE TABLE catalog_items (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  default_unit TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_system    INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_catalog_items_category ON catalog_items(category_id, sort_order);

CREATE TABLE catalog_item_names (
  catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  lang            TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_norm       TEXT NOT NULL,
  PRIMARY KEY (catalog_item_id, lang)
);

-- Search hits this index for every language at once, which is what lets a
-- Portuguese speaker find an item they once entered in English.
CREATE INDEX idx_catalog_item_names_norm ON catalog_item_names(name_norm);

-- ---------------------------------------------------------------------------
-- Inventory - what the household actually has.
-- ---------------------------------------------------------------------------
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,

  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,

  quantity         REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit             TEXT NOT NULL DEFAULT 'un',
  -- NULL means "no target set for this item"; the global default threshold
  -- applies instead. 0 is a legitimate, distinct value - the original app's
  -- `|| 5` fallback made a threshold of zero impossible to express.
  minimum_quantity REAL CHECK (minimum_quantity IS NULL OR minimum_quantity >= 0),
  ideal_quantity   REAL CHECK (ideal_quantity IS NULL OR ideal_quantity >= 0),

  -- NULL means the item does not expire. A first-class state, not a missing
  -- value: the original app required an expiry date, so a hammer could not be
  -- entered without inventing one, and a blank date sorted as "expired".
  expiration_date TEXT,
  purchase_date   TEXT,
  opened_date     TEXT,

  condition TEXT CHECK (condition IS NULL OR condition IN ('new', 'good', 'fair', 'poor', 'unusable')),
  -- 1 critical, 2 high, 3 normal, 4 low. Lower sorts first.
  priority  INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),

  notes     TEXT,
  barcode   TEXT,

  photo_id        TEXT,
  catalog_item_id TEXT REFERENCES catalog_items(id) ON DELETE SET NULL,

  -- NULL means active. Archived items keep their history and stay restorable.
  archived_at TEXT,

  -- Anything an import could not map cleanly, kept as JSON rather than dropped.
  migration_notes TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_items_active ON items(archived_at) WHERE archived_at IS NULL;
CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_items_location ON items(location_id);
CREATE INDEX idx_items_expiration ON items(expiration_date) WHERE expiration_date IS NOT NULL;
CREATE INDEX idx_items_norm ON items(name_norm);
CREATE INDEX idx_items_barcode ON items(barcode) WHERE barcode IS NOT NULL;
-- Keyset pagination sorts by (name_norm, id); a covering index keeps that
-- stable and fast as the table grows.
CREATE INDEX idx_items_keyset ON items(name_norm, id);

-- Optional per-language names for an inventory item.
CREATE TABLE item_names (
  item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  lang      TEXT NOT NULL,
  name      TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  PRIMARY KEY (item_id, lang)
);

CREATE INDEX idx_item_names_norm ON item_names(name_norm);

-- ---------------------------------------------------------------------------
-- Stock movements. Append-only history: every quantity change records what it
-- was before and after, so a mistake can be traced rather than guessed at.
-- ---------------------------------------------------------------------------
CREATE TABLE stock_transactions (
  id      TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type    TEXT NOT NULL CHECK (type IN ('add', 'remove', 'consume', 'transfer', 'correction', 'purchase')),

  quantity        REAL NOT NULL,
  quantity_before REAL NOT NULL,
  quantity_after  REAL NOT NULL,

  source_location_id      TEXT REFERENCES locations(id) ON DELETE SET NULL,
  destination_location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,

  occurred_at TEXT NOT NULL,
  notes       TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_stock_tx_item ON stock_transactions(item_id, occurred_at DESC);
CREATE INDEX idx_stock_tx_occurred ON stock_transactions(occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Emergency contacts.
-- ---------------------------------------------------------------------------
CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_norm    TEXT NOT NULL,
  relationship TEXT,
  phone        TEXT,
  email        TEXT,
  location     TEXT,
  notes        TEXT,
  priority     INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_contacts_priority ON contacts(priority, name_norm);

-- ---------------------------------------------------------------------------
-- Photos, stored as BLOBs inside the database.
--
-- In-database rather than loose files so a single backup is genuinely complete
-- and a restore cannot land with dangling references. Images are downscaled and
-- size-capped on ingest; photos are opt-in when exporting a backup.
-- ---------------------------------------------------------------------------
CREATE TABLE photos (
  id         TEXT PRIMARY KEY,
  item_id    TEXT REFERENCES items(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  thumb      BLOB,
  width      INTEGER,
  height     INTEGER,
  byte_size  INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_photos_item ON photos(item_id);
