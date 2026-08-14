#!/usr/bin/env node
/**
 * Extracts the reference catalog from the original single-file application and
 * emits it as a typed TypeScript module.
 *
 *   backup/End_of_world_V11-Pro_Upgraded.html  ->  src/data/catalog.generated.ts
 *
 * This is the provenance path for the 194 preparedness items the original app
 * shipped. The spec is explicit that this data must not be lost in the rewrite
 * (MASTER DEVELOPMENT PROMPT §11, §48), so the script asserts the exact expected
 * shape and exits non-zero if anything is off. `npm run build` runs it first,
 * which means a regression here fails the build rather than silently shipping a
 * truncated catalog.
 *
 * The generated file IS committed. It is a data artifact, not a build artifact:
 * committing it means the catalog survives even if the source HTML is lost.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'backup/End_of_world_V11-Pro_Upgraded.html');
const TARGET = resolve(ROOT, 'src/data/catalog.generated.ts');

/** What the original file is known to contain. A mismatch is a hard failure. */
const EXPECTED_ITEM_COUNT = 194;
const EXPECTED_CATEGORY_COUNT = 9;

/**
 * Legacy categories carried no identifier - the *localized display string* was
 * the key, which is the root cause of the original app's category-loss bug
 * (save in EN, switch to PT, and the record is orphaned). These stable slugs
 * replace that. The mapping is written out explicitly rather than derived, so
 * it can never drift as a side effect of a change to the slug algorithm.
 *
 * Keyed by the legacy English string, which is what `cat.en` holds.
 */
const CATEGORY_ID_BY_LEGACY_EN = {
  Food: 'food',
  Water: 'water',
  Medical: 'medical',
  Power: 'power',
  Tools: 'tools',
  Shelter: 'shelter',
  Fire: 'fire',
  Hygiene: 'hygiene',
  Communication: 'communication',
};

/** Strip diacritics, lowercase. Shared with the runtime search normalizer. */
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Deterministic, URL-safe, ASCII slug derived from the English name. */
const slugify = (s) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function fail(message) {
  console.error(`\nextract-legacy-catalog: ${message}\n`);
  process.exit(1);
}

// --- Extract the `db` array literal -----------------------------------------

let html;
try {
  html = readFileSync(SOURCE, 'utf8');
} catch (err) {
  fail(`cannot read the reference application at ${SOURCE}\n  ${err.message}`);
}

const OPEN = 'const db = [';
const start = html.indexOf(OPEN);
if (start === -1) fail(`could not find "${OPEN}" in the reference application`);

// The literal is pure JSON with no nested "];" sequence, so the first one ends it.
const end = html.indexOf('];', start);
if (end === -1) fail('could not find the end of the db array literal');

let raw;
try {
  raw = JSON.parse(html.slice(start + OPEN.length - 1, end + 1));
} catch (err) {
  fail(`the db array is not valid JSON: ${err.message}`);
}

if (!Array.isArray(raw)) fail('the extracted db literal is not an array');

// --- Validate ---------------------------------------------------------------

if (raw.length !== EXPECTED_ITEM_COUNT) {
  fail(
    `expected ${EXPECTED_ITEM_COUNT} reference items but found ${raw.length}. ` +
      `If the reference application genuinely changed, update EXPECTED_ITEM_COUNT ` +
      `deliberately - do not let catalog data disappear silently.`,
  );
}

const seenIds = new Map();
const entries = [];
const categories = new Map();

raw.forEach((entry, index) => {
  const where = `entry #${index}`;

  for (const key of ['pt', 'en', 'es']) {
    if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
      fail(`${where}: missing or empty "${key}" name`);
    }
  }
  if (!entry.cat || typeof entry.cat !== 'object') fail(`${where}: missing "cat" object`);
  for (const key of ['pt', 'en', 'es']) {
    if (typeof entry.cat[key] !== 'string' || entry.cat[key].trim() === '') {
      fail(`${where}: missing or empty "cat.${key}"`);
    }
  }

  const categoryId = CATEGORY_ID_BY_LEGACY_EN[entry.cat.en];
  if (!categoryId) {
    fail(
      `${where}: unknown legacy category "${entry.cat.en}". ` +
        `Add it to CATEGORY_ID_BY_LEGACY_EN with a deliberate slug.`,
    );
  }

  if (!categories.has(categoryId)) {
    categories.set(categoryId, {
      id: categoryId,
      names: { 'pt-BR': entry.cat.pt, en: entry.cat.en, es: entry.cat.es },
      itemCount: 0,
    });
  }
  const category = categories.get(categoryId);
  // Guard against the same slug being reached from two different label sets.
  if (category.names.en !== entry.cat.en || category.names['pt-BR'] !== entry.cat.pt) {
    fail(`${where}: category "${categoryId}" has inconsistent labels across entries`);
  }
  category.itemCount += 1;

  const id = slugify(entry.en);
  if (id === '') fail(`${where}: English name "${entry.en}" produced an empty slug`);
  if (seenIds.has(id)) {
    fail(
      `${where}: slug collision "${id}" between "${seenIds.get(id)}" and "${entry.en}". ` +
        `Catalog ids must be unique.`,
    );
  }
  seenIds.set(id, entry.en);

  entries.push({
    id,
    categoryId,
    sortOrder: index,
    names: { 'pt-BR': entry.pt, en: entry.en, es: entry.es },
  });
});

if (categories.size !== EXPECTED_CATEGORY_COUNT) {
  fail(`expected ${EXPECTED_CATEGORY_COUNT} categories but found ${categories.size}`);
}

// --- Legacy category-string lookup ------------------------------------------
// The original app stored the *localized* category label on every inventory
// record, in whichever language happened to be active at save time. The legacy
// importer needs to map any of those strings back to a stable id, so build the
// folded lookup here rather than hand-maintaining 27 strings.

const legacyLookup = new Map();
for (const category of categories.values()) {
  for (const label of Object.values(category.names)) {
    const key = fold(label);
    const existing = legacyLookup.get(key);
    if (existing && existing !== category.id) {
      fail(`legacy category label "${label}" maps to both "${existing}" and "${category.id}"`);
    }
    legacyLookup.set(key, category.id);
  }
}
// The spec renames this category to "Energy"; legacy data says "Power". Accept both.
legacyLookup.set('energy', 'power');

// --- Emit -------------------------------------------------------------------

const q = (s) => JSON.stringify(s);
const sortedCategories = [...categories.values()];

const out = `// GENERATED FILE - DO NOT EDIT BY HAND.
// Regenerate with: npm run generate:catalog
//
// Source: backup/End_of_world_V11-Pro_Upgraded.html (the original application)
// Extracted: ${EXPECTED_ITEM_COUNT} reference items across ${EXPECTED_CATEGORY_COUNT} categories.
//
// This is reference data, not user inventory. Adding a catalog entry to the
// user's inventory copies it into \`items\`; browsing the catalog never changes
// anything the user owns.

export type CatalogLanguage = 'pt-BR' | 'en' | 'es';

export interface LocalizedNames {
  readonly 'pt-BR': string;
  readonly en: string;
  readonly es: string;
}

export interface LegacyCatalogCategory {
  readonly id: string;
  readonly names: LocalizedNames;
  readonly itemCount: number;
}

export interface LegacyCatalogItem {
  readonly id: string;
  readonly categoryId: string;
  readonly sortOrder: number;
  readonly names: LocalizedNames;
}

/** The 9 categories the original application shipped, with their exact labels. */
export const LEGACY_CATALOG_CATEGORIES: readonly LegacyCatalogCategory[] = [
${sortedCategories
  .map(
    (c) =>
      `  { id: ${q(c.id)}, names: { 'pt-BR': ${q(c.names['pt-BR'])}, en: ${q(c.names.en)}, es: ${q(c.names.es)} }, itemCount: ${c.itemCount} },`,
  )
  .join('\n')}
];

/** The ${EXPECTED_ITEM_COUNT} reference items, in their original file order. */
export const LEGACY_CATALOG_ITEMS: readonly LegacyCatalogItem[] = [
${entries
  .map(
    (e) =>
      `  { id: ${q(e.id)}, categoryId: ${q(e.categoryId)}, sortOrder: ${e.sortOrder}, names: { 'pt-BR': ${q(e.names['pt-BR'])}, en: ${q(e.names.en)}, es: ${q(e.names.es)} } },`,
  )
  .join('\n')}
];

/**
 * Maps a legacy category label - in any of the three languages, diacritics
 * folded and lowercased - back to a stable category id.
 *
 * The original app wrote the localized label onto every inventory record, so an
 * imported backup may say "Food", "Alimentos" or "Alimentos" for the same
 * category depending on the UI language at save time. Look up with the same
 * folding the importer uses.
 */
export const LEGACY_CATEGORY_ID_BY_FOLDED_LABEL: Readonly<Record<string, string>> = {
${[...legacyLookup.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([key, id]) => `  ${q(key)}: ${q(id)},`)
  .join('\n')}
};

/** Sanity constants the seed migration asserts against. */
export const LEGACY_CATALOG_ITEM_COUNT = ${EXPECTED_ITEM_COUNT};
export const LEGACY_CATALOG_CATEGORY_COUNT = ${EXPECTED_CATEGORY_COUNT};
`;

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, out, 'utf8');

console.log(
  `extract-legacy-catalog: ${entries.length} items, ${categories.size} categories, ` +
    `${legacyLookup.size} legacy labels -> src/data/catalog.generated.ts`,
);
for (const c of sortedCategories) {
  console.log(`  ${String(c.itemCount).padStart(3)}  ${c.id.padEnd(14)} ${c.names.en}`);
}
