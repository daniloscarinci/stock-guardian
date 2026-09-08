# Changelog

## 2.3.0

### The microphone asks for the microphone

Four releases shipped a microphone that could not transcribe a word on the phone
this application was built for, and the reason was a design decision made here
on purpose.

`ACTION_RECOGNIZE_SPEECH` hands recording to the system, so the application
never touched the microphone and the APK asked for no permission to use it. That
property was real, it was checked on every build, and it was written about at
length in three documents.

It is also handled by Google Voice Search, which is not available on a moto g35
5G. The keyboard's voice typing works on that phone, because Gboard binds the
speech service directly rather than going through that Intent. So the phone could
always transcribe; this application was knocking on the one door that was locked.

The microphone now binds `SpeechRecognizer` the way the keyboard does, and
therefore declares `RECORD_AUDIO`. Android asks once, on the first press, never
at startup. The workflow gate that proved the APK asked for nothing was narrowed
rather than deleted: it allows `INTERNET` and `RECORD_AUDIO` and still fails the
build on anything else, which is proved on every run by rejecting a deliberately
added permission.

**What comes back with the permission.** `RecognitionListener` reports the real
error constants, including the two that name a missing language pack and never
reached the Intent at all. The timing heuristic that guessed a refusal from how
fast a cancellation returned is deleted; there is nothing left to guess.

Offline is still the standard. On Android 13 and later the first attempt binds
the on-device recognizer, which has no network of its own, so "offline" is a
property of what was bound rather than a request that can be ignored. Where that
cannot serve the language and the phone has a connection, it retries over the
network and the answer says `Transcrito pela internet`. `voiceOfflineOnly`
refuses that, and with the radio off nothing is retried.

**A stop button**, because a bound service draws no interface of its own. The
Intent had a system dialog with a back button; without one, a mistaken press
would hold a microphone this process now owns.


## 2.2.1

The 2.2.0 entry below records that release as it shipped and is left standing.
The part of it describing `voiceAllowOnline` is no longer true, and it is named
here rather than edited out of the history.

### Offline is the standard; the internet is what it falls back to

**The microphone tries the device first and the network second, and 2.2.0's
opt-in was not enough.** That release named every failure and offered a switch,
but the switch was off by default and the default therefore reproduced the
original failure exactly: on a phone with no offline Portuguese pack, Google
answered *"Voice search isn't available"* and the button still did nothing. An
absolute rule nobody can use is not a stronger promise.

**Every listen still starts on the device.** The Android plugin sends
`EXTRA_PREFER_OFFLINE` on the first attempt and Chrome's recognizer sets
`processLocally = true`, exactly as before, and on a phone with the language
installed that is where every press ends.

**A failed attempt is now retried once without the offline requirement**, when
the device reports a connection and the user has not refused it. It never
follows a deliberate cancel, never runs twice, and reports the first failure
rather than the retry's — except a cancelled retry, because a banner after
*never mind* is the thing this feature has a rule against. The retry fires on
any failure but a cancel, because the Intent flow cannot name a missing language
pack: a retry that waited for a diagnosis would not fire on the phone this
exists for.

**The exchange says when the network transcribed it.** *Transcribed online* /
*Transcrito pela internet* / *Transcrito por internet*, beside the marker naming
which engine answered. A fallback nobody can see is a fallback nobody agreed to.

**`voiceAllowOnline` became `voiceOfflineOnly`, default false.** Named for the
restriction so the label states what it does: on, no second attempt is ever
made. A row stored under the old name is not read in either direction —
`seedDatabase` writes every default on first run, so a stored
`voiceAllowOnline: false` says *this install was never touched* far more often
than it says *somebody refused the network*, and migrating it would restore the
dead button for everybody who never had an opinion.

**The sequence moved out of Java.** `SpeechPlugin.listen` takes `preferOffline`
and does as it is told; `capacitor.ts` and `webspeech.ts` own the two attempts,
and `online.ts` owns the one policy both of them ask. All of it is testable
without a device.

**The APK still asks for `INTERNET` and nothing else.** The second attempt
travels on the system recognizer's own connection, not on this application's.

---

## 2.2.0

The 2.1.0 entry below records that release as it shipped and is left standing.
One of the things it describes — the removal of the microphone — is no longer
true, and it is named here rather than edited out of the history.

### The microphone comes back, offline first

**Speech input returns, and the reason it failed is fixed.** It was removed in
2.1.0 because Android's recognizer refuses `EXTRA_PREFER_OFFLINE` on a phone
with no offline pack for the language, and because the plugin reported every
refusal as a cancellation — which the interface answers with silence. The button
appeared dead. `EXTRA_PREFER_OFFLINE` is no longer unconditional and no failure
is silent.

**`voiceAllowOnline` is back, and it is off.** With it off, nothing changes at
all: the Android plugin sends `EXTRA_PREFER_OFFLINE`, Chrome's recognizer sets
`processLocally = true`, and a language with no local model fails rather than
quietly reaching a server. Switched on, the flag is omitted and the system
recognizer may use the network — which on most phones means Google. The label
says so rather than saying *online*.

**The switch is on the failure panel, not only in Settings.** The first version
of this named the setting in a sentence and sent the reader to Settings to find
it, having just told them their phone had no *offline speech pack*. The panel
that explains the failure now carries the switch itself, in the same words as
the Settings row. It is never flipped by the application: a failure may offer
it, and only a person moves it.

**The microphone is in the sheet, next to the box, not in the header.** The
header button opens the sheet and starts no listen of its own. Pressing it used
to do both, which on a phone with no offline pack put a warning panel on top of
the typed box every time somebody opened the sheet to type.

**The diagnostics are recovered whole.** Real result codes off the Intent, the
API 33 pre-flight through `checkRecognitionSupport`, and below that the timing
heuristic on how fast `RESULT_CANCELED` returns — still marked as a heuristic,
and still applied only where nothing else could answer. `cancelled` is the one
code that renders as nothing; every other renders a sentence.

**The APK still asks for `INTERNET` and nothing else.** `ACTION_RECOGNIZE_SPEECH`
hands recording to the system, so there is no `RECORD_AUDIO` to declare. The
manifest's `<queries>` element comes back with the plugin — without it,
`queryIntentActivities` returns empty from Android 11 on and the microphone
reports itself unavailable on every modern phone. It is package visibility, not
a permission.

**The audit rule points at `webspeech.ts` again.** It spent one release pointing
at `null` — permitted nowhere — rather than being deleted along with its
subject. The subject came back and the rule was still there, so restoring the
guarantee cost one string.

---

## 2.1.0

The entry below records 2.0.0 as it shipped and is left standing. Two of the
things it describes are no longer true, and both are named here rather than
edited out of the history. One thing in *this* entry is no longer true either —
see *Unreleased* above, where the microphone comes back.

### The assistant is wired in

**Ask Claude from the same box the twelve rules answer.** Paste your own
Anthropic API key into **Settings → Ask Claude**, switch it on, and a typed
question goes to `api.anthropic.com` instead of to the parser. Claude is handed
functions rather than data - find an item, what is expiring, what is below its
minimum - and the application runs the ones it chose against the database on
this device. The inventory is never uploaded.

Anything it proposes changing arrives as the confirmation card voice control
already had, calls the same `commit`, and can be undone the same way. Nothing a
model produced can reach the database without a press, and the interface does
not read the proposal's own `certainty` field to decide that - a value can be
wrong, and this one would be wrong in the direction that writes.

**Every exchange says which engine answered.** One is exact, offline and free;
the other is capable and costs money per question, and the difference is worth
a line on each answer rather than a banner.

**Claude failing falls back rather than dead-ending.** No signal, a refused key,
too many questions at once: the twelve rules answer instead, and the sheet says
which of those it was, so a key typed with one character wrong does not look
like an assistant nobody switched on.

### Voice control loses its microphone

**Speech input is removed.** It was built, it shipped, and it did not work on
the phone it was built for: Android's recognizer refuses `EXTRA_PREFER_OFFLINE`
when no offline Portuguese pack is installed, and answers *"Voice search isn't
available"*. Deleted with it: `recognizer.ts`, `webspeech.ts`, `none.ts`, the
recording half of `SpeechPlugin.java`, the install panel, the failure notices,
and **Settings → Voice → Send your audio to Google** - which was the only
control in this application that could put a recording of anybody onto a
network. The manifest has lost its `queries` element too.

**Reading answers aloud is kept**, and with it `RingerPlugin`, so a spoken
answer still yields to the switch on the side of the phone.

**The audit rule that guarded the recognizer was kept and tightened.**
`scripts/audit-offline.mjs` used to permit the identifier `SpeechRecognition` in
`webspeech.ts` and nowhere else. That file is gone; the rule now permits it
nowhere at all. The hazard did not move when the file did.

**`voiceEnabled` became `askEnabled`, and `voiceAllowOnline` is gone.** A stored
row for either is ignored rather than read - `parseSettings` skips any key the
schema does not have - so an old database neither restores a setting that no
longer exists nor trips over one.

### Defects fixed

**`whats_missing` ignored dismissals.** The replenishment screen honours an item
the user has taken off the list; the spoken answer and the assistant's tool did
not, so the application disagreed with itself about the same list and Claude
would tell someone to buy the thing they had just dismissed. `VoiceDeps` now
carries `dismissedItemIds`, required rather than optional so that a new caller
has to answer the question rather than inherit the wrong answer.

**A proposal from Claude had no honest reason.** Every one was marked assumed
because of the item, which renders as *"you did not say its whole name"* - a
true sentence about a phrase the parser matched loosely and a false one about a
row a model picked out of a tool result. Proposals now lead with a reason of
their own: *"The assistant chose this item. Check it is the one you meant."*

---

## 2.0.0

A rebuild of the original single-file application. Everything it did, this does.
The original is kept at `backup/End_of_world_V11-Pro_Upgraded.html`, untouched,
as the baseline and the provenance record for the reference catalog.

---

### Defects fixed

Each of these was in the original, and each is now pinned by a test.

**Categories were stored as localized labels.** An item saved in English carried
`"Food"`; the Portuguese interface offered `"Alimentos"`. Switching language
orphaned every record, and re-saving one silently blanked its category.
Categories now have stable identifiers, with labels in a side table. Renaming a
category in any language touches no item.

**User text went into `innerHTML` unescaped.** Item names, locations and
categories were interpolated straight into markup on every render, and the
importer checked only `Array.isArray` before replacing the entire inventory — so
a crafted backup was a code-execution path that persisted to `localStorage` and
re-fired on every load. React escapes by default, every import is validated
against a schema, and a name like `<img src=x onerror=alert(1)>` is now stored
and displayed as the text it is.

**Items were required to expire.** `saveItem` refused to save without a date, so
a hammer, an axe and a compass all needed invented ones. Worse, a blank date
compared as less than today, so every dateless item was reported *expired*. A
missing expiry now means the item does not expire, and is a first-class state.

**Expiry was computed in the wrong timezone.** `new Date().toISOString()` yields
a UTC calendar date, while `<input type="date">` yields a local one. In Brazil,
at UTC−3, every evening after 21:00 reported items as expiring a day early. All
date comparisons now use the local calendar date, and the arithmetic runs in UTC
so daylight-saving transitions cannot shift it.

**Editing could overwrite the wrong item.** The pending edit index lived in a
hidden input and was never cleared on delete, sort, language change or import.
Edit row five, delete row two, save — and row four was overwritten. Items now
have stable identifiers.

**Import destroyed data with one click.** No validation, no preview, no
confirmation, no undo; the next render persisted the result. Import now reads and
validates first, reports what the file contains, and writes only after the user
chooses merge or replace — in a single transaction, so a failure halfway leaves
the original data intact.

**A low-stock threshold of zero was impossible.**
`parseFloat(stored) || 5` turned zero back into five on every render.

**Search ignored accents.** `toLowerCase().includes()` meant `agua` never found
`Água` and `acucar` never found `Açúcar`, in an application whose interface and
catalog are Portuguese-first. Search now folds diacritics, matches partway
through words, covers notes, barcodes, locations and category names, and searches
all three languages at once.

**The interface was unusable with a screen reader.** No `<label>` anywhere, no
ARIA, action buttons that were bare glyphs, catalog entries that were
`<span onclick>` — unreachable by keyboard. Every control now has a real label,
dialogs use the native `<dialog>` element, and status is never conveyed by colour
alone.

**It did not work on a phone.** No viewport meta tag, and a form grid fixed at
six columns that never collapsed. The layout is now responsive, with the table
becoming cards and a quick-action bar within thumb reach.

**Every keystroke rebuilt everything.** Typing in the search box re-rendered the
table, rebuilt all 194 catalog entries with their inline handlers, and wrote to
`localStorage`. Search is debounced and queries are indexed.

**Two translation keys existed but were never read.** `exportBtn` and
`importBtn` were defined in all three languages while the buttons stayed
hard-coded English. Translation keys are now derived from the English tree, so a
missing one is a compile error, and tests assert that no locale has an unused or
untranslated entry.

**Language reset on every reload.** It now persists, and `document.lang` follows
it.

---

### Added

- **A real database.** SQLite — WebAssembly with OPFS storage in the browser,
  native on the desktop — with a versioned, atomic migration system, replacing
  two `localStorage` keys.
- **Minimum and target quantities**, per item, with Critical/Low/Adequate/Surplus
  status and a replenishment list that says how much to buy.
- **A preparedness score** that shows its own method and lists what is missing.
- **An expiration centre** with configurable warning windows, replacing a single
  hard-coded 30 days.
- **Locations** as real records, nesting to any depth, replacing free text.
- **Movement history.** Every quantity change records what it was before and
  after.
- **Quantity changes without a form** — `+` and `−` in the list.
- **Archive and restore**, so removing something from view no longer means
  destroying it.
- **An Android application.** The same build, wrapped by Capacitor and installed
  as an APK. It ships no service worker (the APK is already the offline
  mechanism), asks the operating system for one permission — `INTERNET`, for the
  AI assistant, with the build failing on any other — and switches
  off Android's automatic backup so the database never reaches Google Drive. The native shell
  writes exports to the phone's Downloads folder, because Android's WebView
  will not download a blob URL by itself and every export button would otherwise
  do nothing. See `docs/ANDROID.md`.
- **Twenty categories**, user-extensible, replacing nine fixed ones.
- **Filters that combine** — category, location, stock status, expiry, priority,
  condition, archived.
- **CSV export** and a print stylesheet, alongside JSON backup.
- **Four reports** — inventory, expiration, replenishment and preparedness —
  each exportable to CSV and printable. They render the numbers `domain/`
  already computed rather than recomputing them, so a report cannot disagree
  with the screen the user was just looking at.
- **Emergency contacts**, ordered by urgency. The table and the backup format
  have carried them since the first release; this adds the screen.
- **Backups with integrity checking**: format and schema versions, record counts,
  and a SHA-256 checksum.
- **Voice control**, in all three languages. The original contains no speech
  code of any kind, and would have had nowhere to put a spoken change: it wrote
  straight to `localStorage` on every action, with no confirmation step for a
  misheard sentence to be caught in. Ask the inventory a question — *"quanto
  arroz eu tenho?"* — or state a change — *"usei 3 ovos"* — and see a card
  describing what would happen.
  Nothing is written until it is confirmed; `execute.ts` has no write path at
  all, and a test spies on the driver to keep it that way. Speech is transcribed
  on the device: Android hands the recording to the system's own recognizer, so
  the APK still declares no microphone permission, and Chrome runs its
  on-device model with `processLocally`, which errors rather than reaching a
  server when no model is installed. A device with neither — an iPhone, Safari
  anywhere — gets the typed command box, which is present on every platform and
  is not a fallback.
  A failure now says what it was, because it used to say nothing: the Android
  plugin rejects with a code rather than calling every outcome "cancelled", and
  the sheet answers silence only for a cancellation you made. The one case that
  cannot be fixed on the device — no offline pack for your language — offers the
  install path, the typed box, and **Settings → Voice → Send your audio to
  Google**, which is off unless you switch it on and is the only thing here that
  can put a recording of you onto a network. See `docs/VOICE.md`.
- **Installable as an app**, with a hand-written service worker and verified cold
  offline start.
- **Light and dark themes**, following the system by default.
- **Diagnostics**: storage engine, journal mode, database size, integrity check,
  and whether the browser has promised to keep your data.

---

### Preserved deliberately

- **All 194 reference items**, in all three languages, with their original
  category assignments. Nothing was reclassified, even where a different category
  now looks like a better fit — a compass sits in Communication, not Navigation.
  Reference data is not ours to quietly rewrite.
- **The low-stock rule.** `quantity <= threshold`, inclusive, with a default of
  5 — but only as the fallback for items carrying no minimum of their own.
- **An item expiring today is not yet expired**, matching the original.
- **Thirty days** remains a default warning window.
- **The legacy export format** is still readable.

---

### Not built

Listed because the alternative is an interface full of controls that do nothing.
None of these appears in the application as a disabled button or a "coming soon"
panel.

Photographs (stored by the schema, no interface), barcode scanning (manual entry
works), application lock, notifications, and the desktop build — whose
configuration is complete and reviewed but has never been compiled, because this
machine has no Rust toolchain.

The Android project is complete, but no APK has been produced from it. GitHub
Actions builds and signs one when a version tag is pushed; no tag has been
pushed, and no phone has run this build.

Voice control adds four more. No wake word and no continuous listening — the
system recognizer transcribes one utterance per press, and hands-free listening
would need the microphone permission this design exists to avoid. No voice on
iPhone, iPad or Safari, where no on-device speech API exists; the typed box
works there and the interface says why the microphone is absent. No voice in the
desktop build, which has still never been compiled. And no conversation: the
engine answers the forms in `docs/VOICE.md` and returns UNKNOWN with examples for
anything else, rather than guessing.
