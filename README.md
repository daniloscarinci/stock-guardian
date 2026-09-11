# Stock Guardian

**Offline Preparedness & Resource Management**

### → **https://daniloscarinci.github.io/stock-guardian/**

Open that once on any phone or computer and install it. After that it runs with
no internet, no account and no server — nothing needs to be switched on.

Track emergency supplies, food, water, medical stock, tools and equipment. The
application runs entirely on your device. As it arrives it makes no network
request of its own, needs no account, and keeps working with the radio off —
which is the point, because the situations it exists for are the ones where the
internet is not there. That is the default, it is what you get by changing
nothing, and the build still proves it.

One thing sits outside it, and it is off until you switch it on: the **AI
assistant**, which needs an Anthropic API key you paste in yourself. It is
described below. Your database is never uploaded by it — see **The AI
assistant** for exactly what a question sends.

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

**Reminders that arrive with the app shut.** *Android only, and off until you
switch it on.* The expiration centre answers "what is running out" whenever you
look. The point of a preparedness store is that you do not look for months, so
the Android build can also tell you: one notification your first warning window
before each expiry date, and one on the day itself, in your own language and
naming what it is about — *"3 itens vencem em 7 dias — Leite, Iogurte, Pão"*.
Ten things expiring on one date are one notification naming three of them and
counting the rest, never ten buzzes. Tapping it opens the expiration centre.

How it works is worth knowing, because it decides what it can and cannot do. A
web view cannot wake up on its own, so nothing runs in the background here.
Instead the whole schedule is worked out **in advance** — the text of every
notification is decided and handed to Android with the date it should appear —
and worked out again from scratch every time you open the app. So a phone left
untouched for three months still delivers everything that was planned on your
last visit, and picks up anything new the next time you open it. There is no
watcher, and this page will not pretend there is one.

Android asks for permission the first time you switch it on, in **Settings →
Expiry reminders**, and never at startup. Refuse and nothing is scheduled and
nothing asks again. `docs/ANDROID.md` lists the handful of things that can stop
a notification arriving.

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

**Ask about your stock.** Say or type *"quanto arroz eu tenho?"* into the sheet
behind the header button and read the answer. Say *"usei 3 ovos"* and the stock
moves, with **Desfazer** offered for ten seconds; say something the application
had to guess at, and a card appears saying what would change — and changes
nothing until you press **Confirmar**. It works in all three languages.

It also makes things the inventory did not have. *"novo lugar, porão"* makes a
place, *"nova categoria, ferramentas"* makes a category, and *"novo contato ana
telefone 555 1234"* makes an emergency contact, with the number read back as
digits rather than added up as a quantity. And a move to a shelf that does not
exist yet no longer stops there: the same card offers to make the shelf, in one
press, with an undo that takes back the move and the shelf together.

Five things about it belong here rather than in a footnote.

*The microphone tries your phone first, every time, and uses the internet only
when your phone could not.* It sits in the sheet next to the box. Every press
asks the phone's own recognizer to transcribe with no network, which is what
happens on a phone that has the language installed — nothing leaves, and it
works with the radio off. Where that attempt fails and the phone has a
connection, it tries once more without the offline requirement: the system
recognizer sends the recording away to transcribe it, on most phones to Google,
and **the answer is marked "Transcribed online"** in the log so you can see
which presses left the device.

That fallback exists because the absolute version did not work. On the
Portuguese phone this was built for there is no offline pack, the recognizer
refused every request, and the button appeared dead. Twice. Failures that still
happen are named rather than silent, and the one that can be fixed comes with a
panel holding the install path and the way back to the typed box.

*Android asks you for the microphone, and it did not use to.* This section used
to say the application never requested that permission, and the design behind
the claim was real: speech went through `ACTION_RECOGNIZE_SPEECH`, Google's own
voice search screen opened, the system held the microphone, and this application
was handed a sentence it had not recorded. Nothing to ask for, nothing to
refuse.

It is abandoned because on the phone this application exists for — a moto g35
5G — that screen never opens. Android answers *"Voice search isn't available"*:
the component behind the Intent is not on the device. Four releases went into
that wall, including a retry that knocked on the same door. What ended the
argument was the keyboard: **voice typing works perfectly on the same phone**,
which means the phone can transcribe and simply will not do it when asked that
way. The keyboard does not fire the Intent — it binds the speech service
directly, and that is what this application does now. Binding it means recording
here, and recording here means `android.permission.RECORD_AUDIO`.

Android asks you the first time you press the microphone and never at startup.
Say no and the button says so and points at the typed box; say no twice and
Android stops asking, so the panel offers the app's own settings page instead of
prompting into a void. Typing is the same feature either way, and nothing about
the stock database changed: it still never leaves the phone.

If you want the absolute version anyway, **Settings → Ask → Transcribe on this
device only** restores it in one press: no second attempt, ever, and a language
with no offline pack simply will not transcribe. It is off as shipped, and
nothing in the application ever turns it on or off for you.

*Answers are read aloud.* **Settings → Ask → Read answers aloud** uses the
system voice and is on by default. On Android the silent switch on the side of
the phone wins over the setting. Speaking is not listening: it opens no
microphone, asks for no permission and sends nothing anywhere.

On Android it now works. Until this release that setting was on, the phone said
nothing, and no error was raised anywhere: the WebView exposes the browser's
speech synthesis API without implementing it. The app speaks through the phone's
own engine instead, which also means **Settings → Ask → Which voice** finally has
something in it — the real voices installed on the device, on-device ones
preferred over any synthesised on a server.

*It says hello when you open it.* One sentence — the time of day, then the one or
two things that need doing. *"Bom dia. 3 itens vencem hoje."* When nothing needs
doing it says so and stops. Once per launch, never over an answer you asked for,
never when the phone is on silent, and off in one press at **Settings → Ask → Say
hello when the app opens**.

*Two engines answer the same box.* Twenty-two rules run on the device — exact,
instant and free — and Claude answers instead when you have switched the
assistant on and pasted a key. Every exchange says which one answered, because
one of them costs money per question and the other does not.

`docs/VOICE.md` lists every phrase the offline engine understands, in all three
languages, and every one it deliberately refuses.

**The AI assistant.** Paste an Anthropic API key of your own into Settings and
you can ask about your stock in ordinary language, rather than in the phrases
the engine above knows. Anything it proposes changing still arrives as a card
that changes nothing until you confirm it. With no key, the feature does not
run: no request, no connection, nothing sent.

*What a question sends, exactly.* Three things. The sentence you typed. The
results of whichever tools Claude asked to run. The answer that comes back.
Claude is handed a set of functions rather than your data — find an item, what
is expiring, what is below its minimum — and it picks the ones it needs; the
application runs those against the database on this device and returns only what
they answered. Asking about rice sends the rice row. **The inventory is never
uploaded**, on the first question or the thousandth, and a pantry of four
hundred items sends no more than a pantry of four.

*It is your key and your bill.* The key is stored on the device like any other
setting, nothing is compiled into the build, and every question is charged to
the account that key belongs to.

*Offline is the fallback, not a casualty.* With no key, or the assistant
switched off, the same box runs those rules and nothing is sent. So does a
question that Claude could not answer — no signal, a refused key, too many
questions at once — and the exchange says which of those it was rather than
quietly pretending the assistant was never on. `docs/OFFLINE.md` sets out what
travels, what does not, and what enforces which.

---

## Your data

Everything lives in a SQLite database on your device, in the browser's Origin
Private File System. No copy of it is sent anywhere: there is no account, no
sync and no server holding one. The AI assistant, if you give it a key, sends
the rows a question asked about — never the database.

Two things are worth knowing:

**Ask for persistent storage.** Settings → Diagnostics shows whether the browser
has promised to keep your data when the device runs short of space, and lets you
ask for that promise. Installing the app makes it far more likely to be granted.

**Export a backup now and then.** Browsers can clear storage — iOS is known to
clear non-persisted sites after about a week of not being opened, which for an
application you might not touch for months is a real risk. Settings → Backup
writes a file to your device. Keep one somewhere you trust.

---

## Installing it on a phone or computer

Open **https://daniloscarinci.github.io/stock-guardian/** once, then:

| Device | How |
|---|---|
| **iPhone / iPad** | Safari → Share → *Add to Home Screen* |
| **Android** | Chrome → menu → *Add to Home screen* |
| **Windows / macOS** | Chrome or Edge → the install icon in the address bar |

On **iOS this is worth doing properly rather than just bookmarking**. Safari
clears storage for sites that are not installed after roughly seven idle days,
and for an application you might not open for months that is a real way to lose
data. An installed app is far more likely to keep its storage.

After installing, the page never needs to be visited again. The app is on the
device.

### Android can install a real app instead

Android also runs Stock Guardian as an installed application with its own icon,
built from the same source and carrying every asset inside the file. It needs no
network even on first launch, and it keeps Android's automatic backup switched
off, so the database never reaches Google Drive.

It asks the operating system for two permissions and no others.
`android.permission.INTERNET`, so the AI assistant can reach Anthropic with your
key — leave the key blank and the application opens no connection at all. And
`android.permission.RECORD_AUDIO`, for the microphone in the ask box, requested
the first time you press it rather than at startup.

Both are changes, and both were argued for one at a time. The APK used to ask
for nothing at all, which was the better sentence. `INTERNET` went first because
Android offers no narrower way to reach one host. `RECORD_AUDIO` went second
because the permission-free path it replaces — handing recording to Google's
voice search screen — does not work on the phone this was built for, while the
keyboard's voice typing on that same phone does. The reasoning in full is in
`docs/ANDROID.md`.

So the build's check was narrowed rather than dropped, twice. It allows exactly
those two names and fails on every other — camera, location, contacts, storage —
and you can run it yourself against a built APK.

`docs/ANDROID.md` explains how to produce the APK and what to check after
installing it. Nothing else here changes: the phone still holds its own database,
and backups still move between devices as a file.

### Two things that will not work, by design

**A plain `http://` address on your home network.** Browsers do not grant
storage outside a secure context, so the application refuses to start with "This
page cannot store data" rather than appearing to work and losing what you type.

**Opening `index.html` from a folder.** Same reason.

### Each device keeps its own data

There is no cloud and no account, so nothing syncs. Your dad's phone and his
computer each hold their own database. To copy between them: **Settings → Backup
→ Export** on one, move the file however you like, **Import** on the other. The
import shows you what the file contains and asks before writing anything.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build, then the offline audit |
| `npm run preview` | Serve the production build locally |
| `npm test` | The 2278-test unit suite |
| `npm run smoke` | Drive the production build in a real browser (needs Edge or Chrome) |
| `npm run typecheck` | TypeScript, strict |
| `npm run lint` | ESLint |
| `npm run generate:catalog` | Re-extract the 194 catalog items from the original HTML |
| `npm run generate:icons` | Regenerate the app icons |
| `npm run generate:android-icons` | Regenerate the Android launcher and splash artwork |
| `npm run generate:android-key` | Create the Android signing key — once, ever |
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
| `docs/VOICE.md` | The ask box: the microphone, the phrases, and every limit |
| `docs/BUILD.md` | Building, hosting, and the desktop build |
| `docs/ANDROID.md` | The Android app: building, signing, installing |
| `docs/TESTING.md` | What is tested, and how to run it |
| `docs/CHANGELOG.md` | What changed from the original |

---

## What is not built yet

Stated plainly, because the alternative is an interface full of buttons that do
nothing. Nothing in this list appears in the application as a disabled control or
a "coming soon" panel — if it is not built, it is not shown.

- **Speech input on every browser.** The microphone needs a recognizer this
  application can ask about locality, so that it can insist on the on-device
  attempt first. Chrome exposes one and Android has its recognition service;
  Safari and Firefox offer a networked-only API with no such control, and one
  that cannot be questioned is not used. There the typed box is the way in, and
  it always was.
- **The desktop build, proven.** The code is the same, but `src-tauri/` has
  still never been compiled, so nothing here has been seen running in that
  webview.
- **An open conversation without a key.** The offline engine answers the phrase
  forms listed in `docs/VOICE.md`. Anything else comes back as "I did not
  understand that" with examples beside it, never as a guess — and it has no
  memory between sentences, so "and two more" refers to nothing. Ordinary
  language is what the AI assistant is for, and it needs your own API key.
- **Memory between sessions, for the assistant.** Each question starts fresh.
  What you can see in the history is for you to read, not something the model
  is given back.
- **Deleting, archiving or changing a setting from the box.** The box reads the
  inventory; it changes quantities, expiry dates, minimums and targets; it moves
  items; and it creates items, places, categories and contacts. It deletes
  nothing and archives nothing, by either engine, except the **Desfazer** that
  takes back a row a sentence has just made. Settings are a screen, and so is
  everything a spoken sentence cannot say: a parent shelf, a colour, a sort
  order, notes, a priority — and renaming any of it afterwards.
- **Photographs.** The database stores them; there is no interface for adding
  them yet.
- **Barcode scanning.** A barcode can be typed in and is searchable. Scanning
  with a camera is not built.
- **Application lock.** Not built.
- **Reminders on the website.** The Android app schedules them; a browser tab
  cannot. A page that is closed cannot be woken to work out what expired, and a
  notification that only arrives while you are already looking at the app is not
  a reminder. On the web the expiration centre is the answer, and it is the same
  screen the Android notification opens.
- **A phone that has run the Android APK.** The APK is built and signed by
  GitHub Actions on every version tag, and the releases page has carried one
  since v2.2.0 — this line said none existed for four of those releases, which
  was wrong. What is still true is the part that matters: no phone has been
  seen running one. `docs/ANDROID.md` lists what to check on the first install.
- **A machine that has run the desktop application.** As of v2.6.0 the Windows
  installers are built on a runner carrying the Rust toolchain this machine does
  not have, and attached to the release — so `.exe` and `.msi` now exist, and
  `src-tauri/` has been compiled for the first time. Compiling it found two
  faults a year of review had not: a missing icon, and a `rusqlite` feature the
  export line needed. **Nobody has installed or run the result.** The Tauri
  SQLite driver is a different driver from the one the phone and the browser
  use, and it has still never executed against a real database. `docs/BUILD.md`
  lists what to check before trusting it with anything.

---

## Licence and privacy

Your inventory is yours. The application collects nothing about you, contains no
analytics and no telemetry, and reports to nobody. It sends nothing at all until
you give the AI assistant a key of your own, and then it sends only your
question, the rows Claude asked a tool for, and nothing else — the database is
never uploaded. One host is reachable, `api.anthropic.com`, from one module, and
the build fails if any other external URL appears in the output.
