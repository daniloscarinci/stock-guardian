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
npm test             # 363 unit tests
npm run smoke        # drive the production build in a real browser
npm run typecheck    # TypeScript, strict
npm run lint         # ESLint
```

`npm run build` runs four steps in order: regenerate the catalog from the
original HTML, typecheck, build, then audit `dist/` for external references. Any
of the four can fail the build.

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

One caveat: most browsers treat a bare `http://` LAN address as insecure, so the
service worker will not install. It is fine for trying the app out. For a real
install, use one of the two below.

### On a static host

Any host works — GitHub Pages, Netlify, Cloudflare Pages, a plain nginx. Upload
`dist/`. No configuration, no rewrite rules: routing uses a hash router precisely
so that a reload or a shared link needs nothing from the server.

For a subdirectory, set the base path:

```bash
VITE_BASE=/stock-guardian/ npm run build
```

Your inventory is *not* published by doing this. The application code goes on the
internet; your data stays in your browser.

### Over local HTTPS

For a home server with a certificate, serve `dist/` from any static web server.
Add `Content-Security-Policy: frame-ancestors 'none'` as a response header if you
can — it is the one directive a `<meta>` tag cannot deliver.

---

## Installing it

Load the page once over https or localhost, then:

- **Chrome / Edge desktop:** the install icon in the address bar.
- **Android Chrome:** menu → *Add to Home screen*.
- **iOS Safari:** Share → *Add to Home Screen*. On iOS this is worth doing for
  more than convenience — an installed app is far less likely to have its storage
  cleared.

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
```

All three outputs are committed. The catalog script asserts exactly 194 items
across 9 categories and fails otherwise, so the reference data cannot silently
shrink.

---

## Reproducing a build

```bash
git clone <repository>
cd stock-guardian
npm install
npm run build
```

There are no undocumented steps, no environment variables to guess, and no
network access needed beyond `npm install`. `package-lock.json` is committed.
