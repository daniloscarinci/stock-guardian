# Voice control

Ask the inventory a question, or tell it what you just used, without typing.
Say *"quanto arroz eu tenho?"* and hear the answer. Say *"usei 3 ovos"* and see
a card that says what would change, which changes nothing until you press
**Confirmar**.

The original application had none of this. It exists because the situation this
project is built for is one where you are holding a torch in one hand and a box
in the other, and a form with six fields is the wrong thing to be looking at.

Two facts shape every decision below.

**The application never opens the microphone itself.** There is no
`getUserMedia`, no `MediaRecorder`, and no audio API anywhere in `src/`. On
Android the system's own recognizer records; in Chrome the browser does. That is
why the APK declares no `RECORD_AUDIO`, and the build fails if one ever appears.
See *How speech stays on the device*.

**The microphone is not the feature.** A typed command box is present on every
platform, in the same sheet, doing the same thing. A device that cannot
transcribe speech loses the button in the header and keeps everything else.

---

## What you can say

Every row below is taken from `src/voice/grammar/*.phrases.test.ts`, which is a
corpus rather than a sample: 222 rows across the three languages, and a phrase
that is not in it is a phrase this document does not claim. They are written the
way a recognizer returns them — lowercase, and often without accents — because
that is what the parser actually receives.

### Asking

| Português | English | Español |
|---|---|---|
| `quanto arroz eu tenho` | `how much rice do i have` | `cuanto arroz tengo` |
| `quantas latas de feijao preto eu tenho` | `how many cans of black beans do i have` | `cuantas latas de frijoles negros tengo` |
| `quantos ovos restam` | `how many eggs are left` | `cuantos huevos quedan` |
| `o que esta vencendo` | `what is expiring` | `que esta venciendo` |
| `o que ja venceu` | `what has expired` | `que ya vencio` |
| `o que vence nos proximos 30 dias` | `what will expire in the next 30 days` | `que vence en los proximos 30 dias` |
| `o que falta` | `what do i need to buy` | `que necesito comprar` |
| `lista de compras` | `shopping list` | `lista de compras` |
| `onde esta o arroz` | `where is the rice` | `donde esta el arroz` |
| `o que tem na despensa` | `what is in the pantry` | `que hay en la despensa` |
| `quando vence o leite` | `when does the milk expire` | `cuando vence la leche` |
| `como esta minha preparacao` | `how prepared am i` | `como estoy de preparacion` |
| `ajuda` | `help` | `ayuda` |

Word order is forgiving where forgiving costs nothing. `tenho quanto de acucar`,
`restam quantos ovos` and `cuanto tengo de azucar` are all answered, because
these are read-only questions and the worst outcome of a generous reading is a
number you did not want. Writes are not treated this way.

`como esta minha preparacao` answers with the number the Preparedness card
shows, not with a number of its own. `execute` calls `evaluatePreparedness` with
the tracked categories from settings, exactly as the dashboard does, so the two
cannot drift apart. That matters because the two are not the same arithmetic as
a percentage of healthy items: categories count equally, so an empty water
category pulls the score down however full the pantry is. `execute.queries.test.ts`
asserts the equality rather than the plausibility of the spoken number.

### Changing

| Português | English | Español |
|---|---|---|
| `adiciona cinco latas de feijao` | `add five cans of beans` | `agrega cinco latas de frijoles` |
| `comprei 2 kg de arroz` | `i bought 2 kg of rice` | `compre 2 kg de arroz` |
| `usei 3 ovos` | `i used 3 eggs` | `use 3 huevos` |
| `tira meio quilo de arroz` | `take half a kilo of rice` | `quita medio kilo de arroz` |
| `usei meia duzia de ovos` | `i ate half a dozen eggs` | `comi media docena de huevos` |
| `poe mais 2 ovos` | `add 2 more eggs` | `pon mas 2 huevos` |
| `agora tenho 12 latas de feijao` | `now i have 12 cans of beans` | `ahora tengo 12 latas de frijoles` |
| `o leite vence dia 12` | `the milk expires on the 12th` | `la leche vence el 12` |
| `o arroz vence em 10 de outubro` | `the rice expires on october 10` | `el arroz vence el 10 de octubre` |
| `criar item 10 kg de arroz na despensa` | `create item 10 kg of rice in the pantry` | `crear item 10 kg de arroz en la despensa` |

The verb decides the direction and the reason. `comprei` records a purchase,
`usei` records consumption, and `agora tenho 12` records a correction — so the
movement history says why the number moved, not merely that it did.

### What is refused on purpose

| Said | Answer |
|---|---|
| `comprei arroz` | UNKNOWN |
| `add beans` | UNKNOWN |
| `quanto tem` | UNKNOWN |
| `poe menos 2 ovos` | UNKNOWN |
| `o arroz vence 31 de abril` | UNKNOWN |

A write with no number stays UNKNOWN. "I bought rice" is an ordinary sentence
and the tempting reading is +1, but nothing in it says one. Guessing writes a
number the user never said into an emergency food inventory and then tells them
it worked — the exact failure this design exists to prevent. UNKNOWN puts the
transcript back on the screen with examples beside it, where a person can see
what was heard and say the amount.

A question with no item is refused for the same reason: the item is what is
missing, not something the parser failed to hear.

`31 de abril` is refused rather than repaired. April has never had a 31st, so
there is no year in which that phrase means anything.

---

## How a phrase becomes an action

```
  transcript ──► parse ──► Intent ──► execute ──► Outcome ──► screen
                (pure)               (reads only)              │
                                                               │ Confirmar
                                                               ▼
                                                            commit
                                                          (the only writer)
```

**Fold and strip.** `foldText` lowercases and removes accents, so `Açúcar` and
`acucar` are the same word. Then sentence punctuation comes off. A period left
on the end reaches the item search as `%feijao.%`, which reports with total
confidence that you have none. Four characters survive: `/` for a date, `-` for
an ISO date, `'` because it belongs to the name carrying it, and `:` because the
create rules read it.

**Walk the rules.** Each language is one grammar file holding twelve rule
objects, tried in order; the first that both matches and builds wins. A rule may
decline by returning `null`, which is how `tira zero de arroz` fails to become
an adjustment rather than becoming a wrong one. Order is load-bearing:
`agora tenho 12 latas` must reach the SET_QUANTITY rule before the
QUERY_QUANTITY rule that also matches `tenho`. `parse.test.ts` pins it.

**Produce an Intent.** Eleven kinds, plus `UNKNOWN`. An Intent is data and
cannot act — it holds the spoken phrase, not a database identifier. That is what
makes the whole parser testable with a string and an expectation, and it is why
`src/voice/` performs no I/O at all.

**Resolve, then execute.** `resolve.ts` turns the phrase into a row using the
same search the inventory screen uses — the one that already folds accents and
ANDs across terms, which is exactly the matching a garbled transcript needs. A
phrase that fits two items raises **Which one?** rather than picking. It never
guesses a tie, because the user is not looking at a list.

**Answer or propose.** A question returns an answer, rendered as a sentence and,
if the setting is on, read aloud. A change returns a *pending write*: a
description of what would happen. Nothing has been written.

---

## Why nothing is written before confirmation

`execute.ts` has no write path. It returns a `PendingWrite` describing the
change; `commit.ts` is the only module in the feature that touches a
repository's write path, and it is called by the confirmation card's button and
by nothing else.

That is a structural property rather than a promise about the interface, and two
tests hold it there:

- `execute.writes.test.ts` spies on the driver, executes every changing intent
  in turn, and asserts that no `INSERT`, `UPDATE` or `DELETE` reaches it.
- `VoiceSheet.test.tsx` drives the real sheet against a real in-memory database.
  After a change is understood and the card is on screen, it reads the item's
  quantity straight out of the database and asserts it is still the old one.

The card names the item, the amount, and what the quantity becomes. Speech is
misheard often enough that a confirmation step is not ceremony; it is the only
place a mishearing can be caught before it becomes data.

After a write lands, the receipt is read back **out of the database** rather than
assembled from the request. What you hear is then a statement about what is
stored, which is the only thing worth saying to someone who is not looking at
the screen.

---

## How speech stays on the device

Three recognizers sit behind one seam, `SpeechRecognizer` in
`src/services/speech/recognizer.ts`. Above it nothing knows which is listening,
in the same way nothing above `SqlDriver` knows which database is answering.

**Android — the system recognizer.** `SpeechPlugin.java` fires
`ACTION_RECOGNIZE_SPEECH` with `EXTRA_PREFER_OFFLINE`. Android opens the
recognizer's own screen, records there, and hands back text. The microphone
belongs to the recognizer and never to this application, so there is no
`RECORD_AUDIO` to declare — which is why this route was chosen over the
`SpeechRecognizer` API and over the community Capacitor plugin, both of which
need the permission. `EXTRA_PREFER_OFFLINE` is a request, and what it is worth
depends on the recognizer installed on the phone. The interface says on-device
speech is a capability of the device, not a guarantee this application can make
on the device's behalf.

The plugin is Java, not Kotlin, because this Gradle build has no Kotlin plugin.
One class is not a reason to add a language toolchain, a stdlib dependency and a
second way for the APK build to break.

**Chrome — `processLocally`, failing closed.** `webspeech.ts` is the only module
permitted to construct `SpeechRecognition`. It sets `processLocally = true`
first and unconditionally, and it refuses to start unless
`availableOnDevice(tag)` reports a model for that language. `processLocally`
fails **closed**: with no local model the call errors rather than quietly
reaching a server. That property is what makes this API usable here at all,
because the default mode of it streams audio to Google.

**Everything else — nothing.** `none.ts` reports unavailable and throws if asked
to listen. Safari exposes `webkitSpeechRecognition` but not `availableOnDevice`,
so there is no way to require local transcription and `availability()` returns
unavailable before anything is constructed. Firefox is the same. On those
browsers the microphone button says why it will not be used and opens the typed
box.

Availability is asked per language, not per device. A phone with an English
model and no Portuguese one is ready for one and unavailable for the other, so
switching the interface language asks again.

### What enforces this

In the order it holds:

1. **The Content-Security-Policy.** `index.html` declares `connect-src 'self'`.
   An implementation that shipped audio to a server *itself* would have nowhere
   to send it. This is the structural one: it constrains what the code can do
   rather than what it may say.
2. **`processLocally = true`.** The browser makes the Web Speech API's own
   network calls, out of reach of the CSP, so inside that one implementation
   this flag is the only thing between it and a server.
3. **The build audit.** `scripts/audit-offline.mjs` fails the build if the
   literal identifier `SpeechRecognition` appears anywhere in `src/` other than
   `webspeech.ts`. It is a text match on one spelling over source files, and it
   is evadable — a name assembled at runtime passes it. It catches the second
   use site somebody adds in good faith, which is the failure that actually
   happens.

None of the three is sufficient alone, and the third is the weakest.

### The one place a byte crosses the network

**Settings → Speech recognition → Install.** When Chrome reports the language
pack as downloadable, that button appears and calls `installOnDevice(tag)`,
asking the browser to download a speech model.

That is the browser fetching on an explicit press, not the page fetching on its
own, which is why the offline audit does not flag it. It never happens
automatically, and it is the only thing in this feature that touches the
network. The line above the button says both of those things, because the
decision is made there and not here.

The button never appears inside the APK. `install` is optional on the seam, and
only the Chrome implementation defines one; on Android the system recognizer
manages its own languages. So the installed Android application still has
nothing in it that reaches the network, which is what keeps that promise in
`docs/ANDROID.md` true.

### Reading answers aloud

The **Read answers aloud** setting uses `speechSynthesis`, a system service
rather than a network request — nothing in `speak.ts` fetches. The Web Speech
API does offer server-synthesised voices alongside on-device ones, so `speak.ts`
names a voice only when `SpeechSynthesisVoice.localService` is true for the
language, and names none at all otherwise.

That is a best effort rather than a guarantee. With no local voice installed for
your language, the platform may still resolve to a remote one, and the API gives
no way to refuse. On Android the system voice is on the phone. Switching the
setting off is the only thing here that is certain.

On Android the phone's silent switch wins over the setting: `SpeechPlugin`
reads the ringer mode, which a WebView cannot see on its own.

---

## What it will not do

- **No wake word, and no continuous listening.** The system recognizer
  transcribes one utterance per press. Hands-free listening means holding the
  microphone open, which means the permission this whole design exists to
  avoid.
- **No voice on iPhone, iPad or Safari.** No browser there offers a speech API
  that can be told to transcribe on the device, so the application declines to
  use one at all. The typed box works, and the interface says why rather than
  showing a microphone that fails.
- **No voice proven in the desktop build.** The same code ships, but
  `src-tauri/` has still never been compiled. Whether that webview exposes an
  on-device recognizer has not been observed, and nothing here claims it does;
  if it does not, `none.ts` answers and the typed box is what remains.
- **No conversation.** The engine answers the forms in the tables above.
  Anything else is UNKNOWN with examples, not a guess. It has no memory between
  sentences: each one is parsed on its own, so "and two more" refers to nothing.
- **No new categories, locations, contacts or settings by voice.** Speech reads
  the inventory and changes quantities, expiry dates, and creates items.
  Everything else is a screen.
- **No deleting or archiving by voice.** Destructive actions stay where they can
  be read before they are taken.

---

## Known limitations

Each was found by testing and is written down rather than filed away. None can
write without a press.

**A preposition is read as a location.** The create rules treat the first
preposition as a location marker, so `criar item atum em lata` yields the name
`atum` and the location `lata`, and `create item tuna in oil` yields `tuna` in
`oil`. What happens next depends on whether a location by that name exists: if
one does, a confirmation card appears naming a shelf you did not mean; if none
does — the usual case — the screen answers "I did not find \"lata\"", and the
**Create** button beside it creates the item unplaced. The cost is the lost half
of the name, and it is visible before anything is stored.

**Slashed dates are read day/month in every language.** `12/09` is 12 September
in English as well as in Portuguese and Spanish. The **Date format** setting is
not consulted here; it governs how dates are displayed, and the spoken parser
does not read it. Say the month by name — `october 10` — to be certain.

**English hundreds and thousands compose by multiplication.** English builds
large numbers out of `hundred` and `thousand` as multipliers where Portuguese
and Spanish have single words, so `two thousand five hundred` reads as 200500
rather than 2500. `one hundred and twenty`, `two hundred` and `one thousand` are
all correct. Nobody stocks a pantry in the thousands, and a wrong reading is
shown on the confirmation card before it is written.

**`tenho 5 ovos` is read as a question about an item called "5 ovos".** In
Portuguese and Spanish the same verb serves "I have" and "how many do I have",
and the question rules run first, so `tenho 5 ovos` returns QUERY_QUANTITY for
the phrase `5 ovos` and finds nothing. It is a slightly wrong answer to a
read-only question, never a wrong write. To state a quantity, say
`agora tenho 5 ovos`. English is not affected: `i have 5 eggs` is UNKNOWN.

**A spoken answer names three items and counts the rest.** "4 items expire
within 30 days: Leite, Arroz, Feijão and 1 more." A list read aloud past three
names is a list nobody follows. The count is the real one; the names are the
part that is cut. Two of the queries also read at most 50 rows — what is
expiring, and what is in a place — which is well past what anyone wants read
out, but it is a limit and not a total.

---

## Turning it off

**Settings → Voice control** hides the microphone in the header. While it is
off the header probes nothing and constructs no recognizer. The sheet and the
typed box are reached only through that button, so switching it off removes the
feature entirely rather than only its microphone.

The Settings screen still asks the device what it can do, so the **Speech
recognition** line reports honestly either way.

**Settings → Read answers aloud** keeps the microphone and stops the speaking.

---

## Adding a language

One file and one registry entry, the same rule `src/i18n/translate.ts` already
follows. A grammar is a rule list, a number table, a date table, unit and filler
words, and the examples shown by HELP and UNKNOWN. `parse.ts` takes a `Grammar`
and a string and knows nothing about any particular language, so no application
logic changes.

Write the phrase corpus first. `docs/TESTING.md` explains why.
