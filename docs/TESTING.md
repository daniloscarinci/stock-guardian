# Testing

```bash
npm test              # 956 unit tests, 36 files
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
| Voice parsing | Spoken numbers and dates, rule order, the three phrase corpora |
| Voice execution | Every intent over a real database, and the write spy |
| Speech | The seam's three implementations, `processLocally`, the speaker |
| The ask sheet | Both ways in, end to end, against a real database |
| Expiry notifications | The plan for a given today, grouping, the cap, and the plugin refusing |

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

### The phrase corpora

`src/voice/grammar/*.phrases.test.ts` holds every phrase form the application
claims to understand — 67 in Portuguese, 77 in English, 78 in Spanish. They are
written lowercase and often without accents - the way speech arrives, and the
way a hurried thumb does - rather than the way a careful person would type it,
because a folded, unaccented phrase is what the parser is built to survive.

A corpus, not a sample. It is the specification of the feature: a phrase that is
not in it is a phrase `docs/VOICE.md` does not claim.

**A phrase that fails in real use becomes a row before it becomes a fix.** Every
file says so in its header. The order matters because the alternative is a
grammar patched to satisfy one remembered sentence, with nothing to say whether
the patch broke the twelve rules it sits among — rule order is first-match-wins,
so a new pattern placed a line too early silently steals from the one below it.
Writing the row first turns "it did not understand me" into a failing test, and
turns the fix into something that either passes the other 221 or does not.

About a quarter of each corpus is phrases that must **not** parse.
`comprei arroz` names no amount, `quanto tem` names no item, and
`o arroz vence 31 de abril` names a date that has never existed. Each must come
back UNKNOWN. Those rows are the ones worth having: a parser is judged by what
it refuses, and a guess at a write is the failure this whole feature was shaped
to avoid.

### The write that must not happen

`execute.writes.test.ts` spies on the SQL driver, runs every changing intent
through `execute`, and asserts that no `INSERT`, `UPDATE` or `DELETE` reaches
it. `VoiceSheet.test.tsx` does the same thing from the other end: it drives the
real sheet through its typed box against a real in-memory database, and once the
confirmation card is on screen it reads the item's quantity straight out of the
table and asserts it is still the old one.

Two tests for one property, because "nothing is written until you confirm" is
the promise that makes voice control safe to give someone, and a promise held
only by the shape of the code is one refactoring away from being false.

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
- **Component rendering, nearly everywhere.** `VoiceSheet.test.tsx` is the only
  React Testing Library suite, written because the confirmation card's whole
  purpose is a thing that must not happen, and because a microphone that failed
  in silence is a defect no layer below the interface can see. Every
  screen is exercised end to end by the smoke test instead, not unit tested.
- **A notification actually arriving.** `notifier.test.ts` replaces the plugin
  with a fake alarm manager - `schedule` writes rows into it and `getPending`
  reads them back - so rescheduling twice is watched leaving one copy rather
  than inferred from call counts, and a refused permission is watched being
  returned rather than swallowed. What no test can reach is Android's own alarm
  manager: whether a given phone honours an inexact alarm in Doze, and whether a
  manufacturer's battery optimiser cancels it, are facts about that phone.
  `docs/ANDROID.md` lists them, and has a step for each.
- **Real speech.** No test speaks and no test listens. What is covered is
  everything around the microphone, and the two-attempt sequence in particular:
  `webspeech.test.ts` pins that the first recognizer of every listen sets
  `processLocally` and that one without it is always a retry; `capacitor.test.ts`
  pins the codes the Android plugin returns and the order of `preferOffline`
  across both attempts; `online.test.ts` pins the policy both of them share -
  never after a cancel, never under the refusal, never with the radio off, and
  never twice; `recognizer.test.ts` pins that no unrecognised failure is ever
  read as a cancellation; and `VoiceSheet.test.tsx` drives a stubbed recognizer
  through the real sheet, for each failure's sentence, for the one that must
  stay silent, and for the marker on an exchange the network transcribed. What
  no test can reach is the recognizer itself - whether a given phone honours
  `EXTRA_PREFER_OFFLINE` is a fact about that phone, which is why
  `docs/ANDROID.md` has a step for it.
  `ringer.test.ts` covers the speaker's half - that the ringer is read on
  Android, that it is not asked anywhere else, and that a bridge call which
  fails is read as "not silenced" rather than thrown.
- **The real Anthropic API.** Never. `converse.test.ts` and `VoiceSheet.test.tsx`
  both replace the SDK and keep `client.ts` real, so the assertion that no key
  builds no client is made against the code that would have built one. Every key
  in every test is a string nobody could bill.
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
