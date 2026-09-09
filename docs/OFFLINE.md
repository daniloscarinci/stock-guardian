# Offline operation

Stock Guardian makes no network request of its own. Not "few", not "only for
updates" — none. That is what it does when you change nothing, it is what ships,
and it is still enforced. This page describes how, because a promise like this
erodes by accident: one webfont, one analytics snippet, one CDN fallback added
while debugging.

Three things sit outside it. Each is set out in full below, none of them puts
your database on a network, and **one of the three is on as it ships** — read
that one even if you skip the others. Expiry reminders are not among them, for
the reason given after the third.

**Asking Claude.** *Off until you switch it on.* Paste your own Anthropic API
key into Settings, switch the assistant on, and a question goes to
`api.anthropic.com`. This is the only request in this project that the
application itself makes, and *The AI assistant* below says precisely what is in
it. With no key stored, the assistant does not run, opens no connection and
sends nothing.

**The microphone's second attempt. THIS ONE IS ON.** Every press asks the device
to transcribe with no network, and on a phone that has your language installed
that is the whole of it — nothing leaves, and it works with the radio off. When
that attempt fails and the phone reports a connection, the recognizer is asked
once more without the offline requirement, and the system recognizer then sends
what you said away to transcribe it — on most phones, to Google. The exchange is
marked **Transcribed online** in the sheet, so you can see which presses left
the device. It is never tried after you press stop, never tried after a silence,
never tried twice, and **Settings → Ask → Transcribe on this device only** stops
it happening at all. *Speech* below sets out why the absolute rule was replaced
and what still holds it in.

**Downloading a speech pack.** *A download you ask for.* Where the browser
offers it, installing an on-device model for your language costs nothing of
yours, and the point of it is to make the attempt above unnecessary.

**Expiry reminders are not a fourth thing.** *Android only, off until you switch
it on.* They add no network use of any kind, and this page says so rather than
leaving it to be assumed. What they do is hand Android's own alarm manager a
list of dates and sentences, which is an in-process call to a system service on
the same phone. No server decides when to send one, nothing is registered with
anybody, there is no push service, no token, no device id, and nothing about
your inventory leaves the device — the text of every notification is composed on
the phone from rows in the database on the phone. `@capacitor/local-notifications`
opens no socket; the audit below reads the built bundle and finds nothing new to
say about it, which is the check rather than the claim. `POST_NOTIFICATIONS` is a
permission to interrupt you, not a permission to connect.

The application itself still reaches nothing, on any platform, whatever you do
with these: the audit and the Content-Security-Policy below hold that, and the
recording the second attempt sends is sent by the recognition service rather
than by this code. That the application now holds `RECORD_AUDIO` changes what it
may open, not where anything may go — *Speech* below says why the permission is
there at all. Your database is never uploaded either way — the assistant sends
the rows a question asked about and never the file they came from.

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
`SpeechRecognition` identifier — permitted in exactly one module,
`src/services/speech/webspeech.ts`. That rule, why it was kept through the
period when its subject was deleted, and what it cannot catch, are set out under
*Speech*.

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

**That APK now declares `INTERNET` and `RECORD_AUDIO`, and it used to declare
nothing.** The sentence that cost was a good one, so it is worth saying exactly
what replaced it, in the order the two were given up.

`INTERNET` went first. A key the user pastes in is worth nothing unless the
application can reach Anthropic with it, and Android has no permission narrower
than `INTERNET`, no per-host form of it, and no way to hold it only while a
feature is on.

`RECORD_AUDIO` went second, and it is the microphone. Speech used to arrive
through `ACTION_RECOGNIZE_SPEECH`: Google's own voice search screen opened, the
system held the microphone, and this application recorded nothing. On the phone
this project exists for that screen never opens — Android answers *"Voice search
isn't available"* — while the keyboard's voice typing on the same phone works
perfectly. The keyboard binds the speech service directly rather than firing the
Intent, so `SpeechPlugin` does too, and binding it means recording here. The
permission is requested on the first press of the microphone and never at
startup; refuse it and typing is the same feature it always was. *Speech* below,
and `docs/ANDROID.md`, carry the full argument.

The check in `.github/workflows/android.yml` was narrowed rather than deleted,
once for each. It allows `android.permission.INTERNET`,
`android.permission.RECORD_AUDIO` and the one permission androidx namespaces
under this application's own id, and it fails the build on every other:
`CAMERA`, location, contacts, storage, and whatever a future dependency merges
in. Run it yourself against a built APK — the command is in `docs/ANDROID.md` —
and it prints those two names and nothing else. That is a weaker sentence than
"it asks for nothing", and it is still a sentence a machine checks on every
build rather than one you have to believe.

The manifest also carries a `<queries>` element, so that
`SpeechRecognizer.isRecognitionAvailable` can see the recognition service at all
— from Android 11 an application sees no other application it has not named.
That grants nothing and asks for nothing, and it is not `QUERY_ALL_PACKAGES`.

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

**The Android permission gate.** The APK declares `INTERNET` and `RECORD_AUDIO`;
the workflow allows those two names and fails on every other permission. Set out
above under *How it works*, and in `docs/ANDROID.md`.

### What it cannot promise

Stated rather than glossed, in the manner of the rest of this page.

- **What happens to a question after it arrives is Anthropic's business, not
  this repository's.** This project can tell you exactly what it sends and can
  prove where it may send it. It cannot make any promise about the other end,
  and does not.
- **The audit is a text match.** The SDK reaches that host by default without
  being told to, so a second module that builds a client without naming a URL is
  invisible to the source rule. The Content-Security-Policy still binds the
  whole page to one host and the Android gate to two permissions, neither of
  which is a network beyond `INTERNET`, so the shape of what could go wrong is
  "a second place in this codebase talks to Anthropic", never "this application
  talks to somewhere else".
- **Your key sits at rest on the device**, in the settings table, alongside
  everything else. Anyone who can unlock the phone can reach it, and a debug
  build is readable over a cable. Revoking a key is done at Anthropic, not here.
- **Questions cost money**, on the key holder's account, per question.

---

## Speech

**Speech input is the one feature that could quietly undo everything above**, so
it is worth a chapter, and the chapter has a history. It shipped. It was removed
because it did not work. It came back with an opt-in that nobody had switched on,
so it still did not work. What is here now is the third answer, and it changes
the standard rather than the wording.

Three recognizers sit behind one seam. Android's binds the recognition service
through `SpeechRecognizer` — the on-device one where the phone has it, which
cannot reach a network at all. Chrome's sets `processLocally` before every
start, which fails closed. Everything else reports itself unavailable rather
than falling back to the API's default mode, which streams the microphone to
Google.

### Offline is the standard; the internet is what it falls back to

Every listen starts on the device. On Android that is
`createOnDeviceSpeechRecognizer` where the phone has one — a service with no
network of its own, so "offline" stops being a request that can be quietly
ignored and becomes a property of what was bound — and `EXTRA_PREFER_OFFLINE`
everywhere else. Chrome's recognizer sets `processLocally = true`. Neither is a
preference the recognizer may ignore quietly: with no model on the device for
your language, that attempt fails rather than going to a server behind your
back. On a phone that has the language, this is where every press ends, and
nothing leaves.

**That failure is what removed this feature once, and dead-ended it twice.** On
the Portuguese phone this was built for there is no offline pack. The recognizer
refused every request. The first time, the plugin reported the refusal as a
cancellation — which this interface answers with silence — so the button
appeared dead and could not say why, and it was deleted. The second time the
failure was named, but the way past it was an opt-in that was off by default, so
the default still refused every press. An absolute rule nobody can use is not a
stronger promise. It is a dead button.

**So a failed on-device attempt is now tried once more without the offline
requirement.** The system recognizer then transcribes over the network, which on
most phones means Google receives what you said. Four things bound it, and each
is tested on its own:

- **It is second, never first.** The on-device attempt runs every time, and the
  retry exists only in the failure path of it.
- **It never follows a cancel, and never follows a silence.** Press stop and
  nothing further happens; say nothing and nothing further happens either.
  Sending a recording away because somebody changed their mind is the worst
  thing this feature could do, and re-opening the microphone at somebody who has
  already stopped talking is the second worst.
- **It never runs without a connection.** `navigator.onLine` is read as a hint
  in one direction: a definite *no* stops it. A *yes* it cannot verify lets the
  attempt run and fail, which costs a second.
- **It happens at most once.** A failing retry reports the first failure and
  stops. There is no loop.

**And it is visible.** The exchange carries **Transcribed online** in the sheet,
beside the marker naming which engine answered. A fallback nobody can see is a
fallback nobody agreed to.

**`voiceOfflineOnly` is how to refuse it, and it is off.** Switched on, no
second attempt is ever made: what you say never leaves the phone, and a language
with no offline pack simply will not transcribe — which is exactly what somebody
switching it on is asking for. It is named for the restriction rather than for a
permission, so that the label states what it does. It replaces
`voiceAllowOnline`; a stored row under the old name is not read, in either
direction, because `seedDatabase` writes every default on first run and a stored
`voiceAllowOnline: false` says *this install was never touched* far more often
than it says *somebody refused the network*.

**The retry is now aimed, and it used to be sprayed.** It fired on any failure
but a cancel, because `ACTION_RECOGNIZE_SPEECH` returned no error extra: the two
Android constants that name a missing language pack are delivered only to a
`RecognitionListener`, the API that records in this process, and the application
did not hold `RECORD_AUDIO`. Below API 33 the diagnosis was a timing heuristic —
a guess at whether `RESULT_CANCELED` came back faster than a person could press
back. A retry that waited for certainty would not have fired on the phone this
exists for.

It holds `RECORD_AUDIO` now, so the constants arrive and the heuristic is
deleted. The retry runs after a missing language pack, a network or server
error, or a recognizer that could not bind at all. It does not run after a
silence, a cancel, a refused microphone, or a device that transcribes nothing —
a second attempt would help with none of those, and each one it skips is a
recording that is not made.

**Nothing in the application ever writes the setting.** Not a retry, not a
failure, not an upgrade. A failure may put the switch in front of you — the
panel that explains a missing offline model carries it, because sending somebody
to hunt through a settings screen after a failure they cannot interpret is how
this failed the first time — and only a press moves it.

### What still guards the default

**The audit rule survived the feature's deletion, which is why it was there when
it came back.** `scripts/audit-offline.mjs` fails the build if the identifier
`SpeechRecognition` appears in `src/` anywhere but `webspeech.ts`. When speech
input was removed, the allowance became `null` — permitted nowhere — rather than
the rule being deleted along with its subject, on the grounds that the browser
API was still there and still streamed audio by default. Speech input came back;
naming the module again was the whole of what restoring the guarantee cost. One
module still constructs a recognizer, and both of its attempts are in it.

What it cannot catch is unchanged: it is a text match on one spelling over
source files, so a name assembled at runtime passes it. It catches the second
use site somebody adds on purpose, which is the failure that actually happens.

**The Content-Security-Policy still refuses.** `connect-src 'self'
https://api.anthropic.com` names one host, and it is not a speech service. An
implementation that shipped audio somewhere itself would have nowhere to send
it. What it cannot reach is the browser's own recognizer, which makes its calls
outside the page — which is exactly why `processLocally` matters.

**The APK declares `RECORD_AUDIO`, and this line used to say it never would.**
That is the one guarantee on this page that was given up rather than tightened,
and the paragraph above says why: the permission-free path could not work on the
phone this was written for, while the keyboard's voice typing on the same phone
could. `.github/workflows/android.yml` still fails the build on every permission
but that one and `INTERNET`, and the command to check a built APK yourself is in
`docs/ANDROID.md`.

What the permission does not change: it lets this process open the microphone,
and nothing more. There is no continuous listening and no wake word — one
utterance per press, ended by the recognizer, by the stop button, or by closing
the sheet, and the recognizer is destroyed on every one of those paths because a
leaked one holds the microphone open. Audio is never written to storage and
never passes through this application's own network code, which the
Content-Security-Policy above would refuse anyway.

**Failures are named rather than swallowed.** The plugin returns a stable code
and the interface owns the wording; only a deliberate cancellation renders as
nothing. That is not a privacy property, but it is the property whose absence
made a microphone that failed in total silence, and `docs/VOICE.md` sets out
each code and each sentence.

### The speaker, which is not the microphone

`speak.ts` reads answers aloud, and `ringer.ts` asks Android whether the phone
is silenced. Neither opens a microphone; the Android side of it is one method,
`isSilent`, on a plugin that needs no permission. It was part of the speech
plugin once and is deliberately not again: the ringer belongs to the speaker,
and an APK that can speak needs nothing from the plugin that listens.

### Reading answers aloud

Speaking is a system service and `speak.ts` fetches nothing. There are two
implementations behind it — `TextToSpeech` through a hand-written plugin inside
the APK, `speechSynthesis` in a browser — because the WebView exposes the second
without implementing it. Neither opens a socket.

But both platforms offer server-synthesised voices alongside on-device ones, and
the remote voice is often both first in the list and the better-sounding one.
Choosing it would send the sentence — which names what is in your pantry — to a
synthesis service.

The automatic choice therefore names a voice only when it is on the device, and
otherwise names none at all, leaving the language to the platform. On the web
that reads `SpeechSynthesisVoice.localService`; on Android it reads
`Voice.isNetworkConnectionRequired()`, which is the engine stating a requirement
rather than the browser summarising one — so the guarantee is stronger inside the
APK than outside it. The rule itself lives once, in `voices.ts`, and both paths
obey it; tests pin it on both, including one asserting that a network voice
listed ahead of a local one is still not chosen.

This is a best effort, not a guarantee: with no local voice installed, the
platform may still resolve the language to a remote one, and neither API offers a
way to refuse. On Android the system voice is on the phone. **Settings → Ask → Read
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
