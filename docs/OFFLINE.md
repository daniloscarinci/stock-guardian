# Offline operation

Stock Guardian makes no network requests of its own. Not "few", not "only for
updates" — none. This page describes how that is achieved and, more importantly,
how it is enforced, because a promise like this erodes by accident: one webfont,
one analytics snippet, one CDN fallback added while debugging.

"Of its own" is doing real work in that sentence, and two things sit outside it.
Both belong to voice control, both are the platform acting rather than the page,
and both are set out in full under *Speech* below.

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
network instead of refusing. What travels is the recorded utterance. Your
inventory, your locations, your contacts and your backups have no route off the
device under any setting, and there is no code in this repository that would
send them.

Nothing else in the application, on any platform, reaches the network at all.

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

It carries one rule that reads `src/` instead of `dist/`, for the
`SpeechRecognition` identifier. That exception, and what it cannot catch, is set
out under *Speech*.

**The Content-Security-Policy.** `index.html` declares `default-src 'self'`, so
the browser itself refuses any off-origin request. `'wasm-unsafe-eval'` is
present because instantiating the SQLite module needs it; it grants nothing else.
`frame-ancestors` is deliberately absent: it is ignored in a `<meta>` element and
would look like protection while providing none. Set it as a response header if
you host this somewhere that can.

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
and the Android build ships no service worker at all. The audit below still runs
over the same `dist/`, so the guarantee is enforced identically either way. That
build goes further and asks the operating system for no permission whatsoever —
not even `INTERNET` — which makes "it does not use the network" checkable in the
phone's own settings, and is itself checked on every build. Voice control did
not change that: the manifest gained a `queries` element, which is package
visibility rather than a permission, and the workflow that enforces this is
byte-identical to the one that shipped before voice existed. See
`docs/ANDROID.md`.

The online opt-in does not change it either, and why is worth stating rather
than glossing. With no `INTERNET` permission this application cannot open a
socket even if it tried; when the setting is on, the audio leaves from Google's
recognizer, in Google's process, under Google's permissions. That is a real
disclosure and this page makes it — but it is not this application acquiring a
network, and the permission check that proves so still passes untouched.

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

**The Content-Security-Policy**, `connect-src 'self'`. An implementation that
tried to ship audio to a server itself would have nowhere to send it. This is
the structural one, and it is why the seam is safe to have.

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
and `false` by default. This is the first thing in this project that can put a
recording of you onto a network, and this page says so before anybody discovers
it.

What it sends: one recorded utterance, at the moment you press the microphone,
to whichever recognizer the platform uses — Google, on Android and in Chrome.
What it does not send: anything from the database. Not an item, not a location,
not a contact, not a backup. There is no code here that could.

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
the `opfs-sahpool` VFS. It never leaves the device. There is no server to send it
to and no account to attach it to.

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
