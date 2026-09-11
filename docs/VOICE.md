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
It was built, shipped, and did not work on the phone it was built for. It was
removed, brought back with an opt-in nobody had switched on, and did not work
again. What is here now is on-device first as the standard and the network as
the fallback: if the device cannot transcribe and the phone has a connection,
the recognizer is asked once more without the offline requirement, and the
exchange is marked **Transcribed online** so you can see it happened. **Settings
→ Ask → Transcribe on this device only** refuses that fallback outright. See
*Speaking instead of typing*.

**Android asks you for the microphone now, and it did not use to.** For four
releases this page said the application never requested that permission, and it
was true: speech went through Google's own voice search screen, which held the
microphone and handed back a sentence. On the phone this exists for that screen
never opened — Android answered *"Voice search isn't available"* — while the
keyboard's voice typing on the same phone worked perfectly. So the application
now binds the speech service directly, the way the keyboard does, and that means
it records and needs `RECORD_AUDIO`. See *The permission, and the design it
replaced*.

**Answers are read aloud, and on Android they did not use to be.** Speaking is
not listening: it opens no microphone, asks for no permission, and sends nothing
anywhere. What it did need was a second implementation — Android's WebView
exposes `speechSynthesis` and does not implement it, so inside the app every
answer appeared as text and none was ever spoken. See *Reading answers aloud*.

**And it says hello when you open it.** One sentence: the time of day, then the
one or two things that need doing. See *The welcome*.

Since the assistant shipped, this engine is one of two behind the same box. It
answers when the assistant is switched off or has no key, and whenever Claude
cannot be reached - and the sheet says which one answered. `docs/OFFLINE.md`
sets out what the other one sends.

---

## What you can say

Every row below is taken from `src/voice/grammar/*.phrases.test.ts`, which is a
corpus rather than a sample: 920 rows across the three languages, and a phrase
that is not in it is a phrase this document does not claim. They are written the
way speech arrives - lowercase, and often without accents - because that is what
the parser has to survive, and it survived it through the release that had no
microphone to produce it.

Accents, capitals and question marks are all optional. `o que ta vencendo` and
`O que está vencendo?` fold to the same thing before any rule sees them.

A one-page version of this table, formatted to read on a phone or print for a
wall, is at <https://claude.ai/code/artifact/fe802827-2be9-46fc-8529-cddf3e5b23c4>.
It carries the phrases this table held at 2.5.0, each one run through `parse()`
before it was published; the three creating sentences added since are not on it
yet.

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

### Changing - ten, each confirmed or undoable

| What it does | Português | English | Español |
|---|---|---|---|
| Add or take away | `adiciona cinco latas de feijao`<br>`usei 3 ovos` | `add five cans of beans`<br>`i used 3 eggs` | `agrega cinco latas de frijoles`<br>`use 3 huevos` |
| Correct a count | `agora tenho 12 latas de feijao` | `now i have 12 cans of beans` | `ahora tengo 12 latas de frijoles` |
| Set an expiry date | `o leite vence dia 12`<br>`o arroz vence em 10 de outubro` | `the milk expires on the 12th` | `la leche vence el 12` |
| Add something new | `criar item 10 kg de arroz na despensa` | `create item 10 kg of rice in the pantry` | `crear item 10 kg de arroz en la despensa` |
| Move it somewhere else | `move o arroz para o porao` | `move the rice to the cellar` | `mueve el arroz al sotano` |
| Set a minimum | `o minimo de arroz e 5 quilos` | `the minimum for rice is 5 kg` | `el minimo de arroz es 5 kilos` |
| Set a target | `quero ter 20 latas de feijao` | `i want 20 cans of beans` | `quiero tener 20 latas de frijoles` |
| Make a place | `novo lugar, porao`<br>`criar area: quintal` | `new place, cellar`<br>`add a place called the cellar` | `nuevo lugar, sotano`<br>`crear zona: garaje` |
| Make a category | `nova categoria, ferramentas`<br>`criar grupo: agua` | `new category, tools`<br>`make a category: water` | `nueva categoria, herramientas`<br>`crear grupo: agua` |
| Add an emergency contact | `novo contato, ana`<br>`adiciona um contato chamado ana fone 555 1234` | `new contact, ana`<br>`add a contact called ana phone number 555 1234` | `nuevo contacto, ana`<br>`agrega un contacto llamado ana numero de telefono 555 1234` |

`ajuda` / `help` / `ayuda` lists examples in whichever language the interface is
set to, drawn from the grammar itself so they cannot drift out of date.

### Six of them are offered before anything fails

Open the sheet with nothing in the log and six of those same examples sit under
it as chips, headed **Try one of these**. Pressing one puts the sentence in the
box and the cursor in it. It does not send it, and that is the whole reason they
are worth having: a first press should not add five cans of beans to somebody's
inventory, it should show the shape of a sentence this application understands
so that the next one can be their own.

There are twelve examples per language and the sheet shows the first six. These
are whole sentences, so at phone width most of them take a row to themselves,
and every row stands above the microphone and the box. The six are ordered to
carry six different shapes - one item's quantity, what is going off, what to
buy, stock arriving, stock going, and a place being made. All twelve are still
read out by `ajuda` / `help` / `ayuda`, and by any sentence that was not
understood.

They go once there is a history. By then the log is the better teacher, and six
buttons would be standing between the reader and their own conversation. They
sit outside that log rather than at the top of it, because the log is an
`aria-live` region and six examples appearing and then disappearing is not news.

### Three sentences that make something

The last three rows of the table are the only ones here whose subject is not
stock, and all three read the same shape: a creating word, a noun the rule
watches for, and a name. `create`, `add`, `new` and `make` in English; `criar`,
`cria`, `adicionar`, `adiciona`, `novo` and `nova` in Portuguese; `crear`,
`crea`, `agregar`, `agrega`, `anadir` and `anade` in Spanish, with `nuevo` or
`nueva` allowed on either side of the noun. The name may be introduced by
`called` or `named` - `chamado`, `llamado` - by a colon, or by nothing at all,
and a leading article comes off, so `add a place called the cellar` names the
place `cellar`.

**A name that is already taken is answered rather than made twice.** `new place,
cellar` said on a pantry that has a cellar does not propose a second one; it
reads back what that shelf holds, from the same helper `o que tem na despensa`
uses. A category behaves the same way. Two places whose names you cannot tell
apart is a worse outcome than being reminded of the one you have, because stock
would start landing on both and neither would then answer "what is in the
cellar" truthfully.

**A contact carries a spoken phone number, read as digits.** `new contact ana
phone five five five one two three four` stores `5551234`. A number said one
digit at a time is not arithmetic - `five five five` is 555 to anybody reading
it back and 15 to anything that adds - so the words are mapped to digits one by
one, and a word that is not a digit refuses the whole sentence: `phone five
hundred` produces no intent at all, rather than a contact stored without the
half the speaker cared about. A relationship is kept where the sentence gives
one, as `new contact my sister ana` does. `contacts.search` reads the
relationship as well as the name, and it is often the handle somebody reaches
for when they ask for the number later.

A name is all a place and a category take, and a name, a relationship and a
number are all a contact takes. A parent shelf, a description, an icon, a
colour, a sort order, notes and a priority are left to the screens, because not
one of them is a thing anybody says out loud - and neither is an email address,
which heard aloud is a guess at somebody's spelling.

**A category is named in one language - the one the interface is in.** The
twenty built-in categories ship named in all three, and copying a spoken name
into the other two columns would be writing English into the Portuguese one and
presenting it as a translation. So the other two fall through: to the English
name where there is one, and otherwise to the row's id, which is a slug of the
name. A category made in Portuguese as *Kit de fuga* reads as `kit-de-fuga` on
an English phone until somebody names it there on the Categories screen.

### What the bare space costs

`new place cellar` and `new room spray` are token-for-token identical - a
creating word, a noun the rule already watches for, and one more word - and a
regex has no lexicon to tell a cellar from a spray with. The rule can require
`called` or `named` after `new` as well, which refuses the plainest way anybody
names a place, or it can leave the bare space and accept both. No pattern here
keeps the first and loses the second.

So the bare space stays, and this is what it costs. `new room spray` makes a
place called `spray` rather than one called `room spray`; `new group buy` makes
a category called `buy`; `new contact lenses` makes a person called `lenses`.
Spanish pays it on `nuevo grupo electrogeno` - a generator set, filed as a
category called `electrogeno` - and Portuguese on `novo grupo de risco`, filed
as `de risco`.

`create`, `add` and `make` are narrowed instead, because a sentence opening with
one of them has somewhere else to land. All three require `called`, `named` or a
colon, so `add a room spray` is one more can of spray on the stock, `add contact
lenses` is one more box of lenses, and `make room in the pantry` stays UNKNOWN
exactly as it did before any of this existed. The separator is always a real
space or a colon and never the empty match, so `grouper`, `agrupacion` and
`contacted` are never split into a noun and a name.

Nothing is written on the guess. `new room spray` arrives as a card headed
*spray* reading "No place is called spray. Confirming makes it.", with Cancel
beside the button that would make it - and the Locations screen can rename the
row afterwards.

### The two that are not on the list

`MOVE_ITEM` declines a phrase that names a quantity - `coloca 2 quilos de arroz
na despensa` is two kilos arriving on a shelf, not a partial move, and an item
holds one location. A partial move is not something this application can
perform, so it is not something this parser pretends to understand. It no longer
refuses a destination that does not exist; see *A place the sentence named and
the pantry does not have*.

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

**Walk the rules.** Each language is one grammar file holding twenty-two rule
objects, tried in order; the first that both matches and builds wins. A rule may
decline by returning `null`, which is how `tira zero de arroz` fails to become
an adjustment rather than becoming a wrong one. Order is load-bearing:
`agora tenho 12 latas` must reach the SET_QUANTITY rule before the
QUERY_QUANTITY rule that also matches `tenho`, and the rules that make a place,
a category and a contact must reach `add a place called the cellar` before
ADJUST_QUANTITY does, whose verb map claims `add`, `adiciona` and `agrega` as
well. `parse.test.ts` pins it.

**Produce an Intent.** Twenty-one kinds, plus `UNKNOWN`. An Intent is data and
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

### A place the sentence named and the pantry does not have

`move the rice to the cellar` used to end there when no cellar existed. Every
word had been understood and the item had been found, and the answer was still
"I did not find the cellar" with nothing to press. That was a dead end, and a
dead end in the one part of this application built for somebody holding a torch.

The card carries it now. A move, or a creation, naming a place that is not there
proposes the place alongside the write, under a line reading "No place is called
cellar. Confirming makes it." One press makes the shelf and moves the rice, and
Cancel makes neither. The reason shown is `newLocation` rather than `location`,
and the difference is what it asks you to check: `location` picked one of your
shelves and asks which one, `newLocation` found none and asks about the spelling
of a name that is about to become a row. A place named on its own - `new place,
cellar` - is the same write without the move, and the same card.

**Undo takes back both.** A receipt is a list of actions in the order they have
to run, which is the reverse of the order they were written in, so this one puts
the rice on its old shelf and then deletes the empty cellar. An undo that took
back only the move would leave a shelf nobody asked for.

One gap is left open deliberately. The place is written first and the move
second, and the item can be deleted from the Inventory screen while the card is
on screen; the move then fails and no receipt comes back to take the place away.
What is left behind is an empty shelf carrying the name you said, listed on the
Locations screen and deletable there like any other - and saying the sentence
again finds it, so the second attempt is an ordinary move onto a shelf that
exists. Compensating for it would mean another write that can fail in its turn,
and `commit` is handed repositories rather than the driver, so there is no
transaction to wrap the pair in.

---

## What the assistant can propose

Claude is handed twenty-one functions: eleven that read and ten that only
propose. The ten are the grammar's ten, and matching them is the point of the
number - `adjust_quantity`, `set_quantity`, `create_item`, `set_expiry`,
`move_item`, `set_minimum`, `set_target`, `create_location`, `create_category`
and `create_contact`. Until this release it had the first four, which meant the
free engine on the device could do three things the paid one could not.

None of them writes. `converse.ts` runs its own tool-use loop rather than the
SDK's runner for exactly this reason: a runner executes the tools it is given,
which is right for the eleven that read and wrong for these ten, each of which
has to be intercepted, turned into a pending write, and answered with "the user
has not agreed to this yet". What reaches the screen is the same card a spoken
sentence produces, and `commit` is the same and only writer.

**Every proposal is `assumed`, never `explicit`.** `execute` keeps `explicit`
for the narrow case where the user's own words named an exact item and an exact
amount, and a sentence that has been through a model has no such case: the model
chose the row and chose the reading, and it may have chosen well, but the user
did not say it. So every proposal carries at least one reason and the first of
them is `assistant`, which says who chose.

`create_contact` takes an email and a place where the spoken sentence takes
neither. A model is reading typed text rather than a transcript, so an address
it was shown is an address it can spell.

**The unit on a minimum or a target is a flag, not a guarantee.** `set_minimum`
and `set_target` take an optional unit and compare it with the one the row is
kept in, exactly as `adjust_quantity` does. Because it is optional, an absent
unit reads exactly like a matching one, and only a unit that is named and wrong
is ever caught. What is structural rather than hoped for is that the card prints
the item's own stored unit beside every number on those two writes whatever
Claude sent, so the person confirming checks the true unit against their memory
of the shelf; and the tool result hands that same stored unit back to Claude
before it says anything to the user at all.

---

## Reading answers aloud

The **Read answers aloud** setting speaks through a system service rather than a
network request — nothing in `speak.ts` fetches.

**It is two implementations behind one seam**, exactly as the microphone is.
`speak.ts` chooses per sentence: `tts.ts`, which reaches
`android.speech.tts.TextToSpeech` through the hand-written `TtsPlugin`, inside
the APK; `websynthesis.ts`, which uses `speechSynthesis`, in a desktop browser
and in the installed PWA.

**Why there are two.** Until this release there was one, it called
`speechSynthesis`, and it read nothing aloud on Android. The WebView *exposes*
the Web Speech synthesis API without implementing it: the object is present, so
every check passed; `getVoices()` returned an empty list, which is why the voice
menu below has never appeared on a phone; `speak()` accepted every sentence and
played silence; and nothing anywhere raised an error. That is the same shape as
the microphone bug that cost four releases — a web API that exists, satisfies
every guard and quietly does nothing while the native path underneath it works —
and it has the same answer.

**A voice is named only when it is on the device.** Both platforms offer
server-synthesised voices alongside on-device ones, and a remote voice would mean
the sentence — which names what is in your stock — being sent away to be spoken.
So the automatic choice takes a local voice or names none at all. On the web that
rests on `SpeechSynthesisVoice.localService`; on Android it rests on
`Voice.isNetworkConnectionRequired()`, which is the engine stating a requirement
rather than the browser summarising one, so the preference is stronger there, not
weaker. The rule itself lives once, in `src/services/speech/voices.ts`, and both
paths obey it.

That is a best effort rather than a guarantee. With no local voice installed for
your language, the platform may still resolve to a remote one, and neither API
gives a way to refuse. Switching the setting off is the only thing here that is
certain.

### Which voice reads them

Settings offers a **Which voice** menu under **Read answers aloud**. It lists the
voices this device already has for the interface language, and **Hear it** beside
it reads one real sentence in that language — *"Você tem 12 latas de feijão."*,
*"You have 12 cans of beans."*, *"Tienes 12 latas de frijoles."* — so you hear the
voice saying the kind of thing it is going to say rather than the word "test".

Nothing is downloaded to fill that list. It is whatever this device already has,
filtered to the language: `TextToSpeech.getVoices()` on Android,
`speechSynthesis.getVoices()` in a browser. The choice is stored as one
`voiceURI` in `speakingVoiceUri`. The default is empty, which means what it
always meant: no voice named, the language tag left to the platform, and an
on-device voice preferred where one matches exactly.

**On a phone this menu was always empty, and now it is not.** It read
`speechSynthesis.getVoices()`, which inside the APK returns nothing, so the
control never appeared at all. It now asks the phone's own engine. Voices the
engine marks as not installed are left out, because a choice that cannot speak is
not a choice.

**Hear it** speaks even when *Read answers aloud* is switched off. The press is
the consent — you are choosing a voice, and a preview button that silently does
nothing is the failure this whole screen is written against. It used to be
exactly that on Android. Both remaining ways for it to stay quiet now say so: the
phone's silent switch, which still wins, and a device that has no engine for this
language — which the browser could never tell us and the plugin can.

### Female and male are guessed, not known

**The Web Speech API has no gender field.** `SpeechSynthesisVoice` gives a
`name`, a `lang`, a `voiceURI`, a `localService` flag and a `default` flag.
There is no way to ask whether a voice is a woman's or a man's, and no way for a
platform to tell us. So this application does not store a gender and does not
show a two-way toggle. It shows the voices that exist, labels the ones whose
**names** admit to a gender, and says underneath the list that those labels are
guesses.

**Android's names admit to it far more often**, and this is the one place where
that changed. `TextToSpeech.getVoices()` returns identifiers like
`pt-br-x-afm#female_1-local`. That `#female` is the top row of the table below,
the only pattern here that is not a guess — and it had never once matched,
because the list the guess was reading was empty on the only device that ships
those names.

`inferVoiceGender` in `src/services/speech/voices.ts` reads three patterns, worth
progressively less:

| Pattern | Example | Worth |
| --- | --- | --- |
| `#female` / `#male` in the identifier | `pt-br-x-afm#female_1-local` | The engine said so. |
| The word written out, in English, Portuguese or Spanish | `Português (Brasil) - Feminino`, `Spanish (Spain) Male` | Also said so, in prose. |
| A given name from a short table of voices Apple, Microsoft and Android actually ship | `Luciana`, `Microsoft Daniel` | An inference about a name. The first of the three that can be wrong. |

**What is deliberately not decoded is Google TTS's three-letter code** — the
`afm` in `pt-br-x-afm-local`, the `pte` in `pt-br-x-pte-network`. Reading its
last letter as a gender is tempting, and it falls apart on the rest of the set:
`en-gb-x-gba`, `gbb`, `gbc` and `gbd` are four voices of mixed gender lettered in
sequence, and `es-es-x-eea` and `eef` are the same story. Any rule that produces
an answer for `afm` produces a wrong one for those, and a coin flip presented as
a fact is worse than saying nothing. Those voices are listed under the device's
own name for them, which looks like nothing and is still the truest label there
is.

Names that ship as both are also left alone. Apple's `Eddy`, `Flo`, `Reed`,
`Rocko`, `Sandy` and `Shelley` now come in male and female variants under one
name, so they are in neither table and infer nothing.

### On a phone with one voice, or none

**A phone with one Portuguese voice gets no menu.** It gets a sentence naming the
voice it has and saying there is nothing to choose between — and the **Hear it**
button, which still does something. A dead control that pretends to offer a
choice is exactly what this feature was built to avoid; this is that case stated
rather than hidden. A phone that lists no voice at all says so too, and answers
are still read aloud in whatever voice the system falls back to.

Where more than one voice exists but the interface language is `en` or `es`,
matching is on the primary subtag: an `en` interface is offered `en-GB` and
`en-US` voices, and a `pt-BR` one is offered a `pt-PT` voice below its Brazilian
ones, with the region shown in the label so nobody is handed European Portuguese
without being told.

### Two things that would otherwise break it

**`getVoices()` is empty on the first call.** In a browser it returns what has
loaded so far, and in Chrome that is nothing at all until the platform fires
`voiceschanged` a few milliseconds later. `speak.ts` can shrug that off by naming
no voice; a menu cannot. So the seam reports, with every list, whether its answer
is *settled* — which decides what an empty list is allowed to mean: "still asking
this device" before it, "this device has none" after. The browser says no until
it has listed something; the plugin always says yes, because it answers only once
the engine has initialised and its first answer is its last. A 1.5-second timer
settles it regardless, because a browser with no voices that also never fires the
event would otherwise say "still asking" forever.

**A chosen voice can vanish.** A language pack is uninstalled, the interface
language is switched to one the voice does not speak, a phone is restored from
another phone's backup. When the stored voice is not among the ones the device
lists, `speak.ts` falls through to exactly the local-first selection described
above and speaks anyway — a choice that has gone missing must never mean silence
— and Settings says the named voice is not installed rather than quietly
selecting something else. The stored value is matched against both `voiceURI` and
`name`, because some engines change one between releases and keep the other.

One thing the choice does change: **a voice you pick is used even when it is
synthesised on a server.** That is your decision, taken in front of a label
saying so and a warning explaining that the sentences read aloud name what is in
your stock. The automatic fallback still refuses remote voices; this is not the
automatic fallback.

On Android the phone's silent switch wins over the setting: `RingerPlugin`
reads the ringer mode, which a WebView cannot see on its own. It is one method,
`isSilent`, needing no permission and recording nothing;
`src/services/speech/ringer.ts` is the other half of it.

It used to be part of `SpeechPlugin` and it is not again. Reading the ringer
switch belongs to the speaker; recognizing speech belongs to the microphone.
Keeping them apart means nothing about playing a sentence pulls a recognizer
into its module graph, and an APK that can speak needs nothing from the plugin
that listens.

### An engine that never starts

`TextToSpeech` is useless until its `onInit` callback reports success, and
`speak` called before that plays nothing and reports nothing — the exact failure
this release exists to end. So no method in `TtsPlugin` touches an engine
directly. Every call is either run now, or parked until `onInit` answers, or
rejected because there is no engine to wait for. A call that arrives early waits;
it never vanishes.

And an engine that binds and then says nothing would leave every parked call
pending forever, so there is a five-second ceiling on initialisation. When it
expires the parked calls are answered, the engine is shut down, and the state
resets — deliberately not to "failed", because a timeout says this attempt did
not answer in time, not that the device cannot speak. The next call builds a
fresh engine. `TextToSpeech.shutdown()` also runs when the activity is destroyed,
because a leaked engine holds a bound service and an audio focus handle.

---

## The welcome

**The application says one sentence when you open it**, in the interface
language, and it is not only a greeting:

> Bom dia. 3 itens vencem hoje.
> Buenas tardes. 2 ítems han vencido. Un ítem vence hoy.
> Good evening. Nothing needs your attention.

A greeting on its own is a novelty that gets switched off within a week. This is
the shortest version of why you opened the application, said before you have to
look for it. Everything in it has already been counted for the navigation badge —
no query was added, and nothing renders from it.

**At most two facts**, in the order urgency runs: what has expired, what expires
today, what expires inside your warning window, what is below its minimum. A
spoken list cannot be scrolled back through, and the screen behind it shows all
four at once. When there is nothing, it says so and stops.

**The greeting is the time of day.** Portuguese and Spanish have three of them —
*bom dia*, *boa tarde*, *boa noite* — and being told *bom dia* at four in the
afternoon is worse than not being greeted, so the bands are theirs: morning until
noon, afternoon until six, night after that. Three in the morning is *boa noite*,
not *bom dia*. English is given the same bands rather than an invented set.

**Once per launch, and never again while you move between screens.** It lives in
the shell, which mounts once while every route inside it comes and goes.

**It is on by default**, and that is the only unprompted thing here that is. The
switch is **Settings → Ask → Say hello when the app opens**, independent of *Read
answers aloud* so that each control means what its label says. It stays quiet
when the phone is on silent, and when something else is already being read — a
greeting must never talk over an answer you asked for. The reverse is allowed: an
answer that starts a moment later interrupts the greeting, because between a
pleasantry and the thing you asked for, the thing you asked for wins.

**It never delays the interface.** It runs after the first paint, and the
application is drawn, scrollable and usable before a word is said.

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
is given, and it is given on every press.** On Android with API 33 or later the
plugin binds `createOnDeviceSpeechRecognizer`, the same on-device service the
keyboard's voice typing uses, which has no network of its own; on older phones
it binds the default service and sends `EXTRA_PREFER_OFFLINE`. In Chrome the
recognizer sets `processLocally = true`, which fails closed. With no model on
the device for your language that attempt fails rather than quietly going
looking for a network. On a phone that has the language, this is where it ends
and nothing leaves.

**If it fails and the phone has a connection, the same call runs once more
without the offline requirement.** The system recognizer then transcribes over
the network, which on most phones means Google receives what you said. Five
rules bound it, and `src/services/speech/online.ts` is the whole of them:

- **Second, never first.** The retry lives only in the failure path of the
  on-device attempt.
- **Never after a cancel, and never after a silence.** Press stop and nothing
  else happens. Say nothing and nothing else happens either: the retry is a
  fresh recording, not a second look at the same audio, so it would open the
  microphone again at somebody who has already stopped talking.
- **Never after a refused microphone.** A second attempt is a second refusal.
- **Never with no connection.** `navigator.onLine` is read as a hint in one
  direction: a definite *no* stops the retry; a *yes* it cannot verify lets the
  attempt run and fail, which costs a second.
- **At most once.** A failing retry reports the first failure and stops.

**The exchange says so.** *Transcribed online* / *Transcrito pela internet* /
*Transcrito por internet* appears in the log beside the marker naming which
engine answered. Most presses never show it, which is the point of showing it.

**Why the retry is aimed, and used not to be.** It fired on any failure but a
cancel, because the Intent flow returned no error and there was nothing to
condition on. The plugin now reads the real error constants (see *What Android
tells you now*), so the retry runs after a missing language pack, a network or
server error, or a recognizer that could not bind — and after nothing else. Each
failure it skips is a recording that is not made.

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
| You pressed stop | Nothing at all. It was deliberate. |
| No offline model for your language | The panel below |
| Nothing on the device transcribes | *This device cannot transcribe speech on its own* |
| The recognizer wanted a network | *The recognizer went looking for the internet and did not find it* |
| It heard nothing it could read | *I did not hear anything. Try again, or type the command* |
| Something else holds the microphone | *Something else is using the microphone* |
| You refused the microphone | *The microphone needs your permission, and it was not given* — the next press asks again |
| You refused it for good | A panel: *refused for good, so this phone will not ask again*, with **Open app settings** beside it |
| Anything else | *The microphone could not be used. Typing works* |

The last two are the permission, and they are separate on purpose. Refuse once
and Android will still show its prompt on the next press, so the way forward is
the microphone itself and a sentence is enough. Refuse twice and Android stops
showing it — a press would raise no dialog at all — so the only way back is this
application's own page in Settings, and the panel offers it. An application that
kept prompting into that void would be a control with an animation and no
effect.

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

### The permission, and the design it replaced

For four releases this application declared no `RECORD_AUDIO`, and the design
behind that was not a technicality. `SpeechPlugin` fired
`ACTION_RECOGNIZE_SPEECH`. Google's own voice search screen opened, the system
held the microphone, and the application was handed a sentence it had never
recorded. There was no audio stream here to ask permission for, and the check in
`.github/workflows/android.yml` proved it on every build. On every axis but one,
that is the better design.

The axis it failed on was the phone. On a **moto g35 5G** — the phone this whole
feature exists for — that Intent answers *"Voice search isn't available"*,
because the component behind it, Google Voice Search, is not on the device. Four
releases went into that wall. The last of them added a retry over the network,
which knocked on the same door and got the same answer.

**What ended the argument was the keyboard.** Gboard's voice typing works
perfectly on that phone. So the device can transcribe; it will not do it when
asked that way. Gboard does not fire the Intent — it binds the recognition
service directly, through `SpeechRecognizer`. That is what `SpeechPlugin` does
now, and that API records in this process, which is what `RECORD_AUDIO` is for.

The permission is asked for **on the first press of the microphone and never at
startup**, so somebody who opens the application to read what is in the pantry
is never asked about it. Refusing it is an outcome the interface handles, in the
two rows at the end of the table above. Typing is the same feature either way.

The manifest still carries a `<queries>` element, naming
`android.speech.RecognitionService`. From Android 11 an application sees no
other application it has not named, so without it the recognition service cannot
be found or bound and the microphone would report itself unavailable on every
modern phone. It grants nothing and asks for nothing, and it is not
`QUERY_ALL_PACKAGES`. The activity action
`android.speech.action.RECOGNIZE_SPEECH` used to be in there too, and came out
with the Intent that used it.

### What Android tells you now, and what is no longer guessed

The error codes are what the permission bought. `RecognitionListener.onError`
delivers the real constants, and `SpeechPlugin` maps every one of them:

| Android says | This says | Retried? |
|---|---|---|
| `ERROR_LANGUAGE_UNAVAILABLE`, `ERROR_LANGUAGE_NOT_SUPPORTED` | no offline model | yes |
| `ERROR_NETWORK`, `ERROR_NETWORK_TIMEOUT`, `ERROR_SERVER`, `ERROR_SERVER_DISCONNECTED` | network | yes |
| `ERROR_CLIENT`, `ERROR_AUDIO`, anything unmapped | failed | yes |
| `ERROR_NO_MATCH`, `ERROR_SPEECH_TIMEOUT` | nothing was heard | no |
| `ERROR_RECOGNIZER_BUSY` | busy | no |
| `ERROR_INSUFFICIENT_PERMISSIONS` | permission refused | no |

The first two rows are the point of the rewrite: `ERROR_LANGUAGE_UNAVAILABLE`
and `ERROR_LANGUAGE_NOT_SUPPORTED` are the two constants that name a missing
offline model, and they could never reach an `Intent` result at all. `failed`
is retried deliberately — an on-device recognizer that cannot bind reports
`ERROR_CLIENT`, and that is exactly the phone this exists for.

**The timing heuristic is deleted.** There used to be a guess in here: a
`RESULT_CANCELED` that came back faster than a person could press back was read
as a refusal rather than as a cancellation, because the Intent carried no error
and that was the only signal available. It existed to work around a silence this
API does not have. Nothing in the plugin guesses now.

Two things about the plugin are worth knowing even though they never reach the
screen. `SpeechRecognizer` must be created, started and destroyed on the main
thread, and a Capacitor plugin method does not run there — getting that wrong
produces a silent failure indistinguishable from the bug being fixed, so every
touch of a recognizer goes through a main-looper handler. And one exit path
destroys the recognizer on results, on errors, on a stop and on the activity
going away, because a leaked one holds the microphone open.

`android/.../SpeechPlugin.java` says all of this at greater length, next to the
code it describes.

---

## What it will not do

- **No wake word, and no continuous listening.** One utterance per press, ended
  by the recognizer, by the stop button beside *Ouvindo…*, or by closing the
  sheet — and the recognizer is released on every one of those. An application
  that listens without being asked is not one to build on a promise about what
  leaves the device.
- **No permission but the network and the microphone.** That list used to read
  "no `RECORD_AUDIO`, ever", and *The permission, and the design it replaced*
  above is the account of why it does not any more. The check in
  `.github/workflows/android.yml` was narrowed to those two names and still
  fails the build on camera, location, contacts, storage and anything else.
- **No conversation.** The engine answers the forms in the tables above.
  Anything else is UNKNOWN with examples, not a guess. It has no memory between
  sentences: each one is parsed on its own, so "and two more" refers to nothing.
- **No settings from the box, and no editing of what it made.** It reads the
  inventory; it changes quantities, expiry dates, minimums and targets; it moves
  items; and it creates items, places, categories and contacts. A new row
  carries only what could be asked for, so a parent shelf, a colour, a sort
  order, notes and a priority are set on the screens - and renaming anything is
  a screen too.
- **No deleting or archiving from the box.** Destructive actions stay where they
  can be read before they are taken. **Desfazer** deletes a row a sentence just
  made, within the ten seconds it is offered for, and that is the only deletion
  reachable from here.

---

## Known limitations

Each was found by testing and is written down rather than filed away. None can
write without a press.

**A preposition is read as a location.** The create rules treat the first
preposition as a location marker, so `criar item atum em lata` yields the name
`atum` and the location `lata`, and `create item tuna in oil` yields `tuna` in
`oil`. The card then names a shelf you did not mean. If a location by that name
happens to exist, it is that one; if none does — the usual case — it is a shelf
to be made, under the line saying no place is called that, and confirming makes
the item and the shelf together. So this is the phrase where *A place the
sentence named and the pantry does not have* costs something rather than saving
something. **Desfazer** takes back both. The cost is the lost half of the name,
and all of it is on the card before anything is stored.

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
