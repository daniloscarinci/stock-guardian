# Voice control

**Status:** design approved, not implemented
**Date:** 2026-09-07

Ask Stock Guardian about your stock out loud, and tell it what changed. Portuguese
first, then English and Spanish. No server, no account, and on Android no
permission — the same conditions the rest of the application already works under.

---

## The tension this design resolves

Stock Guardian makes no network requests, and the Android package asks the
operating system for nothing. Both are enforced rather than promised:
`scripts/audit-offline.mjs` fails the build on an external reference, the
Content-Security-Policy is `default-src 'self'`, and
`.github/workflows/android.yml` fails on any permission outside the
application's own namespace.

Voice collides with all three. A microphone is a permission. Chrome's and
Safari's default speech recognition streams audio to Google and Apple. A
language model large enough to hold a conversation is half a gigabyte.

Five decisions resolve it.

| Decision | Choice | Cost accepted |
|---|---|---|
| Network | Never, under any condition | Speech works only where the device can transcribe locally |
| Understanding | A hand-built intent engine, not a model | It understands what it was taught, and will not converse |
| Writes | Confirmed on screen before anything is stored | One tap per change |
| Answers | Spoken aloud, with a toggle | System text-to-speech, silent when Android is on silent |
| Android capture | The system's own recognizer, by Intent | One utterance per tap, and Android's dialog appears |

The last one is the reason the permission gate survives untouched. Launching
`ACTION_RECOGNIZE_SPEECH` hands recording to the system recognizer, which holds
the microphone itself. This application never opens it, so it declares
`RECORD_AUDIO` nowhere, and a voice feature that still asks for nothing proves
more than a silent application asking for nothing.

---

## Architecture

### The speech seam

Speech capture becomes an interface, for the same reason `SqlDriver` is one:
above it, nothing knows which platform is listening.

```
                    ┌────────────────────────────┐
 features/voice/ ───│ mic button, transcript,    │
                    │ confirmation card          │
                    └──────┬──────────────┬──────┘
                           │              │
        ┌──────────────────▼───┐   ┌──────▼────────────────┐
        │  SpeechRecognizer    │   │  voice/  (pure)       │
        │  (the only seam)     │   │  text → Intent        │
        └──┬────────┬───────┬──┘   └──────┬────────────────┘
           │        │       │             │
    ┌──────▼──┐ ┌───▼────┐ ┌▼──────┐ ┌────▼──────────────┐
    │ Android │ │ Chrome │ │ Typed │ │ services/voice/   │
    │ Intent  │ │ local  │ │ input │ │ Intent → Answer   │
    │ no perm │ │ only   │ │always │ │ via repositories  │
    └─────────┘ └────────┘ └───────┘ └───────────────────┘
```

```ts
export interface SpeechRecognizer {
  /** Whether this platform can transcribe without a network. */
  readonly availability: () => Promise<'ready' | 'installable' | 'unavailable'>;
  /** Ask the user to install the on-device language pack, where that is offered. */
  readonly install?: (tag: string) => Promise<boolean>;
  /** One utterance. Resolves with the transcript, or rejects with a typed reason. */
  readonly listen: (tag: string) => Promise<string>;
}
```

**Android** uses `capacitor.ts`, backed by a hand-written Kotlin plugin that
fires `ACTION_RECOGNIZE_SPEECH` with `EXTRA_PREFER_OFFLINE`.

**Chrome** uses `webspeech.ts`, which constructs `SpeechRecognition` with
`processLocally = true` and only after `availableOnDevice()` reports the
language present. That flag fails closed: with no local model the call errors
rather than quietly reaching a server, which is the property that makes it
usable here at all.

**Everything else** uses `none.ts`, whose `availability` returns
`'unavailable'`. Safari has no on-device speech, so an iPhone gets the typed
box. The typed box is not a fallback bolted on for that case; it is present on
every platform, because a transcript is a transcript however it arrived.

### Why a hand-written Android plugin

`@capacitor-community/speech-recognition` declares `RECORD_AUDIO` and offers no
guarantee of staying on the device. Both are exactly what this design refuses.
Eighty lines of Kotlin that can do neither is the same trade the project already
made when it wrote its service worker by hand.

### Pure above, impure below

`src/voice/` imports nothing from the layers under it. Text goes in, an `Intent`
comes out, and every phrase the application claims to understand can be tested
with a string and an expectation.

`src/services/voice/` turns an `Intent` into an `Answer` by calling repositories
that already exist. Very little new logic lives here. "O que está vencendo"
becomes an `expiryBuckets` filter; "o que falta" becomes `domain/replenishment`.
The parser is the feature, and everything below it is wiring.

### Directories

```
src/voice/
  intents.ts            the Intent union, one type per command
  parse.ts              Grammar + string → Intent
  numbers.ts            spoken numerals and quantities
  dates.ts              spoken dates → ISO, over domain/dates.ts
  grammar/
    types.ts            the Grammar contract
    pt-BR.ts  en.ts  es.ts
    registry.ts         language → Grammar
    pt-BR.phrases.test.ts   the corpus

src/services/voice/
  resolve.ts            item phrase → a matched item, or a choice, or nothing
  execute.ts            Intent → Answer | PendingWrite
  answer.ts             Answer → the sentence shown and spoken

src/services/speech/
  recognizer.ts  capacitor.ts  webspeech.ts  none.ts  speak.ts

src/features/voice/
  VoiceButton.tsx  VoiceSheet.tsx  ConfirmCard.tsx  ChoiceList.tsx

android/app/src/main/java/…/SpeechPlugin.kt
docs/VOICE.md
```

---

## The intent language

### The pipeline

```
"adiciona cinco latas de feijão preto"
   │
   ▼  foldText()                      the function search already uses
"adiciona cinco latas de feijao preto"
   │
   ▼  matchIntent(grammar, text)      pure
ADJUST_QUANTITY
   │
   ▼  fillSlots(grammar, text)        pure
{ mode: 'delta', n: 5, unit: 'latas', type: 'add', item: 'feijao preto' }
   │
   ▼  resolveItem(phrase)             the first step that touches the database
Feijão Preto · Despensa · 12 latas
   │
   ▼  confirmation card               nothing is written until it is tapped
```

### The intents

Every one maps onto a call the repositories already expose.

| Utterance | Intent | Runs |
|---|---|---|
| *quanto arroz eu tenho?* · *tem açúcar?* | `QUERY_QUANTITY` | `listItems({ search })` |
| *o que está vencendo?* · *o que vence em 30 dias?* · *o que já venceu?* | `QUERY_EXPIRING` | `expiryBuckets` filter |
| *o que falta?* · *o que preciso comprar?* | `QUERY_MISSING` | `domain/replenishment` |
| *onde está o arroz?* · *o que tem na despensa?* | `QUERY_WHERE` | `locationIds` filter |
| *quando vence o leite?* | `QUERY_EXPIRY_OF` | `listItems({ search })` |
| *como está minha preparação?* | `QUERY_SCORE` | `domain/preparedness` |
| *adiciona cinco latas de feijão* · *usei 3 ovos* · *tira meio quilo de arroz* | `ADJUST_QUANTITY` | `adjustQuantity` |
| *agora tenho 12 latas de feijão* | `SET_QUANTITY` | `adjustQuantity`, absolute |
| *criar item: 10 kg de arroz na despensa* | `CREATE_ITEM` | `create` |
| *o leite vence dia 12 de setembro* | `SET_EXPIRY` | `update` |
| *o que você entende?* · *ajuda* | `HELP` | — |
| anything unmatched | `UNKNOWN` | shows the transcript and three examples |

`UNKNOWN` is a real intent with a designed response, not an error. It repeats
what it heard, so a mishearing is visible, and offers examples drawn from the
grammar rather than from a hard-coded list that can drift out of date.

### The verb records why

`StockTransactionType` already distinguishes `add`, `remove`, `consume`,
`purchase` and `correction`, and Portuguese verbs map onto it directly:
*comprei* is a purchase, *usei* and *gastei* are consumption, *na verdade tenho*
is a correction. Speaking to the application therefore produces a better history
than tapping `+` does, because the reason survives.

### Resolving the item

The hardest step, and it reuses the existing search rather than growing a second
one. Candidates come from `listItems({ search: phrase })`, which already folds
accents and ANDs across terms. Candidates are then scored:

1. Exact folded name match
2. Folded name starts with the phrase
3. All phrase tokens appear in the name
4. Some tokens appear, in the name or the notes

One clear winner proceeds. Several close ones raise a numbered choice,
answerable by voice (*o primeiro*) or by tapping. Nothing found offers
"Não encontrei 'X'. Quer criar?", which routes the commonest failure into
`CREATE_ITEM` instead of a dead end.

Ties matter more here than in a text search, because the user is not looking at
a list. A phrase matching two items never guesses.

### Numbers, units and dates

`numbers.ts` reads *um* through *mil*, and the quantity words a kitchen actually
uses: *meia dúzia*, *uma dúzia*, *meio quilo*, *um par*, alongside digits.

Spoken units are matched against the item's stored `unit`. Where they disagree,
the stored unit wins and the confirmation card shows it, so "cinco latas" against
an item held in kilos is visible before it is stored, not after.

`dates.ts` reads *hoje*, *amanhã*, *dia 12*, *doze de setembro*, *em março*,
*daqui a 30 dias*, *semana que vem* and written forms, and folds them to ISO
through `domain/dates.ts`. A bare month means its last day, because "vence em
março" is a deadline rather than an instant.

---

## Writing data

No intent writes anything. `execute.ts` returns either an `Answer` or a
`PendingWrite` describing the change; only the confirmation card's button calls
a repository. A test asserts that no write reaches the driver from any parse,
which pins the property rather than trusting it.

The card names the item, its location, the old value and the new value. A
`CREATE_ITEM` card shows every field it understood and leaves the rest at the
application's defaults.

```
┌─ Entendi ────────────────┐
│ Feijão Preto  (Despensa) │
│                          │
│   12 latas  →  17 latas  │
│                          │
│ [ Confirmar ]  [ Cancelar ]│
└──────────────────────────┘
```

---

## Speaking back

Answers are spoken through `speechSynthesis` in the interface language and shown
on screen at the same time, so the feature works with your hands full and with
the sound off. `voiceSpeakAnswers` turns it off.

On Android the plugin also reports `AudioManager.getRingerMode()`, and speech
stays silent when the phone does. A browser cannot read that state, so there the
toggle is the only control. Confirmation cards are spoken too — a change worth
making is worth hearing — but the card still waits for the tap.

---

## Multilingual structure

`translate.ts` states the rule already: a new language is one file and one
registry entry, with no change to application logic. The grammar follows it.
`parse.ts` takes a `Grammar` and a string and knows nothing about any particular
language; `pt-BR.ts` holds the verb patterns, number words, date words, unit
words and synonyms, and `en.ts` and `es.ts` fill the same shape.

Portuguese is written first and completely. The other two cost the parser
nothing, which is the point of separating them.

Voice follows the existing `language` setting rather than adding one of its own.
A person who switches the interface to Spanish is speaking Spanish.

---

## Settings

Two keys join `settingsSchema`, both defaulting to `true`, both following the
established one-row-per-key pattern:

- `voiceEnabled` — shows or hides the microphone button
- `voiceSpeakAnswers` — speaks answers aloud

Settings also gains a line reporting what this device can do: on-device speech
ready, installable, or unavailable with the typed box offered instead.
Diagnostics already tells the truth about storage; speech deserves the same
treatment.

---

## Enforcing the guarantee

**The audit gains a rule.** `scripts/audit-offline.mjs` currently scans for
constructs that fetch. It gains `SpeechRecognition`, permitted in
`services/speech/webspeech.ts` and nowhere else.

**A test pins the flag.** `webspeech.test.ts` asserts that the module never
constructs a recognizer without `processLocally = true` and never calls `start()`
when `availableOnDevice()` reported the language absent.

**The Android gate does not change.** `.github/workflows/android.yml` keeps
failing on any foreign permission, and now proves a stronger claim than before.

**The manifest comment gains a paragraph** explaining that speech arrives through
the system recognizer, so that a later reader does not add `RECORD_AUDIO` on the
assumption it was an oversight.

---

## Testing

The corpus is the centre of it. `grammar/pt-BR.phrases.test.ts` holds a table of
real utterances against expected intents and slots, and adding a phrase form
means adding a row. It covers the plain cases, and deliberately covers:

- Transcripts without punctuation or capitals, which is what a recognizer returns
- Numbers as words, as digits, and as *meia dúzia*
- Item names the recognizer garbles — *feijao* for *feijão*, *acucar* for *açúcar*
- Utterances that must not parse: a bare item name, a fragment, silence

Beyond the corpus:

- `resolve.test.ts` against a seeded memory database, including ties
- `execute.test.ts` asserting no write reaches the driver before confirmation
- `webspeech.test.ts` for the two guard properties above
- an `audit-offline` self-test for the new rule
- `numbers.test.ts` and `dates.test.ts`, pure and exhaustive

---

## Documentation

- `docs/VOICE.md` — how it works, every phrase form, and what it will not do
- `docs/ARCHITECTURE.md` — the speech seam beside the database seam
- `docs/OFFLINE.md` — how speech stays local, and the new audit rule
- `docs/ANDROID.md` — the plugin, and why the permission list stayed empty
- `README.md` — a Voice section, and new entries in "What is not built yet"

---

## Not built, and said so

The README lists what is missing rather than showing dead buttons. This feature
keeps that habit.

- **No wake word and no continuous listening.** The system recognizer transcribes
  one utterance per tap. Hands-free listening needs the microphone, and the
  microphone needs the permission this design exists to avoid.
- **No voice on iPhone or Safari.** No on-device speech API exists there. The
  typed box works, and the interface says why rather than showing a microphone
  that fails.
- **No voice in the desktop build.** `src-tauri/` has still never been compiled.
- **No open conversation.** The engine answers the forms in the table. Asking it
  something else returns `UNKNOWN` with examples, not a guess.

---

## Risks

**The grammar is the product, and grammars rot.** Every phrase a real user tries
and loses belongs in the corpus as a row. Without that discipline this becomes a
feature that works for the phrases its author imagined.

**On-device Portuguese is not universal.** Older Android devices and stripped
builds may lack the pt-BR pack. `availability` returns `'installable'` there, and
the interface offers the system's install flow rather than failing silently.

**Recognizers garble proper nouns.** Item resolution therefore scores against
folded text and accepts partial token matches, and never resolves a tie by
guessing.
