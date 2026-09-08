# The AI assistant

**Status:** implemented. `useVoice.ts` routes the typed box between
`services/ai/converse.ts` and the parser; Settings holds the key, the model and
the switch; the microphone was removed as *Not built* below says it would be.
**Date:** 2026-09-07
**Follows:** `2026-09-07-voice-control-design.md`

Ask Claude about your stock in ordinary language, and let it change what you tell
it to — with every change still passing through the confirmation card built for
voice control.

---

## Why this exists

Voice control shipped, and the microphone did not work on the phone it was built
for: Android's recognizer refuses `EXTRA_PREFER_OFFLINE` when no offline
Portuguese pack is installed, and answers "Voice search isn't available". The
decision was to stop pursuing the microphone and pursue understanding instead.

The hand-built parser understands twelve rules. It is fast, offline and exact,
and it will never understand "o que eu devo comprar antes da chuva, considerando
o que vence primeiro". That sentence is the reason for this document.

---

## The decisions

| Decision | Choice | Cost accepted |
|---|---|---|
| Can Claude change stock | Yes, through the existing confirmation card | One tap per change, as before |
| Whose API key | The user's own, pasted into Settings | He needs an Anthropic account |
| Model | `claude-haiku-4-5` by default, `claude-opus-5` selectable | ~1¢ per question, ~5¢ on Opus |
| Offline behaviour | The existing parser, unchanged | Two grammars of understanding, not one |

---

## The inventory is not uploaded

This is the load-bearing property, and it follows from using tool use rather
than stuffing a database into a prompt.

Claude is given functions it may call. It decides which it needs, the
application runs them against the SQLite database already on the device, and
only those results return. A question about rice sends the rice row. A question
about what is expiring sends the expiring rows. **Nothing sends the inventory.**

```
"o que está vencendo e o que devo comprar?"
        │
        ▼  one request: the question + the tool definitions
Claude decides: whats_expiring(30), then whats_missing()
        │
        ▼  both run locally, against OPFS
        ▼  only those rows travel back
"Três itens vencem este mês: leite, iogurte, pão.
 Você está abaixo do mínimo em arroz e feijão."
```

What does leave the device: the sentence typed, the tool results Claude asked
for, and the answer. `docs/OFFLINE.md` must say exactly that.

---

## Reading and writing

Claude gets two kinds of tool, and the difference is the whole safety design.

**Reading tools run immediately.** `find_item`, `list_items`, `whats_expiring`,
`whats_missing`, `preparedness_score`, `list_locations`, `list_categories`.

**Writing tools do not write.** `adjust_quantity`, `set_quantity`, `create_item`
and `set_expiry` build a `PendingWrite` — the same type voice control already
produces — and return to Claude only that the change was *proposed*. The
conversation continues; the proposals accumulate; the turn ends with a
confirmation card for each, in the interface that already exists.

That choice keeps the tool-use loop flowing without ever letting a model's
sentence reach the database unattended. It also means this feature inherits
`commit.ts`, the receipt, and undo without changing any of them.

Claude cannot delete, archive, or empty a category. Those tools are not offered.

---

## The key, and what it costs

The key is the user's, pasted into Settings, stored in the `settings` table like
every other preference. Nothing is compiled into the build, so the same APK is
safe to hand to anyone.

Two things follow, and both are stated in the interface rather than buried:

- **A debug build is `debuggable`.** Anyone with the phone and a cable can read
  the app's private storage, and that now includes an API key. Release builds
  are not debuggable; the key still sits in a database an unlocked phone can
  reach.
- **The bill is the key holder's.** About 1¢ a question on `claude-haiku-4-5`, ~5¢ on `claude-opus-5`.
  Settings shows the model and links to where the key comes from.

---

## What this costs the application's promises

Three things stop being true, and the documentation changes with the code rather
than after it.

**The APK will request `INTERNET`.** It is unavoidable. The CI gate at
`.github/workflows/android.yml` is not deleted — it is narrowed to allow exactly
`INTERNET` and to keep failing on anything else, so the property it protects
survives in a weaker but still checkable form.

**The Content-Security-Policy gains one host.** `connect-src 'self'
https://api.anthropic.com`, and nothing else.

**The offline audit gains an allowlist of exactly one URL in one module.** Every
other external reference still fails the build, as today.

**What does not change:** with no key set, or the assistant switched off, the
application behaves exactly as it does now — no request, no key, no network.
That is the default, and the audit still proves the rest.

---

## Offline is the fallback, not a casualty

The parser is not replaced. Where there is no key, no network, or the assistant
is off, a typed command runs through the twelve rules exactly as now, with the
same certainty model, cards and undo. The application still works with the radio
off, which was always the point.

The interface should make plain which one answered, because the difference
matters: one is exact and free, the other is capable and costs money.

---

## Not built

- **No conversation memory across sessions.** Each question starts fresh. The
  history in the sheet is for the reader, not the model.
- **No voice.** The microphone is removed - `recognizer.ts`, `webspeech.ts`,
  `none.ts`, `SpeechPlugin.java` and the online opt-in with it - and stays
  removed until Android's recognizer is worth revisiting. Reading answers aloud
  was kept, and `RingerPlugin` with it, so a spoken answer still yields to the
  switch on the side of the phone.
- **No deleting or archiving through Claude.** Reversing a wrong creation is
  undo's job; removing real stock is a decision for the inventory screen.
- **No background or scheduled use.** It answers when asked.

---

## Risks

**A model can be wrong in ways a grammar cannot.** The parser fails by not
understanding; a model fails by understanding something else. The confirmation
card is the whole mitigation, which is why writes never bypass it.

**A key in a database is a key at rest.** Stated in Settings rather than
implied.

**The cost is per question and invisible.** Settings should say what the model
costs before the first question, not after the first bill.
