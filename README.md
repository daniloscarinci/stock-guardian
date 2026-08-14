# Stock Guardian

**Offline Preparedness & Resource Management**

Track emergency supplies, food, water, medical stock, tools and equipment. The
application runs entirely on your device. It makes no network requests, needs no
account, and keeps working with the radio off — which is the point, because the
situations it exists for are the ones where the internet is not there.

It is a rebuild of `backup/End_of_world_V11-Pro_Upgraded.html`, a single-file
application kept in this repository untouched as the functional baseline. Every
one of its features survives here. Its 194-item trilingual reference catalog
survives here too, item for item.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

To build and run the production version:

```bash
npm run build
npm run preview      # http://localhost:4173
```

Node 22 or later. No other prerequisite.

---

## What it does

**Inventory.** Add, edit, duplicate, archive, restore and delete items. Change a
quantity with `+` and `−` straight from the list — routine adjustments never open
a form. Move items between locations, and every movement is recorded.

**Expiry that tells the truth.** An item with no expiry date does not expire; the
original application treated a blank date as *expired* and refused to save an
item without one, so a hammer needed an invented date. Warning windows default to
7, 30 and 90 days and are yours to change.

**Stock levels.** Each item can carry a minimum and a target. Status is
Critical, Low, Adequate or Surplus, and the replenishment list tells you how much
to buy. Items with no minimum fall back to a global threshold, exactly as the
original worked — except that a threshold of zero is now possible.

**Preparedness score.** A single number, with the method and the arithmetic shown
in the interface, and the itemized list of what is missing beside it. Categories
count equally, so forty tins of food cannot hide an empty water category.

**Search that works in Portuguese and Spanish.** Typing `agua` finds *Água
Mineral*; `acucar` finds *Açúcar*. It matches partway through a word, searches
notes, barcodes, locations and category names, and searches every language at
once — so an item entered in English is still findable from a Portuguese
interface.

**Reference catalog.** The 194 preparedness items from the original, browsable
and searchable. Adding one copies it into your inventory; browsing changes
nothing.

**Locations.** A hierarchy of your own making — Property → House → Pantry →
Shelf. Filtering by a place includes everything inside it.

**Emergency contacts.** Who to reach, ordered by urgency rather than by the
alphabet. Phone numbers and email addresses are tappable, handing off to the
device's own dialler and mail app — neither is a network request.

**Reports.** Four of them — inventory, expiration, replenishment and
preparedness — each shown on screen, exportable to CSV, and printable. Printing
opens your system dialog, which can save the report as a PDF.

**Backup and restore.** Export a complete JSON backup or a CSV of your inventory.
Import a Stock Guardian backup or an export from the original application.
Nothing is written until you have seen what the file contains and chosen merge or
replace.

**Three languages.** English, Portuguese (Brazil) and Spanish, switchable at any
time. Your choice persists — the original reset to Portuguese on every reload.

---

## Your data

Everything lives in a SQLite database on your device, in the browser's Origin
Private File System. No copy is sent anywhere. There is no server to send it to.

Two things are worth knowing:

**Ask for persistent storage.** Settings → Diagnostics shows whether the browser
has promised to keep your data when the device runs short of space, and lets you
ask for that promise. Installing the app makes it far more likely to be granted.

**Export a backup now and then.** Browsers can clear storage — iOS is known to
clear non-persisted sites after about a week of not being opened, which for an
application you might not touch for months is a real risk. Settings → Backup
writes a file to your device. Keep one somewhere you trust.

---

## Installing it as an app

The browser needs to load the page once over `https://` or from `localhost` to
install it. After that it runs offline permanently.

- **Desktop (Chrome, Edge):** open the page, then use the install icon in the
  address bar.
- **Android (Chrome):** menu → *Add to Home screen*.
- **iPhone/iPad (Safari):** Share → *Add to Home Screen*. On iOS this matters for
  more than convenience: an installed app is far less likely to have its storage
  cleared.

`docs/BUILD.md` covers the three ways to serve it, including from your own
machine over the local network so nothing is published anywhere.

Opening `index.html` directly from a folder does **not** work, and the
application says so rather than silently losing what you type: browsers grant no
persistent storage to a `file://` page.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build, then the offline audit |
| `npm run preview` | Serve the production build locally |
| `npm test` | The 401-test unit suite |
| `npm run smoke` | Drive the production build in a real browser (needs Edge or Chrome) |
| `npm run typecheck` | TypeScript, strict |
| `npm run lint` | ESLint |
| `npm run generate:catalog` | Re-extract the 194 catalog items from the original HTML |
| `npm run generate:icons` | Regenerate the app icons |
| `npm run generate:sample` | Regenerate `fixtures/sample-backup.json` |

---

## Bringing data from the original application

Open the old `End_of_world_V11-Pro_Upgraded.html`, press **Export**, and keep the
`stock_guardian_backup.json` it produces. In Stock Guardian go to **Settings →
Backup → Import** and choose that file.

You will see what it holds before anything is written. Records that cannot be
read cleanly are not discarded: an unreadable quantity, a date that does not
exist, a category the original never shipped — each is kept with the item so you
can see what your old data said.

`docs/MIGRATION.md` documents every field and every edge case, and
`fixtures/legacy-stock-guardian-backup.json` is a worked example you can import
to see the behaviour for yourself.

---

## Documentation

| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | How the code is organised and why |
| `docs/DATABASE.md` | Schema, every table and column |
| `docs/MIGRATION.md` | Legacy import, field by field |
| `docs/OFFLINE.md` | How the offline guarantee is made and enforced |
| `docs/BUILD.md` | Building, hosting, and the desktop build |
| `docs/TESTING.md` | What is tested, and how to run it |
| `docs/CHANGELOG.md` | What changed from the original |

---

## What is not built yet

Stated plainly, because the alternative is an interface full of buttons that do
nothing. Nothing in this list appears in the application as a disabled control or
a "coming soon" panel — if it is not built, it is not shown.

- **Photographs.** The database stores them; there is no interface for adding
  them yet.
- **Barcode scanning.** A barcode can be typed in and is searchable. Scanning
  with a camera is not built.
- **Application lock.** Not built.
- **Notifications.** Not built. The expiration centre serves the same purpose
  when the app is open.
- **The desktop application.** `src-tauri/` is complete and reviewed, but it has
  never been compiled — this machine has no Rust toolchain. `docs/BUILD.md` says
  what to install and what to check afterwards. **No installer has been built, and
  none is claimed.**

---

## Licence and privacy

Your inventory is yours. The application collects nothing, sends nothing, and
contains no analytics, no telemetry and no third-party code that runs at
runtime. The build fails if any external URL appears in the output.
