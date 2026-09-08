# Offline operation

Stock Guardian makes no network request of its own. Not "few", not "only for
updates" — none. That is what it does when you change nothing, it is what ships,
and it is still enforced. This page describes how, because a promise like this
erodes by accident: one webfont, one analytics snippet, one CDN fallback added
while debugging.

One thing sits outside it. It is off until a person switches it on, it is set
out in full below, and it does not put your database on a network.

**Asking Claude.** Paste your own Anthropic API key into Settings, switch the
assistant on, and a question you type goes to `api.anthropic.com`. This is the
only request in this project that the application itself makes, and *The AI
assistant* below says precisely what is in it. With no key stored, the assistant
does not run, opens no connection and sends nothing.

**There used to be three.** Downloading a speech pack and sending recorded
speech to Google were the other two, and both went with the microphone - see
*Speech* below. Nothing replaced them: this application no longer has any way to
open a microphone or to send audio anywhere.

Leave the assistant alone and nothing in the application, on any platform,
reaches the network at all. Your database is never uploaded even when you do not:
the assistant sends the rows a question asked about and never the file they came
from.

---

## Verified, not asserted

Three checks run on the real build.

**The build audit.** `npm run build` runs `scripts/audit-offline.mjs` over
`dist/` and fails on any external reference. HTML, CSS, SVG and the manifest are
scanned for any external URL; JavaScript is scanned with comments stripped for
constructs that actually fetch — `fetch()`, `importScripts()`, `new Worker()`,
`.src =`, `sendBeacon()` and the rest. Bundled libraries carry URLs in licence
headers and error messages, and flagging those would produce noise everyone
learns to ignore, which is worse than no check.

It allows exactly one host, `https://api.anthropic.com`, and exactly one module
to name it, `src/services/ai/client.ts`. Everything else external still fails
the build, and so does that host used from any other module. *The AI assistant*
below sets out how the rule is written and what it cannot see.

It also carries a rule that reads `src/` instead of `dist/`, for the
`SpeechRecognition` identifier — which is now permitted in no module at all.
That rule, why it was kept after its subject was deleted, and what it cannot
catch, are set out under *Speech*.

**The Content-Security-Policy.** `index.html` declares `default-src 'self'`, so
the browser itself refuses any off-origin request. The single exception is
`connect-src 'self' https://api.anthropic.com`, which lets the assistant reach
that one host and no other: a script, a style, a font or an image from anywhere
but this origin is still refused by the browser, whatever the code asks for.
`'wasm-unsafe-eval'` is present because instantiating the SQLite module needs
it; it grants nothing else. `frame-ancestors` is deliberately absent: it is
ignored in a `<meta>` element and would look like protection while providing
none. Set it as a response header if you host this somewhere that can.

**The browser test.** `npm run smoke` loads the production build, waits for the
service worker, cuts the network, hard-reloads, and asserts that the dashboard
comes back and the inventory is still readable.

---

## How it works

**Everything is bundled.** No CDN, no Google Fonts, no remote anything.
Typography uses system font stacks: a webfont is a network request, and this must
render identically with the radio off. Icons are inline SVG. The charts are HTML
and CSS. The SQLite WebAssembly binary — 865 KB — is emitted as a local asset and
precached.

**A hand-written service worker.** `src/sw.ts` precaches the build manifest and
serves cache-first. Cache-first rather than network-first because every asset is
immutable and content-hashed: there is nothing to be fresher about, and
network-first would make behaviour depend on whether the radio happened to be on.

It is written out rather than generated for two reasons. That file *is* the
offline guarantee and should be readable in one sitting. And the generated
alternative could not be built here at all — this project's path contains an
apostrophe, and workbox's template writes absolute module paths into
single-quoted strings, producing a worker that will not parse.

Assets are precached one at a time rather than through `addAll`, which rejects
the whole batch if any single request fails and would leave the worker installed
with nothing cached.

**Updates are prompted, never automatic.** Swapping the service worker while a
write transaction is open against a single-connection database invites trouble.

**On Android, the APK plays that part.** The installed application carries every
asset inside the package, so it has nothing to fetch and no cache to keep warm,
and the Android build ships no service worker at all. The first launch works
with the radio off, the same as the thousandth. The audit above still runs over
the same `dist/`, so the guarantee is enforced identically either way.

**That APK now declares `INTERNET`, and it used to declare nothing.** The
sentence it cost was a good one, so it is worth saying exactly what replaced it.
A key the user pastes in is worth nothing unless the application can reach
Anthropic with it, and Android has no permission narrower than `INTERNET`, no
per-host form of it, and no way to hold it only while a feature is on. So it is
declared once, in `AndroidManifest.xml`, with the reasoning beside it.

The check in `.github/workflows/android.yml` was narrowed rather than deleted.
It allows `android.permission.INTERNET` and the one permission androidx
namespaces under this application's own id, and it fails the build on every
other: `RECORD_AUDIO`, `CAMERA`, location, contacts, storage, and whatever a
future dependency merges in. Run it yourself against a built APK — the command
is in `docs/ANDROID.md` — and it prints `android.permission.INTERNET` and
nothing else. That is a weaker sentence than "it asks for nothing", and it is
still a sentence a machine checks on every build rather than one you have to
believe.

Voice control never needed any of this, and no longer exists to need it. The
manifest has lost the `queries` element that let the old plugin see the system
recognizer, and there is still - and now permanently - no `RECORD_AUDIO`. See
`docs/ANDROID.md`.

---

## The AI assistant

The one feature that sends anything of yours anywhere. The rest of this page
exists so that this section can be short and exact.

### What travels

Three things, and only these three.

**The question you typed**, in your words, as you wrote it.

**The results of the tools Claude asked for.** Claude is handed a list of
functions it may call — find an item, what is expiring, what is below its
minimum, what the locations are — and it chooses. The application runs the ones
it chose against the SQLite database on this device and returns what they
answered. A question about rice sends the rice row. A question about what
expires this month sends the rows that expire this month.

**The answer**, coming back.

Your key travels too, in the header that authenticates the request. It goes to
Anthropic and nowhere else.

### What does not

**The inventory.** Not on the first question and not on the hundredth. That is a
property of how the feature is built rather than a rule it obeys: nothing
anywhere assembles your database into a prompt, because tool use never needed
one. The amount that leaves is set by the question, not by how much you own, and
a person with four hundred items sends no more than a person with four.

Nor your locations, your contacts, your backups or your settings, except where a
tool was asked a question whose answer is one of those rows.

### The default, and it is the shipping default

The stored key is empty in a fresh install and nothing fills it but a person
typing into Settings. With no key there is no client, no request and no host to
reach, and the application behaves exactly as it did before this feature
existed. Clearing the key puts it back. Every claim on this page about an
application that touches no network is a claim about that state, and that state
is what you get by doing nothing.

### What enforces it

The same three gates as everything else, each narrowed to this one thing and
each still failing on the rest.

**The Content-Security-Policy.** `connect-src 'self' https://api.anthropic.com`.
One host is named; every other origin is refused by the browser itself, before
any code of ours runs. Nothing was loosened to make room for it — scripts,
styles, fonts and images are still `'self'`.

**The build audit.** `scripts/audit-offline.mjs` permits that host, and permits
exactly one module to name it: `src/services/ai/client.ts`. The same host used
from a second module fails the build, by name. Every other external URL fails
as before.

Where it looks is not arbitrary. In `dist/` the host passes only inside a
`connect-src` line — a policy naming a host is not a request to it, and an
`<img src>` pointing at the same host still fails. In bundled JavaScript it
passes wherever it appears, because the Anthropic SDK is merged into the same
chunk as everything else and by then no module can be told from any other. So
"exactly one module" is checked where modules still exist, in `src/` — the same
reasoning that put the `SpeechRecognition` rule there, only sharper.

Wiring the assistant into the interface put the SDK into the bundle for the
first time, and with it the SDK's own URLs: `docs.anthropic.com` and
`github.com/anthropics/...` in error messages, `platform.claude.com` in
deprecation notices. The audit passes all of them and is right to. None sits in
a construct that fetches; they are sentences a library prints when something
goes wrong, and a check that flagged them would be a check everyone learned to
ignore. What the audit still catches is a URL in a `fetch()`, a `new Worker()`,
a `.src =` — the shapes that actually cause a request.

**Settings links to `console.anthropic.com`**, where a key comes from. A link is
not a request: nothing is fetched from that host, it appears in no reference
format, and following it is a navigation the person chooses.

**The Android permission gate.** The APK declares `INTERNET`; the workflow
allows that one name and fails on every other permission. Set out above under
*How it works*, and in `docs/ANDROID.md`.

### What it cannot promise

Stated rather than glossed, in the manner of the rest of this page.

- **What happens to a question after it arrives is Anthropic's business, not
  this repository's.** This project can tell you exactly what it sends and can
  prove where it may send it. It cannot make any promise about the other end,
  and does not.
- **The audit is a text match.** The SDK reaches that host by default without
  being told to, so a second module that builds a client without naming a URL is
  invisible to the source rule. The Content-Security-Policy still binds the
  whole page to one host and the Android gate to one permission, so the shape of
  what could go wrong is "a second place in this codebase talks to Anthropic",
  never "this application talks to somewhere else".
- **Your key sits at rest on the device**, in the settings table, alongside
  everything else. Anyone who can unlock the phone can reach it, and a debug
  build is readable over a cable. Revoking a key is done at Anthropic, not here.
- **Questions cost money**, on the key holder's account, per question.

---

## Speech

**There is no speech input in this application, and there was.** It is worth a
chapter rather than a deletion, because for a while it was the one feature that
could have quietly undone everything above, and the checks written against it
are still running.

Voice control shipped with three recognizers behind one seam. Android's fired
`ACTION_RECOGNIZE_SPEECH` with `EXTRA_PREFER_OFFLINE`, so the system held the
microphone and no `RECORD_AUDIO` was declared. Chrome's set `processLocally`
before every start, which fails closed. Everything else reported unavailable
rather than falling back to the API's default mode, which streams the microphone
to Google. It worked, and it did not work on the phone it was for: Android's
recognizer refuses `EXTRA_PREFER_OFFLINE` with no offline Portuguese pack
installed, and the button did nothing.

So all of it went — `recognizer.ts`, `webspeech.ts`, `none.ts`, the recording
half of the Android plugin, the install button, and **Settings → Voice → Send
your audio to Google**, which was the only control in this application that
could put a recording of anybody onto a network. `voiceAllowOnline` is gone from
the settings schema; a stored row for it is ignored rather than read, so no old
database can switch on a thing that no longer exists.

### What is left, and what still guards it

`speak.ts` reads answers aloud, and `ringer.ts` asks Android whether the phone
is silenced. Neither opens a microphone; the Android side of it is one method,
`isSilent`, on a plugin that needs no permission.

**The audit rule stayed and its allowance became `null`.** `scripts/audit-offline.mjs`
used to fail the build if the identifier `SpeechRecognition` appeared in `src/`
anywhere but `webspeech.ts`. That file is gone and the rule is not: the
identifier is now permitted **nowhere**, and any reappearance of it fails the
build. The hazard did not move when the file did — the browser API is still
there, still streams audio in its default mode — and the way it would come back
is somebody adding speech input again in good faith, in a build whose only check
for it had been retired as unused.

What it cannot catch is unchanged: it is a text match on one spelling over
source files, so a name assembled at runtime passes it. It catches the second
use site somebody adds on purpose, which is the failure that actually happens.

**The Content-Security-Policy still refuses.** `connect-src 'self'
https://api.anthropic.com` names one host, and it is not a speech service. An
implementation that shipped audio somewhere itself would have nowhere to send
it.

**The APK still declares no `RECORD_AUDIO`.** It never did, and now there is
nothing that could want it. `.github/workflows/android.yml` fails the build on
that name along with every other permission but `INTERNET`.

### Reading answers aloud

`speechSynthesis` is a system service and `speak.ts` fetches nothing. But the
Web Speech API offers server-synthesised voices alongside on-device ones, and on
a desktop browser the remote voice is often both first in the list and the
better-sounding one. Choosing it would send the sentence — which names what is
in your pantry — to a synthesis service.

`speak.ts` therefore names a voice only when `SpeechSynthesisVoice.localService`
is true for the requested language, and otherwise names none at all, leaving
`lang` to the platform. Three tests pin it, including one asserting that a
remote voice listed ahead of a local one is still not chosen.

This is a best effort, not a guarantee: with no local voice installed, the
platform may still resolve `lang` to a remote one, and the API offers no way to
refuse. On Android the system voice is on the phone. **Settings → Ask → Read
answers aloud** switches it off, and that remains the only certain answer. On
Android the silent switch on the side of the phone wins over the setting, which
is what `ringer.ts` is for.

---

## Where your data lives

A SQLite database in the browser's Origin Private File System, reached through
the `opfs-sahpool` VFS. There is no account to attach it to, no server holding a
copy, and nothing that uploads it — not a sync, not a backup, not the assistant,
which sends the rows a question asked for and never the file they came from.

`docs/ARCHITECTURE.md` explains why that VFS and not the more widely documented
`opfs` one. The short version: `opfs` needs COOP/COEP response headers that a
static host cannot set, so it would work in development and fail for every real
user.

---

## Three things that can cost you data

Stated plainly, because an application that owns the only copy of something owes
you the truth about its limits.

### A `file://` page cannot store anything

Browsers grant no persistent storage to a page opened directly from a folder. The
application detects this and **refuses to start**, with an explanation, rather
than appearing to work and losing everything you type. Serve it over `https://`
or from `localhost` — see `docs/BUILD.md`.

### The browser can clear your storage

Storage that is not marked *persistent* may be evicted when the device runs short
of space. iOS is the sharpest case: it clears non-persisted sites after roughly
seven days without a visit, which for an application you might not open for
months is a real risk rather than a theoretical one.

Two defences, both worth taking:

- **Settings → Diagnostics → Request persistent storage.** Installing the app to
  the home screen makes the request far more likely to be granted, and on iOS it
  is close to essential.
- **Export a backup now and then**, and keep it somewhere you trust. Settings →
  Backup writes a JSON file to your device.

### One tab at a time

The storage layer permits exactly one connection, which is what stops two copies
overwriting each other. A second tab is detected and told so plainly.

---

## Checking it yourself

```bash
npm run build
npm run preview
```

Open the page, then in DevTools → Application → Service Workers tick **Offline**
and hard-reload. Confirm in the Network tab that `sqlite3-*.wasm` and the worker
chunk are served **from ServiceWorker**, and that the dashboard reaches an
interactive state with your data.

Or turn off your Wi-Fi and use it.
