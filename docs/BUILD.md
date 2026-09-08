# Building and hosting

## Requirements

Node 22 or later, and nothing else. Verified on Node 24.13.0 with npm 10.2.1.

```bash
npm install
```

---

## Commands

```bash
npm run dev          # development server, hot reload, http://localhost:5173
npm run build        # production build → dist/, then the offline audit
npm run preview      # serve dist/ at http://localhost:4173
npm test             # 956 unit tests
npm run smoke        # drive the production build in a real browser
npm run typecheck    # TypeScript, strict
npm run lint         # ESLint
```

`npm run build` runs four steps in order: regenerate the catalog from the
original HTML, typecheck, build, then audit `dist/` for external references. Any
of the four can fail the build.

The audit allows exactly one external host, `https://api.anthropic.com`, named
from exactly one module, `src/services/ai/client.ts`, so that the AI assistant
can use a key the user pastes into Settings. Every other external URL fails, and
so does that host from any other module. `docs/OFFLINE.md` explains how the rule
is written and what it cannot see.

---

## What a build produces

```
dist/
  index.html
  manifest.webmanifest
  sw.js                        the service worker
  favicon.svg  icons/
  assets/
    index-*.js                 ~530 KB   (154 KB gzipped)
    index-*.css                ~29 KB    (6 KB gzipped)
    sqlite.worker-*.js         ~218 KB
    sqlite3-*.wasm             ~865 KB   (406 KB gzipped)
```

Around 1.85 MB precached. The wasm binary is most of it, and it is not optional:
without it the database cannot open.

---

## Hosting

The build is static files. It needs no server-side anything — but it does need to
be *served*, over `https://` or from `localhost`. A page opened directly from a
folder gets no persistent storage, and the application refuses to start rather
than losing your data silently.

### On your own machine, over the local network

Nothing is published anywhere; the phone installs from the computer.

```bash
npm run build
npx vite preview --host
```

Note the network address it prints (something like `http://192.168.1.x:4173`) and
open it on the phone, on the same Wi-Fi.

**This does not work, and it is worth knowing exactly why.** A bare `http://`
LAN address is not a secure context, and OPFS is unavailable outside one — so
the application does not merely fail to install, it refuses to start:

```
isSecureContext      : false
OPFS API available   : false
→ "This page cannot store data"
```

That refusal is deliberate. Appearing to work and then losing everything the
user typed would be far worse. Use HTTPS — the deployed site described below, or a
local certificate.

### On a static host — this is what is deployed

Live at **https://daniloscarinci.github.io/stock-guardian/**, published by `.github/workflows/deploy.yml` on every push to
`main`.

The workflow runs the test suite, builds with `VITE_BASE=/stock-guardian/`, and
publishes `dist/`. Building in CI rather than committing the output means the
published site cannot drift from the source, and `npm run build` fails on any
external URL in the output but the one host the assistant needs — so what is
left of the offline guarantee is checked on every deploy.

Any other static host works the same way — Netlify, Cloudflare Pages, a plain
nginx. Upload `dist/`. No rewrite rules needed: routing uses a hash router
precisely so a reload or a shared link needs nothing from the server.

For a subdirectory, set the base path:

```bash
VITE_BASE=/stock-guardian/ npm run build
```

**On Windows in Git Bash, prefix that with `MSYS_NO_PATHCONV=1`.** MSYS rewrites
any value that looks like a POSIX path, silently turning `/stock-guardian/` into
`/Program Files/Git/stock-guardian/` and producing a build whose asset paths are
all wrong. PowerShell and CI are unaffected.

Your inventory is *not* published by doing this. The application code goes on the
internet; your data stays in your browser. No API key is compiled into a build
either — the assistant's key is pasted in on each device and stored there, so
the same published site, and the same APK, is safe to hand to anybody.

### Over local HTTPS

For a home server with a certificate, serve `dist/` from any static web server.
Add `Content-Security-Policy: frame-ancestors 'none'` as a response header if you
can — it is the one directive a `<meta>` tag cannot deliver.

---

## Installing it

Per-device steps are in the README, alongside the URL people actually need.

---

## The Android application

Built by GitHub Actions, not here: the Android SDK is several gigabytes and this
machine has none. `VITE_TARGET=android npm run build` produces a web build with
no service worker, Capacitor wraps it, and the workflow signs the APK and
attaches it to a release.

The APK declares one permission, `android.permission.INTERNET`, for the AI
assistant and nothing else. The workflow allows that one name and fails the
build on any other, so the check that used to prove "no permissions" now proves
"this one and no more". See `docs/ANDROID.md`.

**No APK has been produced yet.** `docs/ANDROID.md` covers the signing key, the
tag that triggers a build, and what to check on the first install.

---

## The desktop application

**Not built. No installer exists, and none is claimed.**

`src-tauri/` is complete and reviewed but has never been compiled: this machine
has no Rust toolchain. What follows is what to do, not a report of what was done.

### Setting it up

1. Install Rust from <https://rustup.rs>.
2. Install the Tauri prerequisites for your platform —
   <https://tauri.app/start/prerequisites>. On Windows that means the Microsoft
   C++ Build Tools and the WebView2 runtime.
3. Add the tooling this repository does not carry:

   ```bash
   npm install -D @tauri-apps/cli
   npm install @tauri-apps/api
   ```

   Then delete `src/database/tauri/tauri-api.d.ts`, which exists only to keep the
   project typechecking without that package.

4. Build:

   ```bash
   npm run tauri build
   ```

Installers land in `src-tauri/target/release/bundle/` — `.msi` and `.exe` on
Windows, `.dmg` on macOS, `.AppImage` and `.deb` on Linux.

### Check these first

Nobody has run this code. Before trusting it with real data:

- The five commands round-trip — `db_select`, `db_exec`, `db_exec_script`,
  `db_batch`, `db_export`.
- `db_batch` genuinely rolls back when one operation fails. This is the one that
  matters: the import path depends on it.
- Migrations apply to a fresh native database and `PRAGMA user_version` lands at
  the expected number.
- `journal_mode` reads back as `wal`. The desktop build can use WAL, which the
  browser cannot.
- Named parameters bind with and without their leading colon.
- The database file appears in the OS application-data directory and survives a
  restart.

The unit suite already covers the SQL itself, since all three drivers share it.
What needs proving is the transport.

### Why not `tauri-plugin-sql`

It exposes `execute`, `select` and `close` — no transaction API — and it manages
a sqlx *connection pool*, so `BEGIN` issued through it gives no guarantee that
the following statements land on the same connection. For an application where an
import must be all-or-nothing, that is disqualifying. Its `$1` placeholder
dialect would also have split the one set of SQL the browser and desktop builds
share.

`src-tauri/src/db.rs` is about 200 lines of rusqlite behind a single
`Mutex<Connection>` instead, and the TypeScript side is 80 lines of transport,
because transaction semantics already live in `createDriver`.

---

## Regenerating what is generated

```bash
npm run generate:catalog   # 194 items ← backup/End_of_world_V11-Pro_Upgraded.html
npm run generate:icons     # PNG icons and the favicon
npm run generate:sample    # fixtures/sample-backup.json

npm run generate:android-icons   # android/ launcher and splash resources
npm run generate:android-key     # the release signing key - once, ever
```

The first three outputs are committed, and so are the Android icons. The signing
key is not, and must never be: see `docs/ANDROID.md`.

 The catalog script asserts exactly 194 items
across 9 categories and fails otherwise, so the reference data cannot silently
shrink.

---

## Reproducing a build

```bash
git clone https://github.com/daniloscarinci/stock-guardian.git
cd stock-guardian
npm install
npm run build
```

There are no undocumented steps, no environment variables to guess, and no
network access needed beyond `npm install`. `package-lock.json` is committed.
