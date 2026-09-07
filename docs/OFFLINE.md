# Offline operation

Stock Guardian makes no network request of its own. Not "few", not "only for
updates" — none. That is what it does when you change nothing, it is what ships,
and it is still enforced. This page describes how, because a promise like this
erodes by accident: one webfont, one analytics snippet, one CDN fallback added
while debugging.

Three things sit outside it. Each is off until a person switches it on, each is
set out in full below, and none of them puts your database on a network.

**Asking Claude.** Paste your own Anthropic API key into Settings, switch the
assistant on, and a question you type goes to `api.anthropic.com`. This is the
first request in this project that the application itself makes, and *The AI
assistant* below says precisely what is in it. With no key stored, the assistant
does not run, opens no connection and sends nothing.

**Downloading a speech pack.** **Settings → Speech recognition → Install** asks
the browser to fetch a model for voice control. That is the browser fetching on
an explicit press; it never happens automatically and it never appears in the
Android build.

**Sending your voice to Google.** **Settings → Voice → Send your audio to
Google** is off, and while it is off nothing about the paragraphs below changes:
the Android plugin sends `EXTRA_PREFER_OFFLINE` and `webspeech.ts` sets
`processLocally = true`, so speech is transcribed on the device or not at all.
Switched on by a person who has read the label, it permits one thing and only
one — a recognizer with no offline model for the language transcribing over the
network instead of refusing. What travels is the recorded utterance.

Leave all three alone and nothing in the application, on any platform, reaches
the network at all. Your database is never uploaded under any of them: not by
speech, which sends audio, and not by the assistant, which sends only the rows
it asked a question about.

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
`SpeechRecognition` identifier. That exception, and what it cannot catch, is set
out under *Speech*.

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

Voice control did not need any of this. The manifest gained a `queries` element,
which is package visibility rather than a permission, and the microphone belongs
to the system's recognizer, so there is still no `RECORD_AUDIO`. The online
opt-in did not need it either: when that setting is on, the audio leaves from
Google's recognizer, in Google's process, under Google's permissions, not from
here. See `docs/ANDROID.md`.

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

Voice control is the one feature in this application that could have quietly
undone everything above. The default mode of the Web Speech API streams the
microphone to Google's servers, and the ordinary way to record on Android is to
ask for `RECORD_AUDIO` and open the microphone yourself. Neither happens here.

### Three recognizers, one seam

`SpeechRecognizer` in `src/services/speech/recognizer.ts` is the second seam in
this codebase, built the way `SqlDriver` is built. Every implementation
transcribes on the device, unless the person holding it has said otherwise in
**Settings → Voice → Send your audio to Google** — which is off, and which
nothing but a deliberate press can move. Everything below describes the default,
and then says exactly what the opt-in changes.

**Android** hands the job to the system. `SpeechPlugin.java` fires
`ACTION_RECOGNIZE_SPEECH` with `EXTRA_PREFER_OFFLINE`; Android's own recognizer
records and returns text. The microphone is held by the recognizer, never by
this application, so the APK declares no `RECORD_AUDIO` — and the workflow fails
the build if any permission appears at all. `EXTRA_PREFER_OFFLINE` is a request
whose value depends on the recognizer installed, which is why the interface
calls on-device speech a capability of the device rather than a guarantee this
application can make for it. The extra is omitted — and only then — when the
opt-in has been switched on and the web layer passes `allowOnline: true`.

**Chrome** uses `SpeechRecognition` with `processLocally`, set first and on
every path, and starts only after `availableOnDevice(tag)` reports a model for
that language. `processLocally` **fails closed**: with no local model the call
errors rather than falling back to the network. That is the property that makes
the API usable here at all, and it is the reason this implementation is allowed
to exist.

It is `true` unless BOTH of two things hold: there is no on-device model for the
language, and the user has switched the opt-in on. A device that can transcribe
locally still does, opt-in or not — sending audio away when the phone could have
done the job itself would be a bug rather than a preference. And a browser that
cannot be asked about locality at all, such as Safari, is still refused: the
opt-in changes which mode a qualifying browser may use, never which browsers
qualify.

**Everything else** is `none.ts`, which reports unavailable. Safari exposes
`webkitSpeechRecognition` but not the on-device controls, so there is no way to
require local transcription and the recognizer is never constructed. That costs
the microphone on iPhone and nothing else: the typed command box is present on
every platform and is not a fallback.

### What enforces it, in the order it holds

**The Content-Security-Policy**, whose `connect-src` names one host and it is
not a speech service. An implementation that tried to ship audio to a server
itself would still have nowhere to send it. This is the structural one, and it
is why the seam is safe to have.

**`processLocally`**, inside `webspeech.ts`. The browser makes that API's
network calls itself, out of reach of the CSP, so within that implementation
this flag is the only thing standing between it and Google. `webspeech.test.ts`
asserts that it is set and that `start()` is never reached without an on-device
model — with no options, with an options object that omits the opt-in, and with
`allowOnline: false`. A further test asserts the other side: that
`allowOnline: true` is the single way past it. The guarantee did not get weaker,
it acquired one door, and there are tests on both sides of it.

**The audit rule**, and it is the weakest of the three. `audit-offline.mjs`
fails the build if the literal identifier `SpeechRecognition` — or
`webkitSpeechRecognition` — appears anywhere in `src/` outside
`services/speech/webspeech.ts`. Its limits, stated rather than glossed:

- It is a **text match on one spelling**. A name assembled at runtime, or read
  out of a variable, passes it untouched.
- It reads `src/`, not `dist/`, which is the one rule in this script that does.
  The application bundles into a single chunk, so in the built output every
  module is the same file and "permitted in exactly one module" cannot be
  expressed at all. Attributing a match back to its module would mean decoding
  the source map — the artifact this audit already declines to trust, and one a
  build setting can switch off, taking the check silently with it.
- Comments are stripped first, and test files are skipped on purpose. Prose
  about the API is not a use of it, and failing a build over a sentence teaches
  people to ignore the script.

What it does catch is the second use site somebody adds in good faith, which is
the way this promise would actually be lost.

### The two places a byte crosses the network

#### The install button

**Settings → Speech recognition → Install** appears when Chrome reports a
downloadable speech pack for the interface language. Pressing it calls
`installOnDevice(tag)` and the browser downloads the model. The line beside the
button says so — that installing downloads the pack, and that nothing of yours
travels the other way — because this page is not where the decision is made.

That is a byte crossing the network. It is the browser fetching on an explicit
press rather than the page fetching on its own, which is why the audit is right
not to flag it — and why it must never be made automatic. The pack, once
installed, is what makes transcription local afterwards.

The button never appears inside the APK. `install` is optional on the seam and
only the Chrome implementation defines one; Android speech packs belong to the
system, so Settings prints the path through Android own menus instead. Nothing
in the Android build fetches anything.

#### Sending your audio to Google

**Settings → Voice → Send your audio to Google**, stored as `voiceAllowOnline`
and `false` by default. This is the only thing in this project that can put a
recording of you onto a network, and this page says so before anybody discovers
it.

What it sends: one recorded utterance, at the moment you press the microphone,
to whichever recognizer the platform uses — Google, on Android and in Chrome.
What it does not send: anything from the database. Not an item, not a location,
not a contact, not a backup. Nothing on this path can reach the database, and
nothing on the assistant's path can reach the microphone; they are separate
features with separate switches, and each sends only its own kind of thing.

When it sends: only when the device has no offline model for your language, and
only while the switch is on. A phone that can transcribe locally still does.

What holds it shut, because a default is not an argument:

- `settingsSchema` defaults it to `false`, and a corrupt stored value falls back
  to `false` rather than to the permissive side. Both are tested.
- `SpeechOptions.allowOnline` is absent-means-no across the whole seam, so a
  caller that forgets the argument gets the private behaviour.
- `SpeechPlugin.listen` reads `call.getBoolean("allowOnline", false)`, so a
  bridge call that omits it sends `EXTRA_PREFER_OFFLINE` exactly as before.
- Nothing switches it on but a person. Not a failure, not a retry, not a
  first-run prompt. The panel shown after a listen that found no offline model
  names the setting and explains what it does; the user goes and moves it.

The label is deliberately not the word "online". It names Google, because "allow
online recognition" describes a mechanism and "send your audio to Google"
describes what happens to you. In Portuguese it reads *Seu áudio vai para o
Google*.

The offline audit is unmoved by any of this, and that was checked rather than
assumed: the opt-in adds no `fetch`, no URL and no second use of
`SpeechRecognition`. It changes the value of one property inside the one module
already permitted to have it.

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
refuse. On Android the system voice is on the phone. **Settings → Read answers
aloud** switches it off, and that remains the only certain answer.

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
