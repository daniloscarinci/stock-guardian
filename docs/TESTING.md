# Testing

```bash
npm test              # 401 unit tests
npm run smoke         # 18 browser checks against the production build
npm run typecheck     # TypeScript, strict
```

Two suites, doing different jobs. The unit suite proves the logic. The smoke test
proves the application starts, stores data, and survives losing the network —
things no amount of unit testing can tell you.

---

## The unit suite

Vitest, running in Node against **the same SQLite build that ships**. The
in-memory test driver uses the same `@sqlite.org/sqlite-wasm` package as the
browser, through the same `SqlDriver` interface, executing the same `.sql`
migration files loaded the same way. Collation, type affinity and `ON CONFLICT`
behaviour are bit-for-bit identical to production. There is no dialect gap to
reason about.

No test contains hand-written SQL mirroring production SQL. That is how the two
silently diverge.

| Area | Covers |
|---|---|
| Driver contract | 28 cases every driver must pass, including rollback |
| Migrations | Applying, refusing, atomicity, schema constraints |
| Seeding | 194 items, 20 categories, idempotence, user edits preserved |
| Dates | Local vs UTC, DST, impossible dates |
| Expiry | Buckets, configurable windows, sorting |
| Stock | Thresholds, the original's rule, floating-point dust |
| Preparedness | Weighting, capping, transparency |
| Replenishment | What appears, ordering, partial purchases |
| SQL/JS equivalence | 312 combinations, both implementations |
| Repositories | CRUD, search, filters, pagination, referential safety |
| Backup and import | Round-trip, merge vs replace, hostile input |
| Legacy fixture | The real file in `fixtures/`, 14 assertions |
| Reports | Four builders, CSV flattening, spreadsheet-formula guarding |
| Contacts | CRUD, urgency ordering, accent-insensitive search, backup round-trip |
| i18n | Completeness, placeholders, plurals, no untranslated copies |

### What the tests are actually for

Most of them pin a specific defect in the original application, so it cannot come
back:

- An item with no expiry date is **not** expired.
- `agua` finds `Água`; `acucar` finds `Açúcar`; `cuc` finds `Açúcar`.
- A threshold of zero is a threshold of zero.
- A record saved as `Food` and one saved as `Alimentos` land in the same category.
- A failed import leaves existing data untouched — asserted for seven kinds of
  malformed file.
- Markup in an item name is stored as text, never interpreted.
- `'; DROP TABLE items; --` as a name leaves all 194 catalog rows intact.

### The one that matters most

`db.transaction()` rolling back **and rethrowing** when its callback throws was
verified against the real engine before anything was built on top of it. A driver
that silently committed partial work there would corrupt inventory in a way no
user could detect. It is asserted in the driver contract, and again for `replace`
imports, where the alternative is losing both the old data and the new.

### The drift guard

Stock status and expiry bucket exist twice — in `domain/` for scoring, in SQL for
filtering ten thousand rows without loading them.
`status-expressions.test.ts` runs both over 312 combinations of quantity, minimum
and ideal, plus every expiry boundary, and demands identical answers. Change one
without the other and the build fails.

---

## The browser test

`npm run smoke` starts the preview server and drives the production build in
Edge or Chrome. It needs a browser installed; Playwright is configured to use the
system one rather than downloading its own.

It checks:

1. The application starts and reaches an interactive dashboard.
2. **It runs on `opfs-sahpool` while NOT cross-origin isolated** — the assumption
   the entire storage design rests on. If this ever fails, the app works locally
   and breaks for every user on a static host.
3. OPFS holds the expected directory.
4. An item saves and appears in the list.
5. Searching `agua` finds `Água`.
6. **Data survives a reload** — real durability, not a mock.
7. The reference catalog reports 194 items.
8. Switching to Portuguese translates the interface and updates `document.lang`.
9. **The app starts with the network disconnected.**
10. Inventory is readable offline.
11. A contact saves, is listed, and is found by searching "jose" for "José".
12. The reports screen renders rows, shows a preparedness percentage, and
    exports a CSV file that actually downloads.
13. No unexpected console errors.

All 18 pass. The reports check asserts a real CSV file arrives, not merely that
the export did not throw.

---

## What is not covered

Stated so nobody mistakes green for complete.

- **The desktop driver.** Never compiled — no Rust toolchain here. The SQL it
  runs is covered, since all three drivers share it; the transport is not.
  `docs/BUILD.md` lists what to check.
- **Component rendering.** No React Testing Library suite. Screens are exercised
  end to end by the smoke test, not unit tested.
- **Printing.** The print stylesheet is written and the button calls
  `window.print()`, but no test opens a print preview - browsers do not expose
  one to automation.
- **A second tab.** The single-connection path is handled in code and reported to
  the user, but not tested — it needs two browser contexts against one origin.
- **The corruption ladder.** Quarantine and salvage are implemented and reviewed;
  deliberately corrupting an OPFS database from a test is not set up.
- **Ten thousand rows.** The queries are written for it — keyset pagination,
  covering indexes, `ANALYZE` after seeding — but no benchmark has been run at
  that size, so no performance claim is made here.

---

## Adding tests

Put business rules in `domain/` and test them without a database; that is what
the layer is for. Anything touching SQL gets a repository test against
`createMemoryDriver()`. Anything that could destroy data gets a test proving it
does not — and the assertion to write is that the *existing* data is still there
afterwards, not merely that an error was thrown.
