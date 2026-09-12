# Changelog

## 2.6.1

### The box is pinned to the bottom of the sheet

2.6.0 gave the ask box six example sentences the moment it opens, and putting
them above the box was a mistake that only shows on some phones. Whole
sentences wrap differently at every width, so nothing bounded that block's
height: an empty sheet measured anywhere between 534 and 690 pixels against a
cap of 92% of the screen. At 360 by 640 - an ordinary Android - the **Send**
button sat a hundred pixels below the fold before anybody had typed a word. On
a Pixel in English it fit, which is why it took a survey to find.

The cause was not the examples. Five things were competing to be looked at
first, and the layout settled it by document order, which had been chosen for
reading rather than for acting.

So the box and the microphone are the dialog's footer now, pinned to the bottom
edge where the thumb already is, and the conversation scrolls behind them.
Nothing said or answered can push them off screen at any length, in any
language. The examples became the empty state of the log instead of a block
above the control they teach, which is why there is no limit on them anywhere.

The box's instruction moved into the sheet's header, and that is a trade rather
than a win: it is read out as the sheet opens, which a label at the far end of
the sheet never was, and it stops standing visibly beside the box once you
start typing.

### One list of examples, and it is out of the way of the reader

The same twelve sentences used to appear twice in two different shapes - six as
chips when the sheet opened, and all twelve as a bulleted list after something
was not understood. That second list was inside the part of the sheet a screen
reader announces, so being told "I did not understand that" was followed by
twelve whole sentences read out loud.

They are one list now, in one shape, in the place a screen reader is not
watching. Six at rest with the rest a press away, at both moments somebody does
not know what to say. Asking for help still reads all twelve.

### The card says what it is doing

The confirmation card - the thing that appears before anything is written - had
a one-pixel outline whose top and bottom are wherever the scroll left them, and
five evenly spaced lines inside it, so an item's name sat as far from its shelf
as the old quantity did from the button that commits the new one. It has an
accent rule down its left edge that is visible at any scroll position, and its
contents are grouped into three: what this is about, what changes, and what was
guessed at.

While something is being written the whole conversation goes inert in one move,
rather than nine controls each dimming themselves. Two of those nine were the
**Confirm** and **Cancel** buttons, which had been rendering at half the opacity
of the sentences explaining them, because a disabled button's fade multiplies
with the region's rather than replacing it.

### Nothing in this release changes what the box can do

No new sentence, no new tool, no new field. The seven ways in and the ten
writes are the ones 2.6.0 shipped. This is where they sit and how they read.

## 2.6.0

### The ask box can make a place, a heading and a person

It could change stock and it could create an item. Everything else this
application holds - a shelf, a category, an emergency contact - was a screen,
and a sentence naming one that did not exist was a dead end.

Three rules per language now, in English, Portuguese and Spanish, all the same
shape: a creating word, a noun the rule watches for, and a name. The name may
arrive after "called" or "named", after a colon, or after nothing but a space,
and a leading article comes off it.

> new place, cellar
> nova categoria, ferramentas
> nuevo contacto ana telefono 555 1234

**A contact's number is read as digits, never as a quantity.** "five five five"
is 555 to anybody reading it back and 15 to anything that adds, so the words are
mapped one at a time. A word that is not a digit refuses the whole sentence:
"phone five hundred" produces no intent at all, rather than a contact stored
without the half the speaker cared about. A relationship is kept where the
sentence gives one - "new contact my sister ana" - because `contacts.search`
reads that field too, and it is the handle most people ask the number by.

**A name already taken is answered rather than made twice.** "new place, cellar"
on a pantry that has a cellar reads back what that shelf holds, out of the same
helper "o que tem na despensa" uses. Two shelves whose names a user cannot tell
apart is worse than being reminded of the one they have: stock would start
landing on both, and neither would then answer truthfully. A category behaves
the same way.

**A category is named in one language, the one the interface is in.** The twenty
built-in categories ship named in all three, and copying a spoken name into the
other two columns would be writing English into the Portuguese one and
presenting it as a translation. The other two fall through to the English name,
or failing that to the row's id, which is a slug of the name - visible on the
Categories screen, and fixable there.

### What "new" costs, paid openly rather than quietly

"new place cellar" and "new room spray" are token-for-token identical - a
creating word, a noun this rule watches for, one more word - and a regex has no
lexicon to tell a cellar from a spray with. Requiring "called" after "new" would
refuse the plainest way anybody names a place; leaving the bare space accepts
both. No pattern keeps the first and loses the second.

So "new room spray" makes a place called "spray", "nuevo grupo electrogeno" a
category called "electrogeno", and "new contact lenses" a person called
"lenses". It is a decision rather than an oversight, and the grammars say so
beside the patterns. "create", "add" and "make" are narrowed instead, because a
sentence opening with one of them has somewhere else to land: all three need
"called", "named" or a colon, so "add a room spray" is one more can of spray on
the stock and "make room in the pantry" stays UNKNOWN exactly as it did before.

Nothing is written on the guess either way. "new room spray" arrives as a card
headed *spray* reading "No place is called spray. Confirming makes it.", with
Cancel beside the button that would make it, and the Locations screen can rename
the row.

### A move to a shelf that is not there

"move the rice to the cellar" with no cellar used to answer "I did not find the
cellar" and offer nothing to press, having understood every word of it. The card
carries it now: the place is proposed alongside the move, one press makes both,
and Cancel makes neither. The reason shown is `newLocation` rather than
`location`, because the reader is being asked to check a different thing - not
which of their shelves was picked, but the spelling of a name about to become a
row.

The same is true of a creation that names a place. "criar item 2 kg de quinoa no
porao" used to tell the user about the cellar and forget the quinoa, so a phrase
naming two new things produced neither.

**One receipt takes back more than one write.** A receipt is a list of actions in
the order they have to run, which is the reverse of the order they were written
in, so this one puts the rice back on its old shelf and then deletes the empty
cellar. An undo that took back only the move would leave a shelf nobody asked
for.

One gap is left open on purpose. The place is written first, and the item can be
deleted from the Inventory screen while the card is on screen; the move then
fails, and no receipt comes back to remove the place. What is left is an empty
shelf carrying the name that was said, listed on the Locations screen and
deletable there - and saying the sentence again finds it. Compensating would mean
another write that can fail in its turn, and `commit` is handed repositories
rather than the driver, so there is no transaction to wrap the pair in.

### Claude gained six tools, and the two engines match

The assistant had four writing tools where the rules on the device had seven,
which meant the paid engine could not move an item, set a minimum or set a
target - three things the free one had done all along. It has ten now, the same
ten: `move_item`, `set_minimum`, `set_target`, `create_location`,
`create_category` and `create_contact` join the four that were there.
Twenty-one tools in all, eleven of which only read.

None of the ten writes. `converse.ts` owns its tool-use loop rather than handing
it to the SDK's runner for exactly this reason: a runner executes the tools it
is given, and these have to be intercepted, turned into a pending write, and
answered with "the user has not agreed to this yet". What reaches the screen is
the card a spoken sentence produces, and `commit` is still the only writer.

Every proposal is `assumed` and never `explicit`, and the first reason on every
card is `assistant`. The model chose the row and chose the reading; the reader
is told so, rather than asked to check something they never did.

**The unit on a minimum or a target is a flag, and says so rather than
overclaiming.** Both tools now take an optional unit and compare it with the one
the row is kept in, as `adjust_quantity` always has. Because it is optional, an
absent unit reads exactly like a matching one, and only a unit named and wrong
is ever caught. What is structural rather than hoped for: the card prints the
item's own stored unit beside the number whatever Claude sent, and the tool
result hands that same unit back to Claude before it says anything to the user.

### The examples are shown before anything fails

Twelve example sentences per language existed, translated, every one of them a
phrase the grammar really accepts - and they were reachable only by asking for
help outright or by failing to be understood. The answer was being offered to
people who had already hit the wall.

Six of them are now chips on an empty sheet, under **Try one of these**.
Pressing one fills the box and puts the cursor in it rather than sending it: a
first press should show the shape of a sentence this application understands,
not add five cans of beans to somebody's inventory. Six rather than twelve
because these are whole sentences, and twelve of them at phone width push the
microphone and the box off the screen; the six are ordered to carry six
different shapes. They go once there is a history, because by then the log
teaches better than six buttons standing in front of it.

### A workflow that builds the Windows desktop application

`.github/workflows/windows.yml` builds the `.msi` and the `.exe` on a
`windows-latest` runner, which carries Rust and the Microsoft C++ build tools
already - the same argument `android.yml` makes about the Android SDK. A version
tag attaches them to the release the APK lands on; the Actions tab runs it by
hand and keeps them as artifacts instead. It installs `@tauri-apps/cli` and
`@tauri-apps/api` with `--no-save` and deletes the stub that stands in for them,
so neither package reaches anybody running `npm ci` for another reason.

It ships unsigned, and the release notes say so rather than leaving it to be
discovered: there is no Windows code-signing certificate for this project, so
SmartScreen warns on first run. The Android build is signed because that key
exists.

**Nothing has been built by it yet.** A workflow that exists is not an
installer, and the Tauri SQLite driver has still never executed. `docs/BUILD.md`
keeps its list of what to check the first time it does.

2117 tests to 2278.

## 2.5.0

### The application speaks, on the phone, at last

Answers had been read aloud since 2.0 and the phone had never said one word.
`speak.ts` called `speechSynthesis.speak()` and that code was correct.

**Android's WebView exposes the Web Speech synthesis API and does not implement
it.** The object is present, so every guard passed. `getVoices()` returned an
empty list, which is why the **Which voice** menu added in 2.4.0 has never once
appeared on a phone. `speak()` accepted every utterance and played silence.
Nothing anywhere raised an error. Answers arrived as text and the **Ouvir**
button did nothing at all.

That is the microphone's bug in a new costume - a web API that exists, satisfies
every check and quietly does nothing while the native path underneath it works -
and it gets the microphone's fix. `TtsPlugin.java` binds
`android.speech.tts.TextToSpeech` directly. It is the third hand-written plugin
here rather than the first, and follows `SpeechPlugin`'s structure: one
main-thread handler, one settle-once exit, a watchdog on the call that can hang,
stable codes rather than prose.

**Initialisation is asynchronous, and that was the failure being fixed.** A
`TextToSpeech` is useless until `onInit` reports success, and `speak` called
before that returns an error and plays nothing - silently. So nothing touches an
engine directly: every call is run now, parked until `onInit` answers, or
rejected because there is no engine to wait for. An engine that binds and then
says nothing is given up on after five seconds, everything waiting is answered,
and the state resets so the next call builds a fresh one. `shutdown()` runs on
activity destroy, because a leaked engine holds a bound service and an audio
focus handle.

**`speak.ts` is a seam now, the way `recognizer.ts` already was.** Native inside
the APK, `speechSynthesis` in a desktop browser and the installed PWA - this
application ships as both, so the browser path was kept rather than replaced. It
moved to `websynthesis.ts` unchanged. What both paths obey lives once, in
`voices.ts`.

Every behaviour the browser path had learned the hard way is now true on the
phone as well, with a test on both sides: the local-first voice preference, so an
answer naming your pantry is not handed to a synthesis server; the fallback to
that same choice when a stored voice has gone, which must never mean silence; the
new sentence replacing the stale one rather than queueing behind it; the empty
answer that means "nothing to say now" and stops what is playing; the setting
read per sentence.

**The local-first preference got stronger rather than being lost.** The browser's
`localService` is a summary; Android's `Voice.isNetworkConnectionRequired()` is
the engine stating a requirement.

**The voice menu has something in it.** It lists what the engine really has,
including the `#female` and `#male` markers Android writes into voice names -
`pt-br-x-afm#female_1-local`. That is the highest-confidence pattern
`inferVoiceGender` reads, it was written first, and it had never matched anything,
because the only device that ships those names was the one returning an empty
list. Voices the engine reports as not installed are left out. **Ouvir** speaks,
and when it cannot it says why: the silent switch, or no engine for this
language.

### It says hello when you open it

One sentence, in the interface language, as the application opens: the time of
day, then the one or two things that need doing.

> Bom dia. 3 itens vencem hoje.
> Buenas tardes. 2 ítems han vencido. Un ítem vence hoy.
> Good evening. Nothing needs your attention.

A greeting alone is a novelty that gets switched off within a week, so this is a
status report with a greeting on the front. Everything in it was already counted
for the navigation badge - no query was added. At most two facts, in the order
urgency runs: expired, expiring today, expiring inside the warning window, below
minimum. Nothing to report is itself worth saying, briefly.

The greeting follows the clock because Portuguese and Spanish distinguish three -
*bom dia*, *boa tarde*, *boa noite* - and three in the morning is *boa noite*,
not *bom dia*. English is given the same bands rather than an invented set.

**It ships on**, which makes it the only unprompted thing here that does, and the
argument is in `domain/settings.ts` beside the switch: a notification arrives on
a locked phone at an hour of its own choosing while the application is shut,
whereas this happens in the second after somebody deliberately opened it and
lasts about three seconds. Shipping it off would have answered a request with a
switch the person then has to find, which is the same silent nothing the rest of
this release is about.

Once per launch and never on a navigation. It yields to the phone's silent
switch, and to an answer that is already being read - a greeting must never talk
over one. It never delays the interface: the application is drawn and usable
before a word is said. **Settings → Ask → Say hello when the app opens** switches
it off, independent of *Read answers aloud* so that both controls mean what their
labels say.

### No new permission

`TextToSpeech` asks the system for nothing. The gate still allows exactly
`INTERNET`, `RECORD_AUDIO` and `POST_NOTIFICATIONS`, and the rebuilt APK was
checked against it - three lines, and nothing else. What was needed instead is
one more line of package visibility: from Android 11 an application cannot see an
engine it has not named, and the default engine lives in another package, so
`android.intent.action.TTS_SERVICE` joins the recognition service already in
`<queries>`. That grants nothing, and it is not `QUERY_ALL_PACKAGES`.

2058 tests to 2117.

## 2.4.0

### Notifications, and the thing they cannot be

The list of what is not built has lost a line. It used to say notifications were
not built and that the expiration centre served the same purpose *when the app is
open*, which was the whole problem: the point of a preparedness store is that you
do not open it for months, and food expires unwatched.

The Android build now schedules expiry reminders. One at your first warning
window before each expiry date, one on the day itself, in your own language and
naming what it is about - *"3 itens vencem em 7 dias - Leite, Iogurte, Pao"*.
Everything sharing a date is one notification naming at most three items and
counting the rest, which is the same rule a spoken answer follows and literally
the same function. Tapping it opens the expiration centre.

**The switch ships off, and it is the only thing that asks for the permission.**
A notification interrupts somebody, so it is chosen rather than discovered.
Android 13 needs `POST_NOTIFICATIONS`, and it is requested at runtime the first
time the switch is turned on - never at startup, never after a write, never as a
retry. A refusal is an outcome and not an error: *denied* says the next press
will ask again, *blocked* says Android has stopped asking and offers this
application's own settings page, which is the shape `MicNotice` settled on for
the microphone.

**Nothing runs in the background, and the documentation says so.** A Capacitor
WebView cannot wake up, so the text of every notification is decided in advance
and handed to Android's alarm manager with the date it should appear. A phone
left untouched for three months still delivers everything planned on the last
visit; an item added elsewhere is invisible until this application is opened,
which recomputes the whole plan and replaces the pending set. There is no
watcher and no page here pretends there is one.

At most 40 are pending at once, ordered soonest first, because Android stops
accepting alarms silently somewhere around fifty. Ids live in a band of this
application's own, so a reschedule cancels exactly what it scheduled last time
and nothing else.

**The permission gate narrowed again rather than opening.**
`@capacitor/local-notifications` merges four permissions into the manifest, not
one. `POST_NOTIFICATIONS` is kept and argued for; `SCHEDULE_EXACT_ALARM`,
`RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK` are stripped with `tools:node="remove"`
and each removal is written down with its cost. Reminders are scheduled as
inexact alarms with `allowWhileIdle`, which needs no exact-alarm permission and
still fires in Doze. The one real cost is that a reboot loses the pending
reminders until the application is next opened, and `docs/ANDROID.md` says so
alongside everything else that can stop one arriving.

The build gate now allows exactly `INTERNET`, `RECORD_AUDIO` and
`POST_NOTIFICATIONS`, and was proved to still bite by adding `CAMERA`, watching
it fail, and taking it back out.

**No new network use.** Local notifications are an in-process call to a system
service on the same phone: no push service, no token, no server deciding when to
send one, and no row of the database anywhere but on the device. The offline
audit passes unchanged, which is the check rather than the claim.


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
