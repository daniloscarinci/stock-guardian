# The ask box: speaking, typing, and the engine behind both

Ask the inventory a question, or tell it what you just used, in a handful of
words. Say or type *"quanto arroz eu tenho?"* and read the answer — and hear it,
if the setting is on. Say *"usei 3 ovos"* and the stock moves, with **Desfazer**
offered for ten seconds. Say something the engine had to guess at, and a card
appears saying what would change, which changes nothing until you press
**Confirmar**.

The original application had none of this. It exists because the situation this
project is built for is one where you are holding a torch in one hand and a box
in the other, and a form with six fields is the wrong thing to be looking at.

Three facts shape every decision below.

**The box is the feature, and always was.** It is present on every platform, in
the same sheet, doing the same thing. Nothing about it is a fallback for
anything, which is why it survived the release where the microphone did not.

**The microphone tries your device first, every time, and the internet second.**
It was built, shipped, and did not work on the phone it was built for: Android's
recognizer refuses `EXTRA_PREFER_OFFLINE` when no offline Portuguese pack is
installed, and answers *"Voice search isn't available"*. It was removed, brought
back with an opt-in nobody had switched on, and said the same thing again. What
is here now is on-device first as the standard and the network as the fallback:
if the device cannot transcribe and the phone has a connection, the recognizer
is asked once more without the offline requirement, and the exchange is marked
**Transcribed online** so you can see it happened. **Settings → Ask → Transcribe
on this device only** refuses that fallback outright. See *Speaking instead of
typing*.

**Answers are read aloud.** Speaking is not listening: `speechSynthesis` opens
no microphone, asks for no permission, and sends nothing anywhere. See *Reading
answers aloud*.

Since the assistant shipped, this engine is one of two behind the same box. It
answers when the assistant is switched off or has no key, and whenever Claude
cannot be reached - and the sheet says which one answered. `docs/OFFLINE.md`
sets out what the other one sends.

---

## What you can say

Every row below is taken from `src/voice/grammar/*.phrases.test.ts`, which is a
corpus rather than a sample: 848 rows across the three languages, and a phrase
that is not in it is a phrase this document does not claim. They are written the
way speech arrives - lowercase, and often without accents - because that is what
the parser has to survive, and it survived it through the release that had no
microphone to produce it.

Accents, capitals and question marks are all optional. `o que ta vencendo` and
`O que está vencendo?` fold to the same thing before any rule sees them.

A one-page version of this table, formatted to read on a phone or print for a
wall, is at <https://claude.ai/code/artifact/fe802827-2be9-46fc-8529-cddf3e5b23c4>.
It carries the same phrases, and every one of them was run through `parse()`
before it was published.

### Asking - eleven questions, none of which writes anything

| What it tells you | Português | English | Español |
|---|---|---|---|
| How much you have | `quanto arroz eu tenho`<br>`sobrou arroz` | `how much rice do i have`<br>`any rice left` | `cuanto arroz tengo`<br>`queda arroz` |
| What is expiring | `o que ta vencendo`<br>`o que ja venceu` | `is anything expiring`<br>`what expires this week` | `que esta por vencer`<br>`que vence esta semana` |
| What is running out | `o que ta faltando`<br>`o que preciso repor` | `what am i low on`<br>`what have i run out of` | `que me hace falta`<br>`que tengo que reponer` |
| Where something is | `onde ta o arroz` | `where is the rice` | `donde esta el arroz` |
| What is in a place | `o que tem na despensa` | `whats in the pantry` | `que hay en la despensa` |
| What is in a category | `o que tem na categoria alimentos` | `whats in the food category` | `que hay en la categoria alimentos` |
| When one thing expires | `quando vence o leite` | `when does the milk expire` | `cuando vence la leche` |
| An item's history | `quando comprei arroz` | `when did i last buy rice` | `cuando compre arroz` |
| A phone number | `qual o telefone do medico` | `whats the doctors number` | `cual es el telefono del medico` |
| How prepared you are | `como ta minha preparacao` | `how prepared am i` | `que tan preparado estoy` |
| How much there is of everything | `quantos itens eu tenho` | `how many items do i have` | `cuantos items tengo` |

### Changing - seven, each confirmed or undoable

| What it does | Português | English | Español |
|---|---|---|---|
| Add or take away | `adiciona cinco latas de feijao`<br>`usei 3 ovos` | `add five cans of beans`<br>`i used 3 eggs` | `agrega cinco latas de frijoles`<br>`use 3 huevos` |
| Correct a count | `agora tenho 12 latas de feijao` | `now i have 12 cans of beans` | `ahora tengo 12 latas de frijoles` |
| Set an expiry date | `o leite vence dia 12`<br>`o arroz vence em 10 de outubro` | `the milk expires on the 12th` | `la leche vence el 12` |
| Add something new | `criar item 10 kg de arroz na despensa` | `create item 10 kg of rice in the pantry` | `crear item 10 kg de arroz en la despensa` |
| Move it somewhere else | `move o arroz para o porao` | `move the rice to the cellar` | `mueve el arroz al sotano` |
| Set a minimum | `o minimo de arroz e 5 quilos` | `the minimum for rice is 5 kg` | `el minimo de arroz es 5 kilos` |
| Set a target | `quero ter 20 latas de feijao` | `i want 20 cans of beans` | `quiero tener 20 latas de frijoles` |

`ajuda` / `help` / `ayuda` lists examples in whichever language the interface is
set to, drawn from the grammar itself so they cannot drift out of date.

### The two that are not on the list

`MOVE_ITEM` refuses a destination that does not exist rather than moving an item
to nowhere, and it declines a phrase that names a quantity - `coloca 2 quilos de
arroz na despensa` is two kilos arriving on a shelf, not a partial move, and an
item holds one location. A partial move is not something this application can
perform, so it is not something this parser pretends to understand.

`SET_MINIMUM` and `SET_TARGET` ask before storing a number counted in a unit the
row does not keep. A wrong adjustment shows up the next time anyone looks at the
quantity; a wrong minimum shows up as a replenishment list that is quietly wrong
about what is running out.

### Numbers and dates

Numbers may be words: `cinco`, `vinte e cinco`, `meia duzia`, `meio quilo`,
`dois mil`. `1,5` is one and a half, with the comma Portuguese and Spanish write.

Dates may be vague: `hoje`, `amanha`, `dia 12`, `12 de setembro`, `em marco`,
`daqui a 30 dias`, `semana que vem`. A bare month means its last day, because
"vence em marco" names a deadline rather than an instant.

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
cannot act — it holds the phrase as typed, not a database identifier. That is what
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

The card names the item, the amount, and what the quantity becomes. A phrase is
matched loosely often enough that a confirmation step is not ceremony; it is the
only place a wrong match can be caught before it becomes data. That is truer
still of the assistant, whose every proposal is a card: a grammar fails by not
understanding, and a model fails by understanding something else.

After a write lands, the receipt is read back **out of the database** rather than
assembled from the request. What you hear is then a statement about what is
stored, which is the only thing worth saying to someone who is not looking at
the screen.

---

## Reading answers aloud

The **Read answers aloud** setting uses `speechSynthesis`, a system service
rather than a network request — nothing in `speak.ts` fetches. The Web Speech
API does offer server-synthesised voices alongside on-device ones, so `speak.ts`
names a voice only when `SpeechSynthesisVoice.localService` is true for the
language, and names none at all otherwise.

That is a best effort rather than a guarantee. With no local voice installed for
your language, the platform may still resolve to a remote one, and the API gives
no way to refuse. On Android the system voice is on the phone. Switching the
setting off is the only thing here that is certain.

On Android the phone's silent switch wins over the setting: `RingerPlugin`
reads the ringer mode, which a WebView cannot see on its own. It is one method,
`isSilent`, needing no permission and recording nothing;
`src/services/speech/ringer.ts` is the other half of it.

It used to be part of `SpeechPlugin` and it is not again. Reading the ringer
switch belongs to the speaker; recognizing speech belongs to the microphone.
Keeping them apart means nothing about playing a sentence pulls a recognizer
into its module graph, and an APK that can speak needs nothing from the plugin
that listens.

---

## Speaking instead of typing

The microphone is in the sheet, beside the box, not in the header. Press it, say
one sentence, and what comes back goes to the same `run` the **Send** button
calls: a spoken question and a typed one take the same path from the first line.

It is in the sheet rather than in the header on purpose, and the reason is the
bug this feature died of. The header button used to be the microphone: pressing
it opened the sheet and started a listen in the same gesture. On a phone with no
offline pack, that means a warning panel on top of the box every single time you
open the sheet to type. The failure that killed this feature was a control that
appeared dead; burying the control that works under an explanation of the one
that does not is the same mistake wearing a hat.

### The device first, the internet second, and the second one is visible

**The on-device attempt is not a preference — it is the request the recognizer
is given, and it is given on every press.** On Android the plugin sends
`EXTRA_PREFER_OFFLINE`; in Chrome the recognizer sets `processLocally = true`,
which fails closed. With no model on the device for your language that attempt
fails rather than quietly going looking for a network. On a phone that has the
language, this is where it ends and nothing leaves.

**If it fails and the phone has a connection, the same call runs once more
without the offline requirement.** The system recognizer then transcribes over
the network, which on most phones means Google receives what you said. Four
rules bound it, and `src/services/speech/online.ts` is the whole of them:

- **Second, never first.** The retry lives only in the failure path of the
  on-device attempt.
- **Never after a cancel.** Press back and nothing else happens.
- **Never with no connection.** `navigator.onLine` is read as a hint in one
  direction: a definite *no* stops the retry; a *yes* it cannot verify lets the
  attempt run and fail, which costs a second.
- **At most once.** A failing retry reports the first failure and stops.

**The exchange says so.** *Transcribed online* / *Transcrito pela internet* /
*Transcrito por internet* appears in the log beside the marker naming which
engine answered. Most presses never show it, which is the point of showing it.

**Why the retry is not aimed more precisely.** The Intent flow returns no error
extra and the two constants that name a missing language pack never reach it
(see *What Android actually tells you*), so a retry that waited for a diagnosis
would not fire on the phone this exists for. It fires on any failure but a
cancel. A wasted retry costs a second; a missed one is a dead button.

**Settings → Ask → Transcribe on this device only** turns the second attempt off
for good: what you say never leaves the phone, and a language with no offline
pack simply will not transcribe. It is off as shipped, and it is named for the
restriction rather than for a permission so that the label states what it does.
It replaces `voiceAllowOnline`, and a row stored under the old name is not read
in either direction — `seedDatabase` writes every default on first run, so a
stored `voiceAllowOnline: false` says *never touched* far more often than it
says *refused*.

Nothing switches it for you. Not a retry, not a failure, not an upgrade. A
failure may put the switch in front of you; only you move it.

### When it fails, it says which failure

Every unsuccessful listen used to arrive as "cancelled", and a cancellation is
the one failure this interface answers with silence — correctly, because a
banner after a deliberate *never mind* teaches people to ignore banners. Those
two reasonable decisions together made a microphone that failed in total
silence.

The plugin now returns a code and the interface owns the sentence, because the
plugin cannot know which of three languages you read:

| What happened | What you see |
|---|---|
| You pressed back | Nothing at all. It was deliberate. |
| No offline model for your language | The panel below |
| Nothing on the device transcribes | *This device cannot transcribe speech on its own* |
| The recognizer wanted a network | *The recognizer went looking for the internet and did not find it* |
| It heard nothing it could read | *I did not hear anything. Try again, or type the command* |
| Something else holds the microphone | *Something else is using the microphone* |
| Anything else | *The microphone could not be used. Typing works* |

The missing-model case gets a panel rather than a sentence, because it is the
only failure with something you can actually do about it — and it now reaches
you only where the second attempt could not run, which is either *no connection*
or *you asked for on-device only*. The panel says which, and carries all three
ways forward: the install path for the offline pack, folded away until you ask
for it; **Type the command instead**, which dismisses the panel and puts the
cursor in the box; and the on-device-only switch itself, in the same words as
the Settings row, with a line under it saying what it is currently doing.

The switch is on the panel deliberately. The first version of this named the
setting in a sentence and sent you to Settings to find it, having just told you
your phone had no *offline speech pack* — a term nobody outside this repository
uses. Sending somebody hunting through a settings screen after a failure they
cannot interpret is how this failed the first time.

### What Android actually tells you, and what is guessed

Less than you would like. `ACTION_RECOGNIZE_SPEECH` hands recording to the
system, which is why this application declares no `RECORD_AUDIO` — but the
result `Intent` carries no error extra. `EXTRA_RESULTS` and
`EXTRA_CONFIDENCE_SCORES` are its whole documented contents, so the entire
diagnosis is the activity result code. `RecognizerIntent` documents five beyond
`RESULT_OK` and `RESULT_CANCELED`, and every one is mapped — but a recognizer is
free to answer `RESULT_CANCELED` instead, and Google's commonly does. The two
constants that name a missing offline model, `ERROR_LANGUAGE_UNAVAILABLE` and
`ERROR_LANGUAGE_NOT_SUPPORTED`, arrive through `RecognitionListener`, which
belongs to the API that needs the microphone permission. They never reach an
`Intent` result.

So a missing model is established two other ways, in this order:

1. **Before the dialog opens**, by asking `checkRecognitionSupport` which
   languages are installed. That is API 33 and up, it records nothing, and it
   needs no permission: it is a question about the recognizer, not a use of the
   microphone. A definite *the installed list is not empty and your language is
   not in it* rejects before anything opens.
2. **Below API 33, or when that cannot answer**, by how fast `RESULT_CANCELED`
   comes back. A refusal returns at once; a person deciding not to speak cannot
   open the dialog, read it and press back inside a second. **This one is a
   heuristic.** It names *no offline model* only where the pre-flight did not
   establish that the model is there, and any other instant `RESULT_CANCELED` is
   reported as a plain failure rather than as a cancellation.

   That last part matters more than it looks. `cancelled` renders as nothing
   *and* stops the second attempt, so guessing it wrongly costs the whole
   feature — which is what happened the first time. Guessing *failure* wrongly
   costs one sentence. Both attempts pass through this, and an instant
   `RESULT_CANCELED` on the second one is a recognizer refusing, not somebody
   changing their mind inside a second.

`android/.../SpeechPlugin.java` says the same thing at greater length, next to
the code it describes.

### Package visibility, which is not a permission

The manifest carries a `<queries>` element naming
`android.speech.RecognitionService` and `android.speech.action.RECOGNIZE_SPEECH`.
From Android 11 an application sees no other application it has not named, so
without it `queryIntentActivities` returns an empty list and the microphone
reports itself unavailable on every modern phone. It grants nothing and asks for
nothing. It is not `QUERY_ALL_PACKAGES`, which is a permission and is not there.

---

## What it will not do

- **No wake word, and no continuous listening.** One utterance per press. The
  Intent has no continuous mode, and an application that listens without being
  asked is not one to build on a promise about what leaves the device.
- **No `RECORD_AUDIO`, ever.** The system's recognizer holds the microphone and
  this application is handed a sentence. The check in
  `.github/workflows/android.yml` fails the build on that permission.
- **No conversation.** The engine answers the forms in the tables above.
  Anything else is UNKNOWN with examples, not a guess. It has no memory between
  sentences: each one is parsed on its own, so "and two more" refers to nothing.
- **No new categories, locations, contacts or settings from the box.** It reads
  the inventory and changes quantities, expiry dates, and creates items.
  Everything else is a screen.
- **No deleting or archiving from the box.** Destructive actions stay where they
  can be read before they are taken.

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
not consulted here; it governs how dates are displayed, and the parser does not
read it. Name the month — `october 10` — to be certain.

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
read-only question, never a wrong write. To state a quantity, type
`agora tenho 5 ovos`. English is not affected: `i have 5 eggs` is UNKNOWN.

**An answer names three items and counts the rest.** "4 items expire
within 30 days: Leite, Arroz, Feijão and 1 more." A list read aloud past three
names is a list nobody follows. The count is the real one; the names are the
part that is cut. Two of the queries also read at most 50 rows — what is
expiring, and what is in a place — which is well past what anyone wants read
out, but it is a limit and not a total.

---

## Turning it off

**Settings → Ask → The ask button** hides the button in the header. The sheet
and the box inside it are reached through that button and through nothing else,
so switching it off removes the feature rather than only its entry point.

**Settings → Ask → Read answers aloud** keeps the box and stops the speaking.

**Settings → Ask → Transcribe on this device only** is off. Switching it on
removes the second attempt entirely and returns the microphone to the absolute
behaviour: nothing you say ever leaves the phone, and a language with no offline
pack will not transcribe. Nothing else in the application writes that setting.

Neither is the assistant's switch. **Settings → Ask Claude** decides which
engine answers, and with it off - or with no key pasted - this one does, and
nothing is sent anywhere.

---

## Adding a language

One file and one registry entry, the same rule `src/i18n/translate.ts` already
follows. A grammar is a rule list, a number table, a date table, unit and filler
words, and the examples shown by HELP and UNKNOWN. `parse.ts` takes a `Grammar`
and a string and knows nothing about any particular language, so no application
logic changes.

Write the phrase corpus first. `docs/TESTING.md` explains why.
