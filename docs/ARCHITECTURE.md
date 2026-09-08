# Architecture

## The shape of it

```
                    ┌──────────────────────────────┐
   features/  ──────│  React screens & components  │
                    └──────────────┬───────────────┘
                                   │ calls
                    ┌──────────────▼───────────────┐
   repositories/ ───│  Typed reads and writes      │───┐
                    └──────────────┬───────────────┘   │ uses
                                   │ speaks            │
                    ┌──────────────▼───────────────┐   │
   database/     ───│  SqlDriver  (the only seam)  │   │
                    └──────┬───────────────┬───────┘   │
                           │               │           │
              ┌────────────▼──┐  ┌─────────▼────────┐  │
              │ Worker driver │  │ Memory driver    │  │
              │ SQLite-WASM   │  │ (tests)          │  │
              │ OPFS          │  │ :memory:         │  │
              └───────────────┘  └──────────────────┘  │
                                                       │
                    ┌──────────────────────────────┐   │
   domain/       ───│  Pure rules, zero I/O        │◄──┘
                    └──────────────────────────────┘
```

Three rules hold the whole thing together.

**The database is the only source of truth.** No store keeps a copy of a domain
value that also lives in a table. Components read through `useAsyncData`, writes
bump a revision counter, and the reads run again. There is no cache to go stale.

**`SqlDriver` is the only place the engine is visible.** Above it, nothing knows
whether SQLite is compiled to WebAssembly in a worker, running in-process for a
test, or sitting behind a Rust process on the desktop. That is why the desktop
driver is eighty lines: transaction semantics were written once, in
`createDriver`, and all three drivers inherit them.

**`SpeechRecognizer` WAS the second seam, and is gone.** It stood above
Android's system recognizer, Chrome's on-device model and a `none` that reported
unavailable, and it was built well. It was also built for a phone whose
recognizer refuses to transcribe offline without a Portuguese pack, so the
feature never worked there and was removed rather than kept as a button that
failed in silence. What survives of that layer is `speak.ts`, which reads an
answer aloud, and `ringer.ts`, which asks Android whether the phone is on
silent. Neither is a seam; both are one function.

**The second seam now is the pair of engines behind one box.** A typed question
goes to Claude when the assistant is on and a key is stored, and to the twelve
parser rules otherwise - and to the parser anyway when Claude cannot be reached.
`useVoice.ts` is where that choice is made, and it is the only place it is made.
See *The ask path*.

---

## Directories

```
src/
  app/           start-up, routing, shell, error boundary
  components/    UI primitives, status badges, charts, icons
  features/      one directory per screen (inventory, dashboard, expiration,
                 replenishment, catalog, locations, categories, contacts,
                 reports, settings) and one for the ask sheet, which is a
                 dialog rather than a route
  database/
    driver/      SqlDriver contract, shared transaction logic, oo1 adapter
    worker/      the browser driver: worker, protocol, client
    tauri/       the desktop driver (not compiled here)
    migrations/  ordered .sql files and the runner
    seed/        system categories and the reference catalog
  repositories/  items, categories, locations, catalog, contacts, settings
  domain/        dates, expiry, stock, preparedness, replenishment, normalize
  voice/         transcript → Intent: parser, numbers, dates, one grammar
                 per language and a registry. Pure, zero I/O.
  services/      backup, import, export, reports, download
    speech/      SpeechRecognizer contract and its three implementations
    voice/       Intent → Outcome: resolve, execute (reads), commit (writes)
  i18n/          three locales and the translation function
  hooks/  types/  styles/  data/  test/
scripts/         catalog extraction, icons, offline audit, smoke test
src-tauri/       desktop shell
fixtures/        legacy sample and a generated v2 backup
```

`domain/` imports nothing from the layers below it. Every business rule can be
tested without a database, and is.

---

## The data layer

### Why a worker

`FileSystemSyncAccessHandle`, which the OPFS storage is built on, cannot be
created on the main thread. There is no main-thread implementation to fall back
to, so the worker is a requirement rather than an optimisation. The welcome side
effect is that a scan over tens of thousands of catalog rows never blocks
rendering.

### Why `opfs-sahpool` and not `opfs`

This is the single most consequential decision in the codebase.

The widely documented `opfs` VFS bridges synchronous SQLite calls to asynchronous
OPFS through `Atomics.wait` on a `SharedArrayBuffer`. That requires
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response headers
— headers a static host cannot set. Choosing it would produce an application that
works perfectly in development and fails for every real user.

`installOpfsSAHPoolVfs` pre-opens its sync access handles instead. It needs no
headers, and it is durable. The worker asserts the active VFS name on start-up so
this cannot regress, and the browser smoke test asserts that the page is *not*
cross-origin isolated — proving the assumption rather than trusting it.

### What that VFS costs

- **No WAL.** The VFS implements no `xShm*` methods, and `PRAGMA journal_mode =
  WAL` fails *silently* rather than erroring. The mode is set to `TRUNCATE` and
  then read back; a mismatch throws. Bulk imports are chunked, because a writer
  blocks readers for the whole transaction.
- **One connection.** A second tab cannot open the database, and is told so.
  The same constraint bites within a single tab: React StrictMode double-invokes
  effects in development, so start-up is memoized to a single promise. Without
  that, the first call took the pool and the second could never get it - the
  application reported "cannot start" over a healthy database, and only in
  development, so the production build hid it. `bootstrap.test.ts` pins it.
- **A secure context.** OPFS is unavailable on `file://`. The application refuses
  to start there rather than appearing to work and losing everything.

### Transactions

`batch` is the default write path: one message, one synchronous engine-side
transaction, atomic by construction, impossible to leave dangling.

`transaction(fn)` exists for read-then-decide work. It is serialized against all
other access, and the handle it hands the callback is *narrower* than the driver
— `transaction` and `close` are absent from it, so nesting one is a compile error
rather than a runtime failure. A watchdog rolls back and poisons the handle if a
callback outlives its transaction.

That `db.transaction()` genuinely rolls back **and rethrows** when its callback
throws was verified against the real engine before anything was built on top of
it. A driver that silently committed partial work there would corrupt inventory
in a way no user could detect.

---

## The ask path

```
                    ┌──────────────────────────────┐
   features/voice/ ─│  Button, sheet, confirm card │
                    └───────┬──────────────────────┘
                            │ one question, one of two engines
              ┌─────────────┴──────────────┐
              │                            │
   ┌──────────▼───────┐        ┌───────────▼──────────────┐
   │ parse(grammar)   │        │ services/ai/converse     │
   │ PURE, zero I/O   │        │ tool-use loop, one host  │
   └──────────┬───────┘        └───────────┬──────────────┘
              │ Intent                     │ tool calls
              │                ┌───────────▼──────────────┐
              │                │ services/ai/tools        │
              │                │ READS run; WRITES only   │
              │                │ propose                  │
              │                └───────────┬──────────────┘
              │                            │ PendingWrite
   ┌──────────▼──────────────────────────────────────────┐
   │ services/voice/  resolve · execute (READS)          │
   │                  commit (WRITES, on a press only)   │
   └──────────┬──────────────────────────────────────────┘
              │ calls
        repositories/
```

**`voice/` is pure and `services/voice/` is not, and the line is the point.**
`parse` takes a grammar and a string and returns an `Intent` — data that holds
the phrase as typed, never a database identifier, and that cannot act. Every rule
in every language is therefore testable with a string and an expectation, which
is what makes a corpus of 222 rows cheap enough to be worth keeping. Turning
a phrase into a row needs the database, so it lives on the other side of the
line in `resolve.ts`.

**`execute` reads and `commit` writes, and only one of them is reachable
without a press.** `execute` returns a `PendingWrite` describing what would
happen; `commit` is called by the confirmation card's button and by nothing
else. That is what makes "nothing is stored until you confirm" a structural
property rather than a claim about the interface, and `execute.writes.test.ts`
spies on the driver to hold it there.

**The second engine inherits that property rather than repeating it.**
`services/ai/tools.ts` never writes: its four changing tools build the same
`PendingWrite` and tell Claude only that the change was proposed. So a card, a
receipt and undo are the existing ones, and `tools.writes.test.ts` spies on
`exec` and `transaction` to keep it structural. The interface goes one step
further and never reads `certainty` on a proposal at all - the branch that
stores an explicit write unasked belongs to the parser, and nothing a model
produced may reach it.

**A grammar is a file, not a branch.** One file per language plus one registry
entry, the same rule `i18n/translate.ts` follows. `parse.ts` knows nothing about
any particular language. Rule order inside a grammar is load-bearing — first
match wins, so specific forms precede general ones — and `parse.test.ts` pins
it.

`docs/VOICE.md` covers what can be typed and what happens to it;
`docs/OFFLINE.md` covers what the other engine sends.

---

## The one duplication, and how it is kept honest

Stock status and expiry bucket are expressed twice: in `domain/` for scoring and
display, and in SQL so ten thousand rows can be filtered without loading them.
Filtering in JavaScript would defeat pagination outright.

Two things stop the copies drifting. Both are built from the *same* exported
constants, so the thresholds exist once. And
`repositories/sql/status-expressions.test.ts` runs both implementations over 312
combinations of quantity, minimum and ideal, plus every expiry boundary, and
demands identical answers. Change one without the other and the build fails.

---

## Pagination

Keyset, not `OFFSET`. Page forty of a ten-thousand-item inventory would otherwise
make SQLite walk and discard four thousand rows every time, and rows shift under
the reader when data changes between pages.

Nullable sort columns carry an explicit null-flag key, so non-expiring items stay
last whether the sort ascends or descends. A row-value comparison cannot express
that, which is why the cursor condition is written as an OR-chain.

---

## State

`AppContext` holds the database, the repositories, settings and the translation
function — they change together and are needed together. Component state holds
what is genuinely local: which dialog is open, what is typed in the search box.

`useAsyncData` is forty lines. A query-caching library earns its keep against a
network: deduplication, retries, background refetching. None of that applies to a
file on the same device that answers in under a millisecond. TanStack Query and
Zustand were both installed early and both removed once it was clear they were
carrying nothing.

Six runtime dependencies: `react`, `react-dom`, `react-router-dom`, `zod`,
`@sqlite.org/sqlite-wasm`, and `@capacitor/core`. The last one arrived with
voice control: `services/speech/capacitor.ts` needs `registerPlugin` to reach
the Android speech plugin, so the package is now bundled into the web build as
well, where `Capacitor.isNativePlatform()` answers false and nothing else in it
runs. It was already a dependency of the Android build; what changed is that
application source imports it.

---

## Rendering and styling

CSS Modules over design tokens. No CSS framework, no component library, no icon
package. The charts are HTML and CSS rather than SVG or a charting library —
horizontal bars are rectangles with text beside them, they reflow on a phone
without viewBox arithmetic, and every label is real selectable text.

Icons are inline SVG. Unicode glyphs were the first attempt and were wrong:
U+270E PENCIL has an emoji presentation, and Windows rendered a full-colour
pencil in the middle of a monochrome toolbar. The U+FE0E variation selector could
not fix it, because the font has no text glyph to fall back to.

---

## Errors

Every failure has a user-readable answer, and technical detail is available but
never primary.

- A failure inside the data layer becomes a `SqlError` carrying the SQLite result
  code. It reduces extended codes to their primary code — comparing 1555 against
  `SQLITE_CONSTRAINT` (19) silently never matches, which is exactly how a
  corruption check ends up never firing.
- A failure during start-up becomes a typed outcome, not an exception: insecure
  context, locked by another tab, corrupt, schema newer than the code. Each gets
  its own explanation and its own way forward, and every one that can offers to
  export a backup. None offers to reset.
- A failure during rendering hits the error boundary, which says plainly that
  nothing was changed — the user's real question when the screen goes blank.
