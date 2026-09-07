# Voice Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask Stock Guardian about your stock out loud and tell it what changed, in Portuguese first, with no network request and no Android permission.

**Architecture:** A pure parser in `src/voice/` turns a transcript into an `Intent`; `src/services/voice/` executes that `Intent` against the repositories that already exist; `src/services/speech/` is a platform seam with three implementations, exactly as `SqlDriver` is for the database. Nothing writes to the database until a confirmation card is tapped.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`), React 19, Vitest, SQLite-WASM behind `SqlDriver`, Capacitor 8 + Kotlin for Android.

**Spec:** `docs/superpowers/specs/2026-09-07-voice-control-design.md`

---

## Before you start

Read these three files. The plan assumes their contents.

- `src/domain/normalize.ts` — `foldText` is used by the parser and by item resolution. Every regex in every grammar runs against **folded** text: no accents, lowercase, whitespace collapsed. `feijão` is `feijao` and `Açúcar` is `acucar`. Never write an accented character in a pattern.
- `src/repositories/items.repository.ts` — the real API is `items.list(context, options)` returning `Page<InventoryItemView>`, plus `create`, `update`, `adjustQuantity`, `listForAnalysis`.
- `src/repositories/repositories.test.ts:22-45` — the harness every database test in this project uses: `createMemoryDriver` → `migrate` → `seedDatabase`. Copy it; do not invent a new one.

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/voice/intents.ts` | The `Intent` union. Types only, no logic. |
| `src/voice/numbers.ts` | Spoken numerals → number. Pure, language-driven by a table. |
| `src/voice/dates.ts` | Spoken dates → `CalendarDate`. Pure, over `domain/dates.ts`. |
| `src/voice/grammar/types.ts` | The `Grammar` and `Rule` contracts. |
| `src/voice/grammar/pt-BR.ts` | Portuguese patterns, number words, date words, units. |
| `src/voice/grammar/en.ts`, `es.ts` | The same shape, other languages. |
| `src/voice/grammar/registry.ts` | `Language` → `Grammar`. One line per language. |
| `src/voice/parse.ts` | `(Grammar, transcript, ctx) → Intent`. First matching rule wins. |
| `src/services/voice/resolve.ts` | Item phrase → one item, a choice, or nothing. Touches the database. |
| `src/services/voice/execute.ts` | `Intent` → `Answer \| PendingWrite \| Choice`. Never writes. |
| `src/services/voice/commit.ts` | `PendingWrite` → the repository call. The only writer. |
| `src/services/voice/answer.ts` | `Answer` → the sentence shown and spoken. |
| `src/services/speech/recognizer.ts` | The `SpeechRecognizer` contract + platform selection. |
| `src/services/speech/none.ts` | Always unavailable. Safari, Firefox, tests. |
| `src/services/speech/webspeech.ts` | Chrome, on-device only. The single permitted `SpeechRecognition` site. |
| `src/services/speech/capacitor.ts` | Android, via the system Intent. |
| `src/services/speech/speak.ts` | `speechSynthesis`, respecting the toggle and Android silent mode. |
| `src/features/voice/VoiceButton.tsx` | The header microphone. |
| `src/features/voice/VoiceSheet.tsx` | Transcript, answer, typed box, session history. |
| `src/features/voice/ConfirmCard.tsx` | Old value → new value, Confirmar / Cancelar. |
| `src/features/voice/ChoiceList.tsx` | "Qual deles?" when resolution ties. |
| `android/app/src/main/java/app/stockguardian/android/SpeechPlugin.kt` | System recognizer, no permission. |

---

# Phase 1 — The pure core

No database, no React, no browser API. Everything in this phase is a function from a string to a value, and every test is a table row.

## Task 1: Spoken numbers

**Files:**
- Create: `src/voice/numbers.ts`
- Create: `src/voice/grammar/pt-BR.numbers.ts`
- Test: `src/voice/numbers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/voice/numbers.test.ts
import { describe, expect, it } from 'vitest';
import { parseNumber } from './numbers';
import { ptBRNumbers } from './grammar/pt-BR.numbers';

describe('parseNumber (pt-BR)', () => {
  const cases: ReadonlyArray<readonly [string, number | null]> = [
    ['5', 5],
    ['12', 12],
    ['1,5', 1.5],
    ['0,25', 0.25],
    ['um', 1],
    ['uma', 1],
    ['dois', 2],
    ['duas', 2],
    ['tres', 3],
    ['dez', 10],
    ['onze', 11],
    ['quinze', 15],
    ['vinte', 20],
    ['vinte e cinco', 25],
    ['trinta e um', 31],
    ['cem', 100],
    ['cento e vinte', 120],
    ['duzentos', 200],
    ['mil', 1000],
    ['meia duzia', 6],
    ['uma duzia', 12],
    ['duas duzias', 24],
    ['um par', 2],
    ['meio', 0.5],
    ['metade', 0.5],
    ['', null],
    ['feijao', null],
    ['e', null],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${String(expected)}`, () => {
      expect(parseNumber(ptBRNumbers, input)).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/voice/numbers.test.ts`
Expected: FAIL — `Cannot find module './numbers'`.

- [ ] **Step 3: Write the number words table**

```ts
// src/voice/grammar/pt-BR.numbers.ts
import type { NumberWords } from '../numbers';

/**
 * Portuguese number words, already folded: no accents, lowercase. `três` is
 * `tres` here because `foldText` runs before the parser ever sees the text.
 *
 * Gendered forms are both present (`um`/`uma`, `dois`/`duas`) because a speaker
 * says "duas latas" and "dois quilos" and neither is a mistake.
 */
export const ptBRNumbers: NumberWords = {
  units: {
    zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
    treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
    quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80,
    noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200,
    trezentos: 300, trezentas: 300, quatrocentos: 400, quinhentos: 500,
    seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900,
    mil: 1000,
  },
  /** Words that multiply the number before them: "duas dúzias" is 2 × 12. */
  groups: { duzia: 12, duzias: 12, par: 2, pares: 2 },
  /** Standalone quantities that need no numeral. */
  literals: { meio: 0.5, meia: 0.5, metade: 0.5 },
  /** Joins tens to units: "vinte e cinco". */
  joiner: 'e',
};
```

- [ ] **Step 4: Write the parser**

```ts
// src/voice/numbers.ts
/**
 * Spoken numerals to numbers.
 *
 * Additive only, which is all any language here needs: "vinte e cinco" is
 * 20 + 5, "cento e vinte" is 100 + 20. Multiplicative forms ("duzentos") are
 * table entries rather than arithmetic, because listing nine hundreds words is
 * shorter and more obviously correct than a general algorithm.
 */
export interface NumberWords {
  readonly units: Readonly<Record<string, number>>;
  readonly groups: Readonly<Record<string, number>>;
  readonly literals: Readonly<Record<string, number>>;
  readonly joiner: string;
}

/** Digits, with a comma decimal separator as Portuguese and Spanish write it. */
function parseDigits(token: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(token)) return null;
  const value = Number(token.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Returns null rather than 0 for text that holds no number, so a caller can
 * tell "he said zero" from "he said nothing".
 */
export function parseNumber(words: NumberWords, text: string): number | null {
  const tokens = text.split(' ').filter((token) => token !== '');
  if (tokens.length === 0) return null;

  let total: number | null = null;

  for (const token of tokens) {
    if (token === words.joiner) continue;

    const group = words.groups[token];
    if (group !== undefined) {
      // "meia duzia" -> 0.5 × 12; a bare "duzia" -> 1 × 12.
      total = (total ?? 1) * group;
      continue;
    }

    const digits = parseDigits(token);
    if (digits !== null) {
      total = (total ?? 0) + digits;
      continue;
    }

    const unit = words.units[token];
    if (unit !== undefined) {
      total = (total ?? 0) + unit;
      continue;
    }

    const literal = words.literals[token];
    if (literal !== undefined) {
      total = (total ?? 0) + literal;
      continue;
    }

    return null;
  }

  return total;
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/voice/numbers.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 6: Commit**

```bash
git add src/voice/numbers.ts src/voice/numbers.test.ts src/voice/grammar/pt-BR.numbers.ts
git commit -m "Voice: read spoken numbers, including meia duzia and meio quilo"
```

---

## Task 2: Spoken dates

**Files:**
- Create: `src/voice/dates.ts`, `src/voice/grammar/pt-BR.dates.ts`
- Test: `src/voice/dates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/voice/dates.test.ts
import { describe, expect, it } from 'vitest';
import { parseSpokenDate } from './dates';
import { ptBRDates } from './grammar/pt-BR.dates';
import { ptBRNumbers } from './grammar/pt-BR.numbers';

const TODAY = '2026-09-07'; // a Monday

describe('parseSpokenDate (pt-BR)', () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ['hoje', '2026-09-07'],
    ['amanha', '2026-09-08'],
    ['depois de amanha', '2026-09-09'],
    ['semana que vem', '2026-09-14'],
    ['mes que vem', '2026-10-07'],
    ['daqui a 30 dias', '2026-10-07'],
    ['daqui a dez dias', '2026-09-17'],
    ['dia 12', '2026-09-12'],
    ['dia 3', '2026-10-03'],           // already past this month, so next month
    ['12 de setembro', '2026-09-12'],
    ['doze de setembro', '2026-09-12'],
    ['1 de janeiro', '2027-01-01'],    // January has passed, so next year
    ['em marco', '2027-03-31'],        // a bare month means its last day
    ['12/09/2026', '2026-09-12'],
    ['12/09', '2026-09-12'],
    ['2026-09-12', '2026-09-12'],
    ['feijao preto', null],
    ['', null],
  ];

  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${String(expected)}`, () => {
      expect(parseSpokenDate(ptBRDates, ptBRNumbers, input, TODAY)).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/voice/dates.test.ts`
Expected: FAIL — `Cannot find module './dates'`.

- [ ] **Step 3: Write the date words table**

```ts
// src/voice/grammar/pt-BR.dates.ts
import type { DateWords } from '../dates';

/** Folded: no accents, lowercase. `março` is `marco`, `amanhã` is `amanha`. */
export const ptBRDates: DateWords = {
  today: ['hoje'],
  tomorrow: ['amanha'],
  dayAfterTomorrow: ['depois de amanha'],
  nextWeek: ['semana que vem', 'proxima semana'],
  nextMonth: ['mes que vem', 'proximo mes'],
  /** "daqui a N dias" / "em N dias" — the captured group is the count. */
  inDaysPattern: /(?:daqui a|em|dentro de)\s+(.+?)\s+dias?/,
  /** "dia 12" with no month. */
  dayOnlyPattern: /\bdia\s+(\d{1,2})\b/,
  /** "12 de setembro" or "doze de setembro". */
  dayMonthPattern: /(.+?)\s+de\s+([a-z]+)/,
  /** "em março", "no mes de março". */
  monthOnlyPattern: /(?:em|no mes de|para)\s+([a-z]+)$/,
  months: {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  },
};
```

- [ ] **Step 4: Write the parser**

```ts
// src/voice/dates.ts
/**
 * Spoken dates to `CalendarDate`.
 *
 * Two rules decide the cases a speaker leaves open, and both follow from what
 * these dates are FOR - an expiry date is in the future.
 *
 *   A day with no month ("dia 3") means the next time that day comes round.
 *   A month with no day ("em marco") means that month's LAST day, because
 *   "vence em marco" names a deadline, not an instant.
 */
import { addCalendarDays, isValidCalendarDate, type CalendarDate } from '../domain/dates';
import { parseNumber, type NumberWords } from './numbers';

export interface DateWords {
  readonly today: readonly string[];
  readonly tomorrow: readonly string[];
  readonly dayAfterTomorrow: readonly string[];
  readonly nextWeek: readonly string[];
  readonly nextMonth: readonly string[];
  readonly inDaysPattern: RegExp;
  readonly dayOnlyPattern: RegExp;
  readonly dayMonthPattern: RegExp;
  readonly monthOnlyPattern: RegExp;
  readonly months: Readonly<Record<string, number>>;
}

function iso(year: number, month: number, day: number): CalendarDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(date: CalendarDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Rolls a month/day forward to the next occurrence at or after `today`. */
function nextOccurrence(today: CalendarDate, month: number, day: number): CalendarDate {
  const now = parts(today);
  const candidate = iso(now.year, month, day);
  return candidate >= today ? candidate : iso(now.year + 1, month, day);
}

export function parseSpokenDate(
  words: DateWords,
  numbers: NumberWords,
  text: string,
  today: CalendarDate,
): CalendarDate | null {
  const value = text.trim();
  if (value === '') return null;

  if (words.today.includes(value)) return today;
  if (words.tomorrow.includes(value)) return addCalendarDays(today, 1);
  if (words.dayAfterTomorrow.includes(value)) return addCalendarDays(today, 2);
  if (words.nextWeek.includes(value)) return addCalendarDays(today, 7);

  if (words.nextMonth.includes(value)) {
    const now = parts(today);
    const month = now.month === 12 ? 1 : now.month + 1;
    const year = now.month === 12 ? now.year + 1 : now.year;
    return iso(year, month, Math.min(now.day, lastDayOfMonth(year, month)));
  }

  // ISO and slashed forms first: they are unambiguous and cheap to reject.
  if (isValidCalendarDate(value)) return value;

  const slashed = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashed !== null) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    const rawYear = slashed[3];
    if (rawYear === undefined) return nextOccurrence(today, month, day);
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const candidate = iso(year, month, day);
    return isValidCalendarDate(candidate) ? candidate : null;
  }

  const inDays = value.match(words.inDaysPattern);
  if (inDays?.[1] !== undefined) {
    const count = parseNumber(numbers, inDays[1]);
    if (count !== null) return addCalendarDays(today, Math.round(count));
  }

  const dayMonth = value.match(words.dayMonthPattern);
  if (dayMonth?.[1] !== undefined && dayMonth[2] !== undefined) {
    const month = words.months[dayMonth[2]];
    const day = parseNumber(numbers, dayMonth[1]);
    if (month !== undefined && day !== null && day >= 1 && day <= 31) {
      return nextOccurrence(today, month, Math.round(day));
    }
  }

  const dayOnly = value.match(words.dayOnlyPattern);
  if (dayOnly?.[1] !== undefined) {
    const day = Number(dayOnly[1]);
    const now = parts(today);
    if (day >= 1 && day <= 31) {
      const thisMonth = iso(now.year, now.month, day);
      if (thisMonth >= today) return thisMonth;
      const month = now.month === 12 ? 1 : now.month + 1;
      const year = now.month === 12 ? now.year + 1 : now.year;
      return iso(year, month, day);
    }
  }

  const monthOnly = value.match(words.monthOnlyPattern);
  if (monthOnly?.[1] !== undefined) {
    const month = words.months[monthOnly[1]];
    if (month !== undefined) {
      const now = parts(today);
      const year = month >= now.month ? now.year : now.year + 1;
      return iso(year, month, lastDayOfMonth(year, month));
    }
  }

  return null;
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/voice/dates.test.ts`
Expected: PASS, 18 tests. If `em marco` fails, check that `monthOnlyPattern` is anchored with `$` — without the anchor it matches inside longer phrases.

- [ ] **Step 6: Commit**

```bash
git add src/voice/dates.ts src/voice/dates.test.ts src/voice/grammar/pt-BR.dates.ts
git commit -m "Voice: read spoken dates, with a bare month meaning its last day"
```

---

## Task 3: The Intent union and the Grammar contract

Types only. No test of its own — Tasks 5 and 6 exercise every branch, and a test that asserts a type exists tests the compiler rather than the code.

**Files:**
- Create: `src/voice/intents.ts`, `src/voice/grammar/types.ts`

- [ ] **Step 1: Write the Intent union**

```ts
// src/voice/intents.ts
/**
 * What the application understood.
 *
 * Every intent is data, and none of them can act. Executing one is a separate
 * step in `services/voice/`, which is what makes the whole parser testable with
 * a string and an expectation.
 *
 * `item`, `location` and `name` hold FOLDED phrases as spoken, not identifiers.
 * Turning a phrase into a row is `resolve.ts`'s job and needs the database.
 */
import type { StockTransactionType } from '../types/domain';

export interface QueryQuantity {
  readonly kind: 'QUERY_QUANTITY';
  readonly item: string;
}

export interface QueryExpiring {
  readonly kind: 'QUERY_EXPIRING';
  /** null means "use the user's own first warning window". */
  readonly withinDays: number | null;
  /** "o que ja venceu" asks only for what is already past. */
  readonly expiredOnly: boolean;
}

export interface QueryMissing {
  readonly kind: 'QUERY_MISSING';
}

export interface QueryWhere {
  readonly kind: 'QUERY_WHERE';
  /** Exactly one of these is set: "onde esta X" or "o que tem na Y". */
  readonly item: string | null;
  readonly location: string | null;
}

export interface QueryExpiryOf {
  readonly kind: 'QUERY_EXPIRY_OF';
  readonly item: string;
}

export interface QueryScore {
  readonly kind: 'QUERY_SCORE';
}

export interface AdjustQuantity {
  readonly kind: 'ADJUST_QUANTITY';
  readonly item: string;
  /** Always positive. `direction` carries the sign. */
  readonly amount: number;
  readonly direction: 'up' | 'down';
  /** Why, taken from the verb: comprei is a purchase, usei is consumption. */
  readonly transaction: StockTransactionType;
  readonly unit: string | null;
}

export interface SetQuantity {
  readonly kind: 'SET_QUANTITY';
  readonly item: string;
  readonly amount: number;
  readonly unit: string | null;
}

export interface CreateItem {
  readonly kind: 'CREATE_ITEM';
  readonly name: string;
  readonly amount: number | null;
  readonly unit: string | null;
  readonly location: string | null;
  readonly expiresOn: string | null;
}

export interface SetExpiry {
  readonly kind: 'SET_EXPIRY';
  readonly item: string;
  readonly expiresOn: string;
}

export interface Help {
  readonly kind: 'HELP';
}

/**
 * Not an error. It carries the transcript so the interface can show what was
 * heard, which turns a mishearing into something the user can see and correct.
 */
export interface Unknown {
  readonly kind: 'UNKNOWN';
  readonly transcript: string;
}

export type Intent =
  | QueryQuantity | QueryExpiring | QueryMissing | QueryWhere
  | QueryExpiryOf | QueryScore | AdjustQuantity | SetQuantity
  | CreateItem | SetExpiry | Help | Unknown;

export type IntentKind = Intent['kind'];

/** Intents that would change data. Used to route to the confirmation card. */
export const WRITING_INTENTS: readonly IntentKind[] = [
  'ADJUST_QUANTITY', 'SET_QUANTITY', 'CREATE_ITEM', 'SET_EXPIRY',
];
```

- [ ] **Step 2: Write the Grammar contract**

```ts
// src/voice/grammar/types.ts
/**
 * A language's grammar.
 *
 * `translate.ts` states the rule this follows: a new language is one file and
 * one registry entry, and no application logic changes. `parse.ts` takes a
 * Grammar and a string and knows nothing about any particular language.
 *
 * RULE ORDER IS LOAD-BEARING. The first rule whose pattern matches and whose
 * `build` returns non-null wins, so specific forms must precede general ones:
 * "agora tenho 12 latas" is a SET_QUANTITY and must be tried before the
 * QUERY_QUANTITY rule that also matches "tenho". `parse.test.ts` pins this.
 */
import type { Language } from '../../domain/settings';
import type { Intent } from '../intents';
import type { NumberWords } from '../numbers';
import type { DateWords } from '../dates';

export interface SlotContext {
  /** Today, passed in rather than read, so every date test is deterministic. */
  readonly today: string;
}

export interface RuleTools {
  readonly numbers: NumberWords;
  readonly dates: DateWords;
  readonly units: readonly string[];
}

export interface Rule {
  /** For test failure messages and nothing else. */
  readonly name: string;
  /** Run against folded text: lowercase, unaccented, whitespace collapsed. */
  readonly pattern: RegExp;
  /** Returns null to decline the match and let a later rule try. */
  readonly build: (
    match: RegExpMatchArray,
    tools: RuleTools,
    context: SlotContext,
  ) => Intent | null;
}

export interface Grammar {
  readonly language: Language;
  readonly rules: readonly Rule[];
  readonly numbers: NumberWords;
  readonly dates: DateWords;
  /** Spoken unit words, stripped from an item phrase before it is resolved. */
  readonly units: readonly string[];
  /** Filler words removed from an item phrase: articles, "de", "do", "da". */
  readonly fillers: readonly string[];
  /** Shown by HELP and by UNKNOWN. Drawn from here so they cannot drift. */
  readonly examples: readonly string[];
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. No test runs; there is no behaviour here yet.

- [ ] **Step 4: Commit**

```bash
git add src/voice/intents.ts src/voice/grammar/types.ts
git commit -m "Voice: the Intent union and the Grammar contract"
```

---

## Task 4: The Portuguese grammar

**Files:**
- Create: `src/voice/grammar/pt-BR.ts`
- Test: covered by Task 6's corpus. Write the file, then prove it in Task 5.

- [ ] **Step 1: Write the grammar**

```ts
// src/voice/grammar/pt-BR.ts
/**
 * Brazilian Portuguese.
 *
 * Every pattern runs against folded text, so no accented character appears
 * below: `feijão` arrives as `feijao` and `você` as `voce`. Writing an accent
 * here produces a rule that can never match, which is the single easiest
 * mistake to make in this file.
 */
import type { Grammar, Rule } from './types';
import type { Intent } from '../intents';
import { ptBRNumbers } from './pt-BR.numbers';
import { ptBRDates } from './pt-BR.dates';
import { parseNumber } from '../numbers';
import { parseSpokenDate } from '../dates';

const FILLERS = ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na'];

const UNITS = [
  'lata', 'latas', 'pacote', 'pacotes', 'caixa', 'caixas', 'garrafa', 'garrafas',
  'saco', 'sacos', 'kg', 'quilo', 'quilos', 'g', 'grama', 'gramas',
  'l', 'litro', 'litros', 'ml', 'unidade', 'unidades', 'peca', 'pecas',
];

/**
 * Strips a leading quantity, a unit word and filler words from an item phrase,
 * leaving something worth handing to the search. "cinco latas de feijao preto"
 * becomes "feijao preto".
 */
function cleanItemPhrase(phrase: string): string {
  const kept = phrase
    .split(' ')
    .filter((word) => word !== '' && !UNITS.includes(word) && !FILLERS.includes(word));
  return kept.join(' ').trim();
}

/** Pulls the unit word out of a phrase, if one is there. */
function findUnit(phrase: string): string | null {
  const found = phrase.split(' ').find((word) => UNITS.includes(word));
  return found ?? null;
}

/** Verbs that add stock, mapped to why they added it. */
const ADD_VERBS: Readonly<Record<string, 'add' | 'purchase'>> = {
  adiciona: 'add', adicionar: 'add', acrescenta: 'add', acrescentar: 'add',
  poe: 'add', bota: 'add', soma: 'add', entrou: 'add', chegou: 'add',
  comprei: 'purchase', compramos: 'purchase', comprou: 'purchase',
};

/** Verbs that remove stock, mapped to why. */
const REMOVE_VERBS: Readonly<Record<string, 'remove' | 'consume'>> = {
  tira: 'remove', tirar: 'remove', remove: 'remove', remover: 'remove',
  retira: 'remove', tirei: 'remove', diminui: 'remove',
  usei: 'consume', usamos: 'consume', gastei: 'consume', gastamos: 'consume',
  consumi: 'consume', comi: 'consume', abri: 'consume',
};

const rules: readonly Rule[] = [
  {
    name: 'HELP',
    pattern: /^(?:ajuda|socorro|o que (?:voce|vc) (?:entende|sabe|faz)|como (?:usa|funciona))\??$/,
    build: (): Intent => ({ kind: 'HELP' }),
  },

  {
    // Before ADJUST, because "adiciona um item novo" also matches an add verb.
    name: 'CREATE_ITEM',
    pattern:
      /^(?:criar?|novo|nova|adicionar?|cadastrar?)\s+(?:um\s+|uma\s+)?(?:item|produto)\s*(?:novo|nova)?\s*:?\s*(.+)$/,
    build: (match, tools, context): Intent | null => {
      const body = match[1];
      if (body === undefined || body.trim() === '') return null;

      let rest = body;
      let expiresOn: string | null = null;
      let location: string | null = null;

      const expiry = rest.match(/\s+(?:que\s+)?(?:vence|validade|valido ate)\s+(.+)$/);
      if (expiry?.[1] !== undefined) {
        expiresOn = parseSpokenDate(tools.dates, tools.numbers, expiry[1], context.today);
        if (expiresOn !== null) rest = rest.slice(0, expiry.index).trim();
      }

      const place = rest.match(/\s+(?:na|no|em)\s+(.+)$/);
      if (place?.[1] !== undefined) {
        location = place[1].trim();
        rest = rest.slice(0, place.index).trim();
      }

      const leading = rest.match(/^(.+?)\s+(?:de\s+)?(.+)$/);
      const amount = leading?.[1] !== undefined ? parseNumber(tools.numbers, leading[1]) : null;
      const name = amount === null ? cleanItemPhrase(rest) : cleanItemPhrase(leading?.[2] ?? rest);
      if (name === '') return null;

      return {
        kind: 'CREATE_ITEM',
        name,
        amount,
        unit: findUnit(rest),
        location,
        expiresOn,
      };
    },
  },

  {
    name: 'QUERY_MISSING',
    pattern:
      /^(?:o que (?:esta )?(?:falta|faltando|acabando|no fim)|o que (?:eu )?(?:preciso|tenho que) comprar|lista de compras|o que comprar)\??$/,
    build: (): Intent => ({ kind: 'QUERY_MISSING' }),
  },

  {
    name: 'QUERY_EXPIRING',
    pattern:
      /^(?:o que|quais itens|quais coisas)\s+(?:esta |estao |ja |vai )?(?:vencendo|vencer|venceu|venceram|vence|expirou|expirando)\s*(.*)$/,
    build: (match, tools): Intent => {
      const tail = (match[2] ?? '').trim();
      const expiredOnly = /(?:ja )?venceu|venceram|expirou|vencido/.test(match[0]);
      const days = tail.match(/(?:em|nos proximos|dentro de|daqui a)\s+(.+?)\s+dias?/);
      const withinDays = days?.[1] !== undefined ? parseNumber(tools.numbers, days[1]) : null;
      return {
        kind: 'QUERY_EXPIRING',
        withinDays: withinDays === null ? null : Math.round(withinDays),
        expiredOnly,
      };
    },
  },

  {
    name: 'QUERY_SCORE',
    pattern:
      /^(?:como esta (?:minha|a) (?:preparacao|prontidao)|qual (?:e )?(?:minha|a) (?:pontuacao|nota|preparacao)|estou preparado)\??$/,
    build: (): Intent => ({ kind: 'QUERY_SCORE' }),
  },

  {
    name: 'QUERY_EXPIRY_OF',
    pattern: /^(?:quando (?:vence|expira)|qual (?:e )?a validade (?:de|do|da))\s+(.+?)\??$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_EXPIRY_OF', item };
    },
  },

  {
    // After QUERY_EXPIRY_OF, so "quando vence o leite" is not read as a write.
    name: 'SET_EXPIRY',
    pattern: /^(?:o |a )?(.+?)\s+(?:vence|expira|tem validade)\s+(?:em |no dia |dia |ate )?(.+)$/,
    build: (match, tools, context): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      const expiresOn = parseSpokenDate(tools.dates, tools.numbers, match[2] ?? '', context.today);
      if (item === '' || expiresOn === null) return null;
      return { kind: 'SET_EXPIRY', item, expiresOn };
    },
  },

  {
    name: 'QUERY_WHERE_LOCATION',
    pattern: /^(?:o que (?:tem|ha|esta)|o que eu tenho)\s+(?:na|no|em|dentro d[ao])\s+(.+?)\??$/,
    build: (match): Intent | null => {
      const location = (match[1] ?? '').trim();
      return location === '' ? null : { kind: 'QUERY_WHERE', item: null, location };
    },
  },

  {
    name: 'QUERY_WHERE_ITEM',
    pattern: /^(?:onde (?:esta|fica|estao|ficam)|em que lugar esta)\s+(.+?)\??$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_WHERE', item, location: null };
    },
  },

  {
    // Before ADJUST and before QUERY_QUANTITY, both of which match "tenho".
    name: 'SET_QUANTITY',
    pattern:
      /^(?:agora |na verdade )(?:eu )?(?:tenho|tem|sao|ficaram|restam)\s+(.+?)\s+(?:de\s+)?(.+)$/,
    build: (match): Intent | null => {
      const amountText = match[1] ?? '';
      const rest = match[2] ?? '';
      const amount = parseNumber(ptBRNumbers, amountText.replace(/\s+\S+$/, '')) ??
        parseNumber(ptBRNumbers, amountText);
      const item = cleanItemPhrase(rest);
      if (amount === null || amount < 0 || item === '') return null;
      return { kind: 'SET_QUANTITY', item, amount, unit: findUnit(amountText) };
    },
  },

  {
    name: 'ADJUST_QUANTITY',
    pattern: /^([a-z]+)\s+(.+?)\s+(?:de\s+)?(.+)$/,
    build: (match): Intent | null => {
      const verb = match[1] ?? '';
      const add = ADD_VERBS[verb];
      const remove = REMOVE_VERBS[verb];
      if (add === undefined && remove === undefined) return null;

      const amount = parseNumber(ptBRNumbers, match[2] ?? '');
      if (amount === null || amount <= 0) return null;

      const item = cleanItemPhrase(match[3] ?? '');
      if (item === '') return null;

      return {
        kind: 'ADJUST_QUANTITY',
        item,
        amount,
        direction: add !== undefined ? 'up' : 'down',
        transaction: add ?? remove ?? 'add',
        unit: findUnit(match[2] ?? ''),
      };
    },
  },

  {
    // Last, because it is the most permissive.
    name: 'QUERY_QUANTITY',
    pattern:
      /^(?:quanto|quanta|quantos|quantas|tem|tenho|ainda tem|resta|restam)\s+(?:de\s+)?(.+?)(?:\s+(?:eu\s+)?(?:tenho|tem|temos|sobrou|resta))?\??$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_QUANTITY', item };
    },
  },
];

export const ptBRGrammar: Grammar = {
  language: 'pt-BR',
  rules,
  numbers: ptBRNumbers,
  dates: ptBRDates,
  units: UNITS,
  fillers: FILLERS,
  examples: [
    'quanto arroz eu tenho?',
    'o que esta vencendo?',
    'o que falta?',
    'adiciona cinco latas de feijao',
    'usei 3 ovos',
    'onde esta o arroz?',
  ],
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/voice/grammar/pt-BR.ts
git commit -m "Voice: the Portuguese grammar, eleven rules in deliberate order"
```

---

## Task 5: The parser

**Files:**
- Create: `src/voice/parse.ts`
- Test: `src/voice/parse.test.ts`

- [ ] **Step 1: Write the failing test**

This test covers the parser's own behaviour — order, folding, empty input. The breadth of Portuguese phrases belongs in Task 6.

```ts
// src/voice/parse.test.ts
import { describe, expect, it } from 'vitest';
import { parse } from './parse';
import { ptBRGrammar } from './grammar/pt-BR';

const CTX = { today: '2026-09-07' };

describe('parse', () => {
  it('folds accents and case before matching', () => {
    expect(parse(ptBRGrammar, 'Quanto ARROZ eu tenho?', CTX)).toEqual({
      kind: 'QUERY_QUANTITY',
      item: 'arroz',
    });
  });

  it('returns UNKNOWN for empty input, carrying the transcript', () => {
    expect(parse(ptBRGrammar, '   ', CTX)).toEqual({ kind: 'UNKNOWN', transcript: '   ' });
  });

  it('returns UNKNOWN rather than guessing at a bare item name', () => {
    expect(parse(ptBRGrammar, 'feijao preto', CTX).kind).toBe('UNKNOWN');
  });

  it('prefers SET_QUANTITY over QUERY_QUANTITY when both could match', () => {
    expect(parse(ptBRGrammar, 'agora tenho 12 latas de feijao', CTX)).toEqual({
      kind: 'SET_QUANTITY',
      item: 'feijao',
      amount: 12,
      unit: 'latas',
    });
  });

  it('prefers QUERY_EXPIRY_OF over SET_EXPIRY for a question', () => {
    expect(parse(ptBRGrammar, 'quando vence o leite?', CTX)).toEqual({
      kind: 'QUERY_EXPIRY_OF',
      item: 'leite',
    });
  });

  it('declines a rule whose build returns null and tries the next', () => {
    // "tira zero de arroz" matches the ADJUST pattern but has no usable amount,
    // so ADJUST declines and no later rule claims it.
    expect(parse(ptBRGrammar, 'tira zero de arroz', CTX).kind).toBe('UNKNOWN');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/voice/parse.test.ts`
Expected: FAIL — `Cannot find module './parse'`.

- [ ] **Step 3: Write the parser**

```ts
// src/voice/parse.ts
/**
 * Transcript to Intent.
 *
 * Pure, and deliberately dull: fold the text, walk the rules in order, take the
 * first that both matches and builds. A rule may decline by returning null,
 * which is how "tira zero de arroz" fails to become an adjustment instead of
 * becoming a wrong one.
 */
import { foldText } from '../domain/normalize';
import type { Intent } from './intents';
import type { Grammar, RuleTools, SlotContext } from './grammar/types';

export function parse(grammar: Grammar, transcript: string, context: SlotContext): Intent {
  const text = foldText(transcript);
  if (text === '') return { kind: 'UNKNOWN', transcript };

  const tools: RuleTools = {
    numbers: grammar.numbers,
    dates: grammar.dates,
    units: grammar.units,
  };

  for (const rule of grammar.rules) {
    const match = text.match(rule.pattern);
    if (match === null) continue;

    const intent = rule.build(match, tools, context);
    if (intent !== null) return intent;
  }

  return { kind: 'UNKNOWN', transcript };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/voice/parse.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/voice/parse.ts src/voice/parse.test.ts
git commit -m "Voice: the parser, first matching rule wins"
```

---

## Task 6: The Portuguese phrase corpus

This is the test suite that matters. Adding a phrase form means adding a row.

**Files:**
- Create: `src/voice/grammar/pt-BR.phrases.test.ts`

- [ ] **Step 1: Write the corpus**

```ts
// src/voice/grammar/pt-BR.phrases.test.ts
/**
 * Every Portuguese phrase form the application claims to understand.
 *
 * A transcript arrives without punctuation or capitals and often without
 * accents, which is why most rows below are written the way a recognizer
 * actually returns them rather than the way a person would type them.
 *
 * When a real phrase fails in real use, add it here first.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../parse';
import { ptBRGrammar } from './pt-BR';
import type { Intent } from '../intents';

const CTX = { today: '2026-09-07' };
const say = (text: string): Intent => parse(ptBRGrammar, text, CTX);

describe('pt-BR phrases: asking', () => {
  const quantity = ['quanto arroz eu tenho', 'quanto arroz', 'quantas latas de feijao tem',
    'tem acucar', 'tenho agua', 'quanta agua eu tenho', 'ainda tem cafe'];
  for (const phrase of quantity) {
    it(`"${phrase}" asks a quantity`, () => {
      expect(say(phrase).kind).toBe('QUERY_QUANTITY');
    });
  }

  it('recovers the item from a quantity question', () => {
    expect(say('quantas latas de feijao preto eu tenho')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'feijao preto',
    });
  });

  const expiring = ['o que esta vencendo', 'o que vai vencer', 'o que vence',
    'quais itens estao vencendo'];
  for (const phrase of expiring) {
    it(`"${phrase}" asks what is expiring`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: false });
    });
  }

  it('separates what already expired from what is about to', () => {
    expect(say('o que ja venceu')).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: true });
  });

  it('reads a window out of the question', () => {
    expect(say('o que vence nos proximos 30 dias')).toMatchObject({
      kind: 'QUERY_EXPIRING', withinDays: 30,
    });
  });

  const missing = ['o que falta', 'o que esta faltando', 'o que eu preciso comprar',
    'lista de compras', 'o que esta acabando'];
  for (const phrase of missing) {
    it(`"${phrase}" asks what is missing`, () => {
      expect(say(phrase).kind).toBe('QUERY_MISSING');
    });
  }

  it('asks where an item is', () => {
    expect(say('onde esta o arroz')).toEqual({
      kind: 'QUERY_WHERE', item: 'arroz', location: null,
    });
  });

  it('asks what is in a place', () => {
    expect(say('o que tem na despensa')).toEqual({
      kind: 'QUERY_WHERE', item: null, location: 'despensa',
    });
  });

  it('asks when something expires', () => {
    expect(say('quando vence o leite')).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'leite' });
  });

  it('asks for the preparedness score', () => {
    expect(say('como esta minha preparacao').kind).toBe('QUERY_SCORE');
  });
});

describe('pt-BR phrases: changing', () => {
  it('adds with a spoken number', () => {
    expect(say('adiciona cinco latas de feijao')).toEqual({
      kind: 'ADJUST_QUANTITY', item: 'feijao', amount: 5,
      direction: 'up', transaction: 'add', unit: 'latas',
    });
  });

  it('records a purchase as a purchase', () => {
    expect(say('comprei 2 kg de arroz')).toMatchObject({
      direction: 'up', transaction: 'purchase', amount: 2,
    });
  });

  it('records consumption as consumption', () => {
    expect(say('usei 3 ovos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'ovos', amount: 3,
      direction: 'down', transaction: 'consume',
    });
  });

  it('removes with a fraction', () => {
    expect(say('tira meio quilo de arroz')).toMatchObject({
      direction: 'down', amount: 0.5, item: 'arroz',
    });
  });

  it('sets an absolute quantity', () => {
    expect(say('agora tenho 12 latas de feijao')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 12, item: 'feijao',
    });
  });

  it('sets an expiry date', () => {
    expect(say('o leite vence dia 12')).toEqual({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-09-12',
    });
  });

  it('creates an item with everything it was told', () => {
    expect(say('criar item 10 kg de arroz na despensa')).toMatchObject({
      kind: 'CREATE_ITEM', name: 'arroz', amount: 10, unit: 'kg', location: 'despensa',
    });
  });
});

describe('pt-BR phrases: what must NOT parse', () => {
  const rejected = ['', '   ', 'feijao', 'feijao preto', 'e', 'aaa bbb ccc',
    'obrigado', 'tira de arroz', 'adiciona latas de'];
  for (const phrase of rejected) {
    it(`"${phrase}" is UNKNOWN rather than a guess`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }
});

describe('pt-BR phrases: as a recognizer returns them', () => {
  it('survives missing accents', () => {
    expect(say('quanto acucar eu tenho')).toEqual({ kind: 'QUERY_QUANTITY', item: 'acucar' });
  });

  it('survives full accents', () => {
    expect(say('Quanto açúcar eu tenho?')).toEqual({ kind: 'QUERY_QUANTITY', item: 'acucar' });
  });

  it('survives collapsed whitespace', () => {
    expect(say('  quanto   arroz  ')).toEqual({ kind: 'QUERY_QUANTITY', item: 'arroz' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/voice/grammar/pt-BR.phrases.test.ts`
Expected: some rows fail on the first run. **This is the work of the task.** Fix `pt-BR.ts` — never weaken a row to make it pass. If a phrase genuinely should not be understood, delete the row and say so in the commit.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS. The existing 402 tests must be untouched.

- [ ] **Step 4: Commit**

```bash
git add src/voice/grammar/pt-BR.phrases.test.ts src/voice/grammar/pt-BR.ts
git commit -m "Voice: the Portuguese phrase corpus"
```

---

## Task 7: The registry, English and Spanish

**Files:**
- Create: `src/voice/grammar/registry.ts`, `en.ts`, `es.ts`, and their `.numbers.ts` / `.dates.ts` pairs
- Test: `src/voice/grammar/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/voice/grammar/registry.test.ts
import { describe, expect, it } from 'vitest';
import { GRAMMARS, grammarFor } from './registry';
import { LANGUAGES } from '../../domain/settings';
import { parse } from '../parse';

const CTX = { today: '2026-09-07' };

describe('grammar registry', () => {
  it('has a grammar for every language the application offers', () => {
    for (const language of LANGUAGES) {
      expect(GRAMMARS[language]).toBeDefined();
      expect(GRAMMARS[language].language).toBe(language);
    }
  });

  it('gives every grammar at least three examples for HELP', () => {
    for (const language of LANGUAGES) {
      expect(GRAMMARS[language].examples.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('parses every grammar own examples into something other than UNKNOWN', () => {
    for (const language of LANGUAGES) {
      for (const example of GRAMMARS[language].examples) {
        expect(parse(GRAMMARS[language], example, CTX).kind).not.toBe('UNKNOWN');
      }
    }
  });

  it('understands English', () => {
    expect(parse(grammarFor('en'), 'how much rice do i have', CTX)).toEqual({
      kind: 'QUERY_QUANTITY', item: 'rice',
    });
  });

  it('understands Spanish', () => {
    expect(parse(grammarFor('es'), 'cuanto arroz tengo', CTX)).toEqual({
      kind: 'QUERY_QUANTITY', item: 'arroz',
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/voice/grammar/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Write the registry**

```ts
// src/voice/grammar/registry.ts
/**
 * Language to grammar.
 *
 * The same rule `translate.ts` follows: adding a language is one file and one
 * entry here, and no application logic changes.
 */
import type { Language } from '../../domain/settings';
import type { Grammar } from './types';
import { ptBRGrammar } from './pt-BR';
import { enGrammar } from './en';
import { esGrammar } from './es';

export const GRAMMARS: Readonly<Record<Language, Grammar>> = {
  'pt-BR': ptBRGrammar,
  en: enGrammar,
  es: esGrammar,
};

export function grammarFor(language: Language): Grammar {
  return GRAMMARS[language] ?? ptBRGrammar;
}
```

- [ ] **Step 4: Write `en.ts` and `es.ts`**

Copy `pt-BR.ts`, `pt-BR.numbers.ts` and `pt-BR.dates.ts` to `en.*` and `es.*` and translate the tables. The rule list, the rule order, `cleanItemPhrase` and `findUnit` stay identical — only the patterns and word tables change. Translate at minimum:

- **en** — verbs `add`/`bought`/`used`/`remove`; `how much`, `how many`, `what is expiring`, `what do i need`, `where is`, `when does … expire`; months `january`…`december`; numbers `one`…`thousand`, `half`, `a dozen`, `a pair`; fillers `the`, `a`, `an`, `of`.
- **es** — verbs `agrega`/`compre`/`use`/`quita`; `cuanto`, `cuanta`, `que esta venciendo`, `que falta`, `donde esta`, `cuando vence`; months `enero`…`diciembre`; numbers `uno`…`mil`, `media docena`, `medio`; fillers `el`, `la`, `los`, `las`, `de`, `del`.

Give each an `examples` array of at least three phrases in its own language, and confirm they parse — the registry test asserts exactly that.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/voice/grammar/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/voice/grammar/
git commit -m "Voice: English and Spanish grammars, one file and one registry line each"
```

---

# Phase 2 — Executing against the database

## Task 8: Resolving an item phrase

**Files:**
- Create: `src/services/voice/resolve.ts`
- Test: `src/services/voice/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/voice/resolve.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { resolveItem } from './resolve';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

describe('resolveItem', () => {
  let db: SqlDriver;
  let items: ReturnType<typeof createItemsRepository>;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    items = createItemsRepository(db);
    await items.create({ name: 'Feijão Preto', quantity: 12, unit: 'latas' });
    await items.create({ name: 'Feijão Carioca', quantity: 4, unit: 'latas' });
    await items.create({ name: 'Arroz Branco', quantity: 10, unit: 'kg' });
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('matches one item exactly, accents and all', async () => {
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao preto');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Feijão Preto');
  });

  it('matches a single item from a partial phrase', async () => {
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'arroz');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Arroz Branco');
  });

  it('never guesses between two equally good matches', async () => {
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao');
    expect(result.kind).toBe('many');
    if (result.kind === 'many') expect(result.items).toHaveLength(2);
  });

  it('prefers an exact name over a longer one that also contains it', async () => {
    await items.create({ name: 'Feijão', quantity: 1, unit: 'kg' });
    const result = await resolveItem(items, CONTEXT, 'pt-BR', 'feijao');
    expect(result.kind).toBe('one');
    if (result.kind === 'one') expect(result.item.name).toBe('Feijão');
  });

  it('reports nothing found rather than returning an empty list', async () => {
    expect((await resolveItem(items, CONTEXT, 'pt-BR', 'quinoa')).kind).toBe('none');
  });

  it('treats a blank phrase as nothing found', async () => {
    expect((await resolveItem(items, CONTEXT, 'pt-BR', '   ')).kind).toBe('none');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/voice/resolve.test.ts`
Expected: FAIL — `Cannot find module './resolve'`.

- [ ] **Step 3: Write the resolver**

```ts
// src/services/voice/resolve.ts
/**
 * An item phrase to an item.
 *
 * Reuses the existing search rather than growing a second one: `items.list`
 * already folds accents and ANDs across terms, which is exactly the matching a
 * garbled transcript needs.
 *
 * Ties matter more here than in a text search, because the user is not looking
 * at a list. A phrase that fits two items raises a choice; it never guesses.
 */
import { foldText } from '../../domain/normalize';
import type { InventoryItemView } from '../../types/domain';
import type { ItemContext, ItemsRepository } from '../../repositories/items.repository';
import type { Language } from '../../domain/settings';

export type Resolution =
  | { readonly kind: 'one'; readonly item: InventoryItemView }
  | { readonly kind: 'many'; readonly items: readonly InventoryItemView[] }
  | { readonly kind: 'none'; readonly phrase: string };

/** Higher wins. The gap between tiers is what makes a clear winner clear. */
function score(phrase: string, item: InventoryItemView): number {
  const name = foldText(item.name);
  if (name === phrase) return 100;
  if (name.startsWith(phrase)) return 60;

  const tokens = phrase.split(' ').filter((token) => token !== '');
  const inName = tokens.filter((token) => name.includes(token)).length;
  if (inName === tokens.length) return 40;

  const notes = item.notes === null ? '' : foldText(item.notes);
  const inNotes = tokens.filter((token) => notes.includes(token)).length;
  return inName * 4 + inNotes;
}

/** At most this many are offered as a choice; more than this means ask again. */
const MAX_CHOICES = 5;

export async function resolveItem(
  items: ItemsRepository,
  context: ItemContext,
  language: Language,
  phrase: string,
): Promise<Resolution> {
  const folded = foldText(phrase);
  if (folded === '') return { kind: 'none', phrase };

  const page = await items.list(context, {
    filters: { search: folded, archived: 'active' },
    limit: 50,
    lang: language,
  });

  const scored = page.rows
    .map((item) => ({ item, value: score(folded, item) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.item.name.localeCompare(b.item.name));

  const best = scored[0];
  if (best === undefined) return { kind: 'none', phrase };

  const tied = scored.filter((entry) => entry.value === best.value);
  if (tied.length === 1) return { kind: 'one', item: best.item };

  return { kind: 'many', items: tied.slice(0, MAX_CHOICES).map((entry) => entry.item) };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/voice/resolve.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/voice/resolve.ts src/services/voice/resolve.test.ts
git commit -m "Voice: resolve an item phrase, and never guess a tie"
```

---

## Task 9: Executing queries

**Files:**
- Create: `src/services/voice/execute.ts`
- Test: `src/services/voice/execute.queries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/voice/execute.queries.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { execute, type VoiceDeps } from './execute';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

describe('execute: queries', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    const items = createItemsRepository(db);
    const locations = createLocationsRepository(db);
    const pantry = await locations.create({ name: 'Despensa' });

    await items.create({
      name: 'Arroz Branco', quantity: 10, unit: 'kg', locationId: pantry.id,
      minimumQuantity: 5,
    });
    await items.create({
      name: 'Leite', quantity: 2, unit: 'l', expirationDate: '2026-09-12',
    });
    await items.create({
      name: 'Feijão Preto', quantity: 1, unit: 'kg', minimumQuantity: 10,
      idealQuantity: 20,
    });

    deps = { items, locations, context: CONTEXT, language: 'pt-BR' };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('answers a quantity question with the item and its number', async () => {
    const result = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'arroz' });
    expect(result).toMatchObject({ kind: 'answer', answer: { kind: 'QUANTITY' } });
    if (result.kind === 'answer' && result.answer.kind === 'QUANTITY') {
      expect(result.answer.item.name).toBe('Arroz Branco');
      expect(result.answer.item.quantity).toBe(10);
    }
  });

  it('lists what is expiring inside the window', async () => {
    const result = await execute(deps, {
      kind: 'QUERY_EXPIRING', withinDays: 30, expiredOnly: false,
    });
    expect(result.kind).toBe('answer');
    if (result.kind === 'answer' && result.answer.kind === 'EXPIRING') {
      expect(result.answer.items.map((i) => i.name)).toContain('Leite');
    }
  });

  it('lists what is missing', async () => {
    const result = await execute(deps, { kind: 'QUERY_MISSING' });
    expect(result.kind).toBe('answer');
    if (result.kind === 'answer' && result.answer.kind === 'MISSING') {
      expect(result.answer.lines.length).toBeGreaterThan(0);
    }
  });

  it('says where an item is', async () => {
    const result = await execute(deps, {
      kind: 'QUERY_WHERE', item: 'arroz', location: null,
    });
    if (result.kind === 'answer' && result.answer.kind === 'WHERE_ITEM') {
      expect(result.answer.item.locationName).toBe('Despensa');
    } else {
      throw new Error(`expected WHERE_ITEM, got ${result.kind}`);
    }
  });

  it('raises a choice instead of guessing', async () => {
    const items = createItemsRepository(db);
    await items.create({ name: 'Arroz Integral', quantity: 3, unit: 'kg' });
    const result = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'arroz' });
    expect(result.kind).toBe('choice');
  });

  it('reports an item it could not find, by the phrase that was said', async () => {
    const result = await execute(deps, { kind: 'QUERY_QUANTITY', item: 'quinoa' });
    expect(result).toMatchObject({ kind: 'notFound', phrase: 'quinoa' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/voice/execute.queries.test.ts`
Expected: FAIL — `Cannot find module './execute'`.

- [ ] **Step 3: Write the executor**

```ts
// src/services/voice/execute.ts
/**
 * An Intent, executed.
 *
 * THIS MODULE NEVER WRITES. A changing intent returns a `PendingWrite`
 * describing what would happen; only `commit.ts`, called by the confirmation
 * card, touches a repository's write path. `execute.writes.test.ts` asserts
 * that no execution of any intent reaches the driver with an UPDATE or INSERT.
 */
import type { Intent } from '../../voice/intents';
import type { InventoryItemView, StockTransactionType } from '../../types/domain';
import type { ItemContext, ItemsRepository } from '../../repositories/items.repository';
import type { LocationsRepository } from '../../repositories/locations.repository';
import type { Language } from '../../domain/settings';
import type { ReplenishmentLine } from '../../domain/replenishment';
import { buildReplenishmentList } from '../../domain/replenishment';
import { foldText } from '../../domain/normalize';
import { resolveItem } from './resolve';

export interface VoiceDeps {
  readonly items: ItemsRepository;
  readonly locations: LocationsRepository;
  readonly context: ItemContext;
  readonly language: Language;
}

export type Answer =
  | { readonly kind: 'QUANTITY'; readonly item: InventoryItemView }
  | { readonly kind: 'EXPIRING'; readonly items: readonly InventoryItemView[]; readonly withinDays: number; readonly expiredOnly: boolean }
  | { readonly kind: 'MISSING'; readonly lines: readonly ReplenishmentLine[] }
  | { readonly kind: 'WHERE_ITEM'; readonly item: InventoryItemView }
  | { readonly kind: 'WHERE_LOCATION'; readonly locationName: string; readonly items: readonly InventoryItemView[] }
  | { readonly kind: 'EXPIRY_OF'; readonly item: InventoryItemView }
  | { readonly kind: 'SCORE'; readonly score: number }
  | { readonly kind: 'HELP'; readonly examples: readonly string[] };

export type PendingWrite =
  | {
      readonly kind: 'ADJUST';
      readonly item: InventoryItemView;
      /** Signed. Negative for a removal, so `commit` needs no direction flag. */
      readonly delta: number;
      /** What the quantity becomes, clamped at zero as `adjustQuantity` clamps. */
      readonly after: number;
      readonly transaction: StockTransactionType;
    }
  | {
      readonly kind: 'CREATE';
      readonly name: string;
      readonly quantity: number;
      readonly unit: string;
      readonly locationId: string | null;
      /** Carried only so the card can name the place it resolved. */
      readonly locationName: string | null;
      readonly expirationDate: string | null;
    }
  | {
      readonly kind: 'EXPIRY';
      readonly item: InventoryItemView;
      readonly before: string | null;
      readonly after: string;
    };

export type Outcome =
  | { readonly kind: 'answer'; readonly answer: Answer }
  | { readonly kind: 'pending'; readonly write: PendingWrite }
  | { readonly kind: 'choice'; readonly items: readonly InventoryItemView[]; readonly intent: Intent }
  | { readonly kind: 'notFound'; readonly phrase: string; readonly intent: Intent }
  | { readonly kind: 'unknown'; readonly transcript: string; readonly examples: readonly string[] };

async function one(
  deps: VoiceDeps,
  phrase: string,
  intent: Intent,
): Promise<{ ok: true; item: InventoryItemView } | { ok: false; outcome: Outcome }> {
  const found = await resolveItem(deps.items, deps.context, deps.language, phrase);
  if (found.kind === 'one') return { ok: true, item: found.item };
  if (found.kind === 'many') {
    return { ok: false, outcome: { kind: 'choice', items: found.items, intent } };
  }
  return { ok: false, outcome: { kind: 'notFound', phrase, intent } };
}

export async function execute(deps: VoiceDeps, intent: Intent): Promise<Outcome> {
  switch (intent.kind) {
    case 'QUERY_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return { kind: 'answer', answer: { kind: 'QUANTITY', item: found.item } };
    }

    case 'QUERY_EXPIRY_OF': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return { kind: 'answer', answer: { kind: 'EXPIRY_OF', item: found.item } };
    }

    case 'QUERY_EXPIRING': {
      const withinDays = intent.withinDays ?? deps.context.expiryWindows[0] ?? 30;
      const page = await deps.items.list(deps.context, {
        filters: {
          archived: 'active',
          expiryBuckets: intent.expiredOnly ? ['expired'] : ['expired', 'today', 'soon'],
        },
        sort: { field: 'expiration', direction: 'asc' },
        limit: 50,
        lang: deps.language,
      });
      const rows = page.rows.filter(
        (item) => item.daysUntilExpiry !== null && item.daysUntilExpiry <= withinDays,
      );
      return {
        kind: 'answer',
        answer: { kind: 'EXPIRING', items: rows, withinDays, expiredOnly: intent.expiredOnly },
      };
    }

    case 'QUERY_MISSING': {
      const rows = await deps.items.listForAnalysis();
      const lines = buildReplenishmentList({
        items: rows,
        today: deps.context.today,
        defaultThreshold: deps.context.defaultThreshold,
        // Required by ReplenishmentInput. Omitting it is a compile error, and
        // the replenishment screen would disagree with the spoken answer.
        expiryWindows: deps.context.expiryWindows,
      });
      return { kind: 'answer', answer: { kind: 'MISSING', lines } };
    }

    case 'QUERY_WHERE': {
      if (intent.item !== null) {
        const found = await one(deps, intent.item, intent);
        if (!found.ok) return found.outcome;
        return { kind: 'answer', answer: { kind: 'WHERE_ITEM', item: found.item } };
      }

      const wanted = foldText(intent.location ?? '');
      const all = await deps.locations.list();
      const place = all.find((location) => foldText(location.name).includes(wanted));
      if (place === undefined) {
        return { kind: 'notFound', phrase: intent.location ?? '', intent };
      }

      const page = await deps.items.list(deps.context, {
        filters: { locationIds: [place.id], includeSublocations: true, archived: 'active' },
        limit: 50,
        lang: deps.language,
      });
      return {
        kind: 'answer',
        answer: { kind: 'WHERE_LOCATION', locationName: place.name, items: page.rows },
      };
    }

    case 'QUERY_SCORE': {
      const stats = await deps.items.dashboardStats(deps.context);
      const total = stats.totalItems === 0 ? 1 : stats.totalItems;
      const healthy = total - stats.critical - stats.low - stats.expired;
      const value = Math.max(0, Math.round((healthy / total) * 100));
      return { kind: 'answer', answer: { kind: 'SCORE', score: value } };
    }

    case 'ADJUST_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      const delta = intent.direction === 'up' ? intent.amount : -intent.amount;
      const after = Math.max(0, found.item.quantity + delta);
      return {
        kind: 'pending',
        write: { kind: 'ADJUST', item: found.item, delta, after, transaction: intent.transaction },
      };
    }

    case 'SET_QUANTITY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      const delta = intent.amount - found.item.quantity;
      return {
        kind: 'pending',
        write: {
          kind: 'ADJUST', item: found.item, delta, after: intent.amount,
          transaction: 'correction',
        },
      };
    }

    case 'SET_EXPIRY': {
      const found = await one(deps, intent.item, intent);
      if (!found.ok) return found.outcome;
      return {
        kind: 'pending',
        write: {
          kind: 'EXPIRY', item: found.item,
          before: found.item.expirationDate, after: intent.expiresOn,
        },
      };
    }

    case 'CREATE_ITEM': {
      let locationId: string | null = null;
      let locationName: string | null = null;
      if (intent.location !== null) {
        const wanted = foldText(intent.location);
        const place = (await deps.locations.list()).find((l) =>
          foldText(l.name).includes(wanted),
        );
        if (place !== undefined) {
          locationId = place.id;
          locationName = place.name;
        }
      }
      return {
        kind: 'pending',
        write: {
          kind: 'CREATE',
          name: intent.name,
          quantity: intent.amount ?? 1,
          unit: intent.unit ?? 'un',
          locationId,
          locationName,
          expirationDate: intent.expiresOn,
        },
      };
    }

    case 'HELP':
      return { kind: 'answer', answer: { kind: 'HELP', examples: [] } };

    case 'UNKNOWN':
      return { kind: 'unknown', transcript: intent.transcript, examples: [] };
  }
}
```

**Two notes for the implementer.** `HELP` and `UNKNOWN` return empty `examples`; the caller fills them from the active grammar, because `execute` has no grammar and should not grow one. And `locations.findByName` exists but is not used here — it matches a whole name, whereas a speaker says "despensa" for "Despensa Principal", so the fold-and-contains search above is deliberate.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/voice/execute.queries.test.ts`
Expected: PASS, 6 tests. If `dashboardStats` or `locations.list()` have different names, run `grep -n "return {" -A40 src/repositories/locations.repository.ts` and use the real ones.

- [ ] **Step 5: Commit**

```bash
git add src/services/voice/execute.ts src/services/voice/execute.queries.test.ts
git commit -m "Voice: execute queries over the repositories that already exist"
```

---

## Task 10: Writes stay pending, and a test that proves it

**Files:**
- Create: `src/services/voice/commit.ts`
- Test: `src/services/voice/execute.writes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/voice/execute.writes.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository, type ItemContext } from '../../repositories/items.repository';
import { createLocationsRepository } from '../../repositories/locations.repository';
import { execute, type VoiceDeps } from './execute';
import { commit } from './commit';

const CONTEXT: ItemContext = {
  today: '2026-09-07', defaultThreshold: 5, expiryWindows: [7, 30, 90],
};

describe('execute: writes are only ever pending', () => {
  let db: SqlDriver;
  let deps: VoiceDeps;
  let items: ReturnType<typeof createItemsRepository>;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    items = createItemsRepository(db);
    await items.create({ name: 'Feijão Preto', quantity: 12, unit: 'latas' });
    deps = {
      items, locations: createLocationsRepository(db),
      context: CONTEXT, language: 'pt-BR',
    };
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('describes an adjustment without performing it', async () => {
    const result = await execute(deps, {
      kind: 'ADJUST_QUANTITY', item: 'feijao preto', amount: 5,
      direction: 'up', transaction: 'add', unit: 'latas',
    });

    expect(result).toMatchObject({ kind: 'pending', write: { kind: 'ADJUST', after: 17 } });

    const page = await items.list(CONTEXT, { filters: { search: 'feijao' } });
    expect(page.rows[0]?.quantity).toBe(12); // unchanged
  });

  it('sends no INSERT or UPDATE to the driver while executing any intent', async () => {
    const exec = vi.spyOn(db, 'exec');
    const batch = vi.spyOn(db, 'batch');

    await execute(deps, {
      kind: 'ADJUST_QUANTITY', item: 'feijao preto', amount: 5,
      direction: 'up', transaction: 'add', unit: null,
    });
    await execute(deps, { kind: 'SET_QUANTITY', item: 'feijao preto', amount: 3, unit: null });
    await execute(deps, {
      kind: 'SET_EXPIRY', item: 'feijao preto', expiresOn: '2027-01-01',
    });
    await execute(deps, {
      kind: 'CREATE_ITEM', name: 'quinoa', amount: 2, unit: 'kg',
      location: null, expiresOn: null,
    });

    const written = exec.mock.calls.filter(([sql]) =>
      /^\s*(?:insert|update|delete)/i.test(String(sql)),
    );
    expect(written).toHaveLength(0);
    expect(batch).not.toHaveBeenCalled();
  });

  // WARNING: the test above does NOT prove the property on its own.
  // `adjustQuantity` writes inside `db.transaction`, and `create-driver.ts`
  // builds the transaction handle from the driver primitives directly, so
  // `tx.exec` never passes through `db.exec`. A spy on `db.exec` is blind to
  // the only write path an adjustment takes, and `batch` is never called by
  // either module - so both assertions pass happily over a module that DID
  // write. Spy on `transaction` too, and prove the spies are not watching
  // nothing by committing a real write and asserting they fire.
  it('the spies are actually watching the write path', async () => {
    const exec = vi.spyOn(db, 'exec');
    const transaction = vi.spyOn(db, 'transaction');

    const result = await execute(deps, {
      kind: 'ADJUST_QUANTITY', item: 'feijao preto', amount: 5,
      direction: 'up', transaction: 'add', unit: null,
    });
    if (result.kind !== 'pending') throw new Error('expected a pending write');
    await commit(deps, result.write);

    expect(transaction.mock.calls.length + exec.mock.calls.length).toBeGreaterThan(0);
  });

  it('commit is what actually writes', async () => {
    const result = await execute(deps, {
      kind: 'ADJUST_QUANTITY', item: 'feijao preto', amount: 5,
      direction: 'up', transaction: 'purchase', unit: null,
    });
    if (result.kind !== 'pending') throw new Error('expected a pending write');

    await commit(deps, result.write);

    const page = await items.list(CONTEXT, { filters: { search: 'feijao' } });
    expect(page.rows[0]?.quantity).toBe(17);
  });

  it('creates an item on commit, with the defaults it was not told', async () => {
    const result = await execute(deps, {
      kind: 'CREATE_ITEM', name: 'quinoa', amount: 2, unit: 'kg',
      location: null, expiresOn: null,
    });
    if (result.kind !== 'pending') throw new Error('expected a pending write');

    await commit(deps, result.write);

    const page = await items.list(CONTEXT, { filters: { search: 'quinoa' } });
    expect(page.rows[0]).toMatchObject({ name: 'quinoa', quantity: 2, unit: 'kg' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/voice/execute.writes.test.ts`
Expected: FAIL — `Cannot find module './commit'`.

- [ ] **Step 3: Write the committer**

```ts
// src/services/voice/commit.ts
/**
 * The only module in the voice feature that writes.
 *
 * Called by the confirmation card's button and by nothing else, which is what
 * makes "nothing is stored until you tap Confirmar" a structural property
 * rather than a promise about the interface.
 */
import type { InventoryItem } from '../../types/domain';
import type { VoiceDeps, PendingWrite } from './execute';

export async function commit(deps: VoiceDeps, write: PendingWrite): Promise<InventoryItem> {
  switch (write.kind) {
    case 'ADJUST':
      return deps.items.adjustQuantity(write.item.id, write.delta, {
        type: write.transaction,
        notes: 'Por voz',
      });

    case 'EXPIRY':
      return deps.items.update(write.item.id, { expirationDate: write.after });

    case 'CREATE':
      return deps.items.create({
        name: write.name,
        quantity: write.quantity,
        unit: write.unit,
        locationId: write.locationId,
        expirationDate: write.expirationDate,
      });
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/voice/execute.writes.test.ts`
Expected: PASS, 4 tests. The spy test is the important one — if it fails, `execute` has grown a write and must lose it.

- [ ] **Step 5: Commit**

```bash
git add src/services/voice/commit.ts src/services/voice/execute.writes.test.ts
git commit -m "Voice: nothing is written until it is confirmed, and a spy proves it"
```

---

## Task 11: Turning an Answer into a sentence

**Files:**
- Create: `src/services/voice/answer.ts`
- Test: `src/services/voice/answer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/voice/answer.test.ts
import { describe, expect, it } from 'vitest';
import { renderAnswer } from './answer';
import { translate } from '../../i18n/translate';
import type { InventoryItemView } from '../../types/domain';

const t = (key: string, values?: Record<string, string | number>) =>
  translate('pt-BR', key, values);

const item = {
  id: '1', name: 'Arroz Branco', quantity: 10, unit: 'kg',
  locationName: 'Despensa', expirationDate: '2026-12-01', daysUntilExpiry: 85,
} as unknown as InventoryItemView;

describe('renderAnswer', () => {
  it('states a quantity with its unit and place', () => {
    const text = renderAnswer(t, { kind: 'QUANTITY', item });
    expect(text).toContain('Arroz Branco');
    expect(text).toContain('10');
    expect(text).toContain('kg');
  });

  it('says plainly when nothing is expiring, rather than showing an empty list', () => {
    const text = renderAnswer(t, {
      kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: false,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('undefined');
  });

  it('names at most three items and counts the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...item, name: `Item ${i}` }));
    const text = renderAnswer(t, {
      kind: 'EXPIRING', items: many as InventoryItemView[], withinDays: 30, expiredOnly: false,
    });
    expect(text).toContain('Item 0');
    expect(text).not.toContain('Item 6');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/voice/answer.test.ts`
Expected: FAIL — `Cannot find module './answer'`.

- [ ] **Step 3: Write it**

```ts
// src/services/voice/answer.ts
/**
 * An Answer as a sentence.
 *
 * Three rules, all of which follow from the sentence being SPOKEN:
 *
 *   Name at most three items and count the rest. Forty names read aloud is
 *   noise, and the screen shows the full list anyway.
 *   An empty result is a sentence, never an empty list. "Nada vence nos
 *   proximos 30 dias" is an answer; showing nothing is not.
 *   Every number goes through `t`, so a plural is a plural in all three
 *   languages without this module knowing any of their rules.
 */
import type { TranslateFn } from '../../i18n/translate';
import type { InventoryItemView } from '../../types/domain';
import type { Answer } from './execute';

/** How many names a spoken sentence carries before it starts counting. */
const NAMED = 3;

function namesOf(t: TranslateFn, items: readonly { name: string }[]): string {
  const named = items.slice(0, NAMED).map((item) => item.name).join(', ');
  const rest = items.length - NAMED;
  return rest > 0 ? `${named}, ${t('voice.andMore', { count: rest })}` : named;
}

function quantity(t: TranslateFn, item: InventoryItemView): string {
  const values = { name: item.name, quantity: item.quantity, unit: item.unit };
  return item.locationName === null
    ? t('voice.quantityAnswerNoLocation', values)
    : t('voice.quantityAnswer', { ...values, location: item.locationName });
}

export function renderAnswer(t: TranslateFn, answer: Answer): string {
  switch (answer.kind) {
    case 'QUANTITY':
      return quantity(t, answer.item);

    case 'EXPIRING': {
      if (answer.items.length === 0) {
        return answer.expiredOnly
          ? t('voice.expiredNone')
          : t('voice.expiringNone', { days: answer.withinDays });
      }
      return t('voice.expiringSome', {
        count: answer.items.length,
        days: answer.withinDays,
        names: namesOf(t, answer.items),
      });
    }

    case 'MISSING': {
      if (answer.lines.length === 0) return t('voice.missingNone');
      return t('voice.missingSome', {
        count: answer.lines.length,
        names: namesOf(t, answer.lines),
      });
    }

    case 'WHERE_ITEM':
      return answer.item.locationName === null
        ? t('voice.whereItemUnplaced', { name: answer.item.name })
        : t('voice.whereItem', {
            name: answer.item.name,
            location: answer.item.locationName,
          });

    case 'WHERE_LOCATION':
      return answer.items.length === 0
        ? t('voice.whereLocationNone', { location: answer.locationName })
        : t('voice.whereLocationSome', {
            location: answer.locationName,
            count: answer.items.length,
            names: namesOf(t, answer.items),
          });

    case 'EXPIRY_OF':
      return answer.item.expirationDate === null
        ? t('voice.expiryOfNone', { name: answer.item.name })
        : t('voice.expiryOf', {
            name: answer.item.name,
            date: answer.item.expirationDate,
          });

    case 'SCORE':
      return t('voice.score', { score: answer.score });

    case 'HELP':
      return `${t('voice.examplesTitle')}: ${answer.examples.join('; ')}`;
  }
}
```

`ReplenishmentLine` carries a `name`, which is why `namesOf` takes `{ name: string }[]` rather than `InventoryItemView[]` — check that against `src/domain/replenishment.ts:43` before writing, and widen the parameter if the field is called something else.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/voice/answer.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/voice/answer.ts src/services/voice/answer.test.ts
git commit -m "Voice: render an answer as a sentence worth hearing"
```

---

# Phase 3 — The speech platform

## Task 12: The recognizer contract and the unavailable case

**Files:**
- Create: `src/services/speech/recognizer.ts`, `src/services/speech/none.ts`
- Test: `src/services/speech/recognizer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/speech/recognizer.test.ts
import { describe, expect, it } from 'vitest';
import { noneRecognizer } from './none';

describe('noneRecognizer', () => {
  it('reports itself unavailable', async () => {
    expect(await noneRecognizer.availability()).toBe('unavailable');
  });

  it('rejects rather than resolving with an empty transcript', async () => {
    await expect(noneRecognizer.listen('pt-BR')).rejects.toThrow(/unavailable/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/speech/recognizer.test.ts`
Expected: FAIL — `Cannot find module './none'`.

- [ ] **Step 3: Write the contract and the null implementation**

```ts
// src/services/speech/recognizer.ts
/**
 * The speech seam.
 *
 * Above this, nothing knows whether Android's system recognizer, Chrome's
 * on-device model or nothing at all is listening - the same separation
 * `SqlDriver` gives the database.
 *
 * Every implementation transcribes ON THE DEVICE. There is no implementation
 * that reaches a server, and adding one would fail `npm run build`.
 */
export type SpeechAvailability = 'ready' | 'installable' | 'unavailable';

export interface SpeechRecognizer {
  /**
   * Takes the language, because availability is per-language: a device with an
   * English model and no Portuguese one is `ready` for one and `unavailable`
   * for the other. Optional so a caller that only wants "is there a microphone
   * at all" need not pick a language.
   */
  readonly availability: (tag?: string) => Promise<SpeechAvailability>;
  /** Offer the platform's own language-pack install, where one exists. */
  readonly install?: (tag: string) => Promise<boolean>;
  /** One utterance. Rejects rather than resolving empty. */
  readonly listen: (tag: string) => Promise<string>;
}
```

```ts
// src/services/speech/none.ts
import type { SpeechRecognizer } from './recognizer';

/**
 * Safari, Firefox, and every test.
 *
 * Not a degraded mode: the typed box is present on every platform, so a device
 * without on-device speech loses the microphone and keeps the feature.
 */
export const noneRecognizer: SpeechRecognizer = {
  availability: async () => 'unavailable',
  listen: async () => {
    throw new Error('Speech recognition is unavailable on this device.');
  },
};
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/speech/recognizer.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/speech/recognizer.ts src/services/speech/none.ts src/services/speech/recognizer.test.ts
git commit -m "Voice: the speech seam, and the case where there is no microphone"
```

---

## Task 13: Chrome, on-device only

The guard that keeps the offline promise. Write it carefully.

**Files:**
- Create: `src/services/speech/webspeech.ts`
- Test: `src/services/speech/webspeech.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/speech/webspeech.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebSpeechRecognizer } from './webspeech';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  processLocally = false;
  continuous = false;
  interimResults = false;
  started = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() { this.started = true; }
  abort() { this.started = false; }
}

describe('webspeech recognizer', () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unavailable when the API is absent', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    const recognizer = createWebSpeechRecognizer();
    expect(await recognizer.availability()).toBe('unavailable');
  });

  it('reports unavailable when the API cannot run on-device at all', async () => {
    const recognizer = createWebSpeechRecognizer();
    expect(await recognizer.availability()).toBe('unavailable');
  });

  it('reports ready when the language is present on the device', async () => {
    (FakeRecognition as unknown as Record<string, unknown>).availableOnDevice =
      vi.fn(async () => 'available');
    const recognizer = createWebSpeechRecognizer();
    expect(await recognizer.availability('pt-BR')).toBe('ready');
  });

  it('ALWAYS sets processLocally before starting', async () => {
    (FakeRecognition as unknown as Record<string, unknown>).availableOnDevice =
      vi.fn(async () => 'available');
    const recognizer = createWebSpeechRecognizer();
    void recognizer.listen('pt-BR');
    await Promise.resolve();

    const instance = FakeRecognition.instances[0];
    expect(instance).toBeDefined();
    expect(instance?.processLocally).toBe(true);
    expect(instance?.started).toBe(true);
  });

  it('NEVER starts when the language is not available on-device', async () => {
    (FakeRecognition as unknown as Record<string, unknown>).availableOnDevice =
      vi.fn(async () => 'unavailable');
    const recognizer = createWebSpeechRecognizer();

    await expect(recognizer.listen('pt-BR')).rejects.toThrow(/on-device/i);
    expect(FakeRecognition.instances.every((i) => !i.started)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/speech/webspeech.test.ts`
Expected: FAIL — `Cannot find module './webspeech'`.

- [ ] **Step 3: Write it**

```ts
// src/services/speech/webspeech.ts
/**
 * Chrome, transcribing on the device and nowhere else.
 *
 * THIS IS THE ONLY MODULE PERMITTED TO CONSTRUCT `SpeechRecognition`.
 * `scripts/audit-offline.mjs` fails the build if the identifier appears
 * anywhere else, because the default mode of this API streams audio to
 * Google's servers and would make the application's central claim false.
 *
 * `processLocally = true` is what prevents that. It fails CLOSED: with no local
 * model the call errors rather than quietly falling back to the network, which
 * is the property that makes this API usable here at all. Never set it
 * conditionally, and never start a recognizer without it.
 */
import type { SpeechAvailability, SpeechRecognizer } from './recognizer';

interface OnDeviceCapable {
  new (): SpeechRecognitionLike;
  availableOnDevice?: (lang: string) => Promise<string>;
  installOnDevice?: (lang: string) => Promise<boolean>;
}

interface SpeechRecognitionLike {
  lang: string;
  processLocally: boolean;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

function api(): OnDeviceCapable | undefined {
  const scope = globalThis as unknown as Record<string, unknown>;
  return (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as
    | OnDeviceCapable
    | undefined;
}

function transcriptOf(event: unknown): string {
  const results = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results;
  const first = results?.[0]?.[0]?.transcript;
  return typeof first === 'string' ? first : '';
}

export function createWebSpeechRecognizer(): SpeechRecognizer {
  async function availability(tag = 'pt-BR'): Promise<SpeechAvailability> {
    const Recognition = api();
    if (Recognition === undefined) return 'unavailable';
    // Without this static method the browser has only the networked mode,
    // which this application does not use under any circumstance.
    if (typeof Recognition.availableOnDevice !== 'function') return 'unavailable';

    const state = await Recognition.availableOnDevice(tag).catch(() => 'unavailable');
    if (state === 'available') return 'ready';
    if (state === 'downloadable' || state === 'downloading') return 'installable';
    return 'unavailable';
  }

  return {
    availability,

    async install(tag: string): Promise<boolean> {
      const Recognition = api();
      if (typeof Recognition?.installOnDevice !== 'function') return false;
      return Recognition.installOnDevice(tag).catch(() => false);
    },

    async listen(tag: string): Promise<string> {
      const Recognition = api();
      if (Recognition === undefined) throw new Error('Speech recognition is unavailable.');

      // Checked before construction, so a device without the language never
      // reaches `start()` and therefore never reaches a server.
      if ((await availability(tag)) !== 'ready') {
        throw new Error(`No on-device speech model for ${tag}.`);
      }

      return new Promise<string>((resolve, reject) => {
        const recognition = new Recognition();
        recognition.processLocally = true;
        recognition.lang = tag;
        recognition.continuous = false;
        recognition.interimResults = false;

        let settled = false;
        recognition.onresult = (event) => {
          settled = true;
          const text = transcriptOf(event);
          if (text === '') reject(new Error('Nothing was heard.'));
          else resolve(text);
        };
        recognition.onerror = () => {
          settled = true;
          reject(new Error('Speech recognition failed.'));
        };
        recognition.onend = () => {
          if (!settled) reject(new Error('Nothing was heard.'));
        };

        recognition.start();
      });
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/speech/webspeech.test.ts`
Expected: PASS, 5 tests. The last two are the guarantee — if either fails, stop and fix the module, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/services/speech/webspeech.ts src/services/speech/webspeech.test.ts
git commit -m "Voice: Chrome transcribes on the device, and fails closed if it cannot"
```

---

## Task 14: Speaking answers aloud

**Files:**
- Create: `src/services/speech/speak.ts`
- Test: `src/services/speech/speak.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/speech/speak.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker } from './speak';

afterEach(() => vi.unstubAllGlobals());

describe('createSpeaker', () => {
  it('says nothing when the setting is off', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });

    await createSpeaker(() => false).say('doze latas', 'pt-BR');
    expect(speak).not.toHaveBeenCalled();
  });

  it('speaks when the setting is on', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });

    await createSpeaker(() => true).say('doze latas', 'pt-BR');
    expect(speak).toHaveBeenCalledOnce();
  });

  it('does not throw where speechSynthesis does not exist', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    await expect(createSpeaker(() => true).say('oi', 'pt-BR')).resolves.toBeUndefined();
  });

  it('cancels anything still being spoken before starting', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel, getVoices: () => [] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });

    await createSpeaker(() => true).say('oi', 'pt-BR');
    expect(cancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/speech/speak.test.ts`
Expected: FAIL — `Cannot find module './speak'`.

- [ ] **Step 3: Write it**

```ts
// src/services/speech/speak.ts
/**
 * Reading an answer aloud.
 *
 * `speechSynthesis` is a system service, not a network request: the audit
 * scans for constructs that fetch, and this is not one. On Android the voice is
 * whichever pt-BR voice the system has installed, which is one by default.
 *
 * `enabled` is a function rather than a boolean so a settings change takes
 * effect on the next sentence without rebuilding the speaker. Android's ringer
 * switch is NOT consulted here - this module has no platform knowledge. The
 * sheet composes the two (see `speakUnlessSilent` in Task 19), which keeps this
 * testable without a Capacitor bridge.
 */
export interface Speaker {
  readonly say: (text: string, tag: string) => Promise<void>;
  readonly stop: () => void;
}

export function createSpeaker(enabled: () => boolean): Speaker {
  return {
    async say(text, tag) {
      if (!enabled()) return;
      const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis })
        .speechSynthesis;
      const Utterance = (globalThis as unknown as {
        SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
      }).SpeechSynthesisUtterance;
      if (synth === undefined || Utterance === undefined || text === '') return;

      // An answer that arrives while the last one is still being read would
      // otherwise queue, and the user would hear a stale sentence first.
      synth.cancel();

      const utterance = new Utterance(text);
      utterance.lang = tag;
      const voice = synth.getVoices().find((candidate) => candidate.lang === tag);
      if (voice !== undefined) utterance.voice = voice;
      synth.speak(utterance);
    },

    stop() {
      const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis })
        .speechSynthesis;
      synth?.cancel();
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/speech/speak.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/speech/speak.ts src/services/speech/speak.test.ts
git commit -m "Voice: speak answers through the system voice, off when the setting is off"
```

---

## Task 15: The Android plugin

The permission gate must still pass. Verify it before committing.

**Files:**
- Create: `android/app/src/main/java/app/stockguardian/android/SpeechPlugin.kt`
- Create: `src/services/speech/capacitor.ts`
- Modify: `android/app/src/main/java/app/stockguardian/android/MainActivity.java` (register the plugin)
- Modify: `android/app/src/main/AndroidManifest.xml` (comment only, no permission)

- [ ] **Step 1: Write the Kotlin plugin**

```kotlin
// android/app/src/main/java/app/stockguardian/android/SpeechPlugin.kt
package app.stockguardian.android

import android.app.Activity
import android.content.Intent
import android.media.AudioManager
import android.speech.RecognizerIntent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Speech capture that asks for no permission.
 *
 * ACTION_RECOGNIZE_SPEECH hands recording to the system recognizer, which holds
 * the microphone itself. This application never opens it and therefore declares
 * no RECORD_AUDIO. The workflow at .github/workflows/android.yml fails the build
 * if any permission appears, so this property is checked rather than trusted.
 *
 * EXTRA_PREFER_OFFLINE asks the recognizer to stay on the device. The value of
 * that request depends on the installed recognizer, which is why the interface
 * says on-device speech is a device capability rather than a guarantee this
 * application can make on the device's behalf.
 */
@CapacitorPlugin(name = "Speech")
class SpeechPlugin : Plugin() {

    @PluginMethod
    fun listen(call: PluginCall) {
        val tag = call.getString("lang") ?: "pt-BR"

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        startActivityForResult(call, intent, "handleResult")
    }

    @ActivityCallback
    private fun handleResult(call: PluginCall?, result: androidx.activity.result.ActivityResult) {
        if (call == null) return

        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("cancelled")
            return
        }

        val spoken = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()

        if (spoken.isNullOrBlank()) {
            call.reject("empty")
        } else {
            call.resolve(com.getcapacitor.JSObject().put("transcript", spoken))
        }
    }

    /** Whether a recognizer exists at all, so the interface can hide the button. */
    @PluginMethod
    fun availability(call: PluginCall) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        val handlers = context.packageManager.queryIntentActivities(intent, 0)
        call.resolve(
            com.getcapacitor.JSObject()
                .put("state", if (handlers.isEmpty()) "unavailable" else "ready"),
        )
    }

    /**
     * Whether the phone is on silent. Read so that spoken answers respect the
     * switch on the side of the device, which a WebView cannot see on its own.
     */
    @PluginMethod
    fun isSilent(call: PluginCall) {
        val audio = context.getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager
        val silent = audio.ringerMode != AudioManager.RINGER_MODE_NORMAL
        call.resolve(com.getcapacitor.JSObject().put("silent", silent))
    }
}
```

- [ ] **Step 2: Register it**

In `MainActivity.java`, add the registration Capacitor expects:

```java
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

- [ ] **Step 3: Write the TypeScript side**

```ts
// src/services/speech/capacitor.ts
/**
 * Android, through the system's own recognizer.
 *
 * See SpeechPlugin.kt: the system records, so this application declares no
 * microphone permission. One utterance per call - the Intent has no continuous
 * mode, which is why the design has no wake word.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { SpeechAvailability, SpeechRecognizer } from './recognizer';

interface SpeechPlugin {
  listen: (options: { lang: string }) => Promise<{ transcript: string }>;
  availability: () => Promise<{ state: SpeechAvailability }>;
  isSilent: () => Promise<{ silent: boolean }>;
}

const Speech = registerPlugin<SpeechPlugin>('Speech');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function androidIsSilent(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  return Speech.isSilent().then((r) => r.silent).catch(() => false);
}

export function createCapacitorRecognizer(): SpeechRecognizer {
  return {
    async availability(): Promise<SpeechAvailability> {
      if (!isNativeAndroid()) return 'unavailable';
      return Speech.availability().then((r) => r.state).catch(() => 'unavailable');
    },

    async listen(tag: string): Promise<string> {
      const { transcript } = await Speech.listen({ lang: tag });
      if (transcript.trim() === '') throw new Error('Nothing was heard.');
      return transcript;
    },
  };
}
```

- [ ] **Step 4: Add platform selection to `recognizer.ts`**

```ts
// append to src/services/speech/recognizer.ts
import { noneRecognizer } from './none';
import { createWebSpeechRecognizer } from './webspeech';
import { createCapacitorRecognizer, isNativeAndroid } from './capacitor';

/**
 * The recognizer for this device.
 *
 * Android first: inside the APK the system recognizer is both available and
 * permission-free, and Chrome's WebView does not expose the Web Speech API
 * anyway.
 */
export async function selectRecognizer(tag: string): Promise<SpeechRecognizer> {
  if (isNativeAndroid()) return createCapacitorRecognizer();

  const web = createWebSpeechRecognizer();
  return (await web.availability(tag)) === 'unavailable' ? noneRecognizer : web;
}
```

`availability` on the contract takes an optional tag; update the interface to `(tag?: string) => Promise<SpeechAvailability>` so this compiles.

- [ ] **Step 5: Prove the permission gate still passes**

```bash
npx cap sync android
cd android && ./gradlew assembleDebug && cd ..
```

Then run the same check the workflow runs:

```bash
"$ANDROID_HOME/build-tools/34.0.0/aapt2" dump permissions \
  android/app/build/outputs/apk/debug/app-debug.apk \
  | grep '^uses-permission:' | cut -d"'" -f2 | grep -v '^app.stockguardian.android.'
```

Expected: **no output**. Any line means a permission crept in, and the task is not done. If Gradle or the SDK is not installed on this machine, push the branch and read the `android.yml` workflow result instead — do not skip this step.

- [ ] **Step 6: Extend the manifest comment**

Add to the existing comment block in `AndroidManifest.xml`, after the paragraph about `INTERNET`:

```
        Voice control does not change this. Speech arrives through the system's
        own recognizer (ACTION_RECOGNIZE_SPEECH, see SpeechPlugin.kt), which
        holds the microphone itself, so this application needs no RECORD_AUDIO.
        Do not add it: the feature works without it, and the check below fails
        on it.
```

- [ ] **Step 7: Commit**

```bash
git add android/ src/services/speech/capacitor.ts src/services/speech/recognizer.ts
git commit -m "Voice: Android speech through the system recognizer, still zero permissions"
```

---

## Task 16: Teach the offline audit about SpeechRecognition

**Files:**
- Modify: `scripts/audit-offline.mjs`

- [ ] **Step 1: Read the existing rules**

Run: `grep -n "fetch\|importScripts\|sendBeacon" scripts/audit-offline.mjs`

Follow whatever shape the existing JavaScript rules use. Do not restructure the script.

- [ ] **Step 2: Add the rule**

Add `SpeechRecognition` to the scanned constructs, with one permitted source module. The comment matters as much as the code:

```js
/*
 * `SpeechRecognition` in its default mode streams audio to Google's servers,
 * which would make this application's central claim false. It is permitted in
 * exactly one module, which sets `processLocally = true` and checks
 * `availableOnDevice()` before starting; `webspeech.test.ts` pins both. Anywhere
 * else, it is a bug.
 */
const SPEECH_ALLOWED_SOURCE = 'src/services/speech/webspeech.ts';
```

Because `dist/` is bundled and minified, match on the built output the same way the existing JavaScript rules do, and allow the single bundle chunk that contains the module. If the existing rules cannot express "one permitted site" against a bundle, apply the rule to `src/` instead and say so in the comment — a source-level check that runs is worth more than a bundle-level check that cannot.

- [ ] **Step 3: Prove it catches a violation**

Temporarily add `new SpeechRecognition()` to `src/features/dashboard/DashboardScreen.tsx`, then:

Run: `npm run build`
Expected: FAIL, naming the file.

Remove the line and run again.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-offline.mjs
git commit -m "Audit: SpeechRecognition is permitted in one module and nowhere else"
```

---

# Phase 4 — The interface

## Task 17: Settings

**Files:**
- Modify: `src/domain/settings.ts`
- Test: `src/domain/settings.test.ts` (or the existing settings test file)

- [ ] **Step 1: Write the failing test**

```ts
it('defaults voice on, and speaking on', () => {
  expect(DEFAULT_SETTINGS.voiceEnabled).toBe(true);
  expect(DEFAULT_SETTINGS.voiceSpeakAnswers).toBe(true);
});

it('keeps the application startable when a voice setting is corrupt', () => {
  const { settings } = parseSettings([{ key: 'voiceEnabled', value: '"nonsense"' }]);
  expect(settings.voiceEnabled).toBe(true);
});
```

`parseSettings` returns `{ settings, invalidKeys }`, not a bare `Settings` — hence the
destructure. The tests live in `src/database/seed/seed.test.ts`; there is no
`src/domain/settings.test.ts`, and that seed file is the only test exercising
`parseSettings` and `DEFAULT_SETTINGS` directly.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/domain/`
Expected: FAIL — `voiceEnabled` is not a property.

- [ ] **Step 3: Add the keys**

```ts
  /** Shows or hides the microphone. The typed box stays either way. */
  voiceEnabled: z.boolean().default(true),

  /**
   * Reads answers aloud through the system voice. On Android this also yields
   * to the ringer switch; a browser cannot see that state, so there this is the
   * only control.
   */
  voiceSpeakAnswers: z.boolean().default(true),
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/settings.ts src/domain/settings.test.ts
git commit -m "Voice: two settings, defaulting on"
```

---

## Task 18: Translations

**Files:**
- Modify: `src/i18n/locales/en.ts`, `pt-BR.ts`, `es.ts`

- [ ] **Step 1: Add the section to `en.ts`**

`TranslationKey` derives from the English tree, so English comes first and the other two become compile errors until they match.

```ts
  voice: {
    title: 'Voice',
    button: 'Speak a command',
    listening: 'Listening…',
    heard: 'Heard: {transcript}',
    typeInstead: 'Or type a command',
    send: 'Send',
    understood: 'Understood',
    confirm: 'Confirm',
    cancel: 'Cancel',
    which: 'Which one?',
    notFound: 'I did not find "{phrase}" in your stock.',
    createInstead: 'Create it?',
    notUnderstood: 'I did not understand that.',
    examplesTitle: 'Try one of these',
    unavailable: 'This device cannot transcribe speech offline, so the microphone is hidden. Typing works.',
    installable: 'A speech pack for this language can be installed on this device.',
    install: 'Install',
    quantityAnswer: '{name}: {quantity} {unit}, in {location}.',
    quantityAnswerNoLocation: '{name}: {quantity} {unit}.',
    expiringNone: 'Nothing expires in the next {days} days.',
    expiringSome_one: '{count} item expires within {days} days: {names}.',
    expiringSome_other: '{count} items expire within {days} days: {names}.',
    expiredNone: 'Nothing has expired.',
    missingNone: 'Nothing is missing.',
    missingSome_one: '{count} item is below its minimum: {names}.',
    missingSome_other: '{count} items are below their minimum: {names}.',
    whereItem: '{name} is in {location}.',
    whereItemUnplaced: '{name} has no location set.',
    whereLocationNone: 'There is nothing in {location}.',
    whereLocationSome_one: '{location} holds {count} item: {names}.',
    whereLocationSome_other: '{location} holds {count} items: {names}.',
    expiryOf: '{name} expires on {date}.',
    expiryOfNone: '{name} has no expiry date.',
    score: 'Your preparedness score is {score}.',
    settingEnabled: 'Voice control',
    settingSpeak: 'Read answers aloud',
    andMore: 'and {count} more',
  },
```

- [ ] **Step 2: Typecheck to see the other two fail**

Run: `npm run typecheck`
Expected: FAIL — `pt-BR.ts` and `es.ts` are missing the `voice` section.

- [ ] **Step 3: Translate**

Add the same keys to `pt-BR.ts` and `es.ts`. Portuguese, in full:

```ts
  voice: {
    title: 'Voz',
    button: 'Falar um comando',
    listening: 'Ouvindo…',
    heard: 'Ouvi: {transcript}',
    typeInstead: 'Ou digite um comando',
    send: 'Enviar',
    understood: 'Entendi',
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    which: 'Qual deles?',
    notFound: 'Não encontrei "{phrase}" no seu estoque.',
    createInstead: 'Quer criar?',
    notUnderstood: 'Não entendi.',
    examplesTitle: 'Tente um destes',
    unavailable: 'Este aparelho não transcreve voz sem internet, então o microfone está oculto. Digitar funciona.',
    installable: 'Um pacote de voz para este idioma pode ser instalado neste aparelho.',
    install: 'Instalar',
    quantityAnswer: '{name}: {quantity} {unit}, em {location}.',
    quantityAnswerNoLocation: '{name}: {quantity} {unit}.',
    expiringNone: 'Nada vence nos próximos {days} dias.',
    expiringSome_one: '{count} item vence em {days} dias: {names}.',
    expiringSome_other: '{count} itens vencem em {days} dias: {names}.',
    expiredNone: 'Nada venceu.',
    missingNone: 'Não falta nada.',
    missingSome_one: '{count} item está abaixo do mínimo: {names}.',
    missingSome_other: '{count} itens estão abaixo do mínimo: {names}.',
    whereItem: '{name} está em {location}.',
    whereItemUnplaced: '{name} não tem local definido.',
    whereLocationNone: 'Não há nada em {location}.',
    whereLocationSome_one: '{location} tem {count} item: {names}.',
    whereLocationSome_other: '{location} tem {count} itens: {names}.',
    expiryOf: '{name} vence em {date}.',
    expiryOfNone: '{name} não tem data de validade.',
    score: 'Sua pontuação de preparação é {score}.',
    settingEnabled: 'Controle por voz',
    settingSpeak: 'Ler respostas em voz alta',
    andMore: 'e mais {count}',
  },
```

Spanish follows the same shape.

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS. Task 11's `answer.test.ts` should now pass on real strings rather than placeholders — if it was passing on a stub, tighten it now.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/
git commit -m "Voice: translations, English first so the others are compile errors"
```

---

## Task 19: The voice sheet

**Files:**
- Create: `src/features/voice/VoiceSheet.tsx`, `VoiceButton.tsx`, `ConfirmCard.tsx`, `ChoiceList.tsx`, `Voice.module.css`
- Test: `src/features/voice/VoiceSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Use `@testing-library/react`, already a dependency. Drive the typed path — it needs no browser speech API, which makes it the honest thing to test.

```tsx
// src/features/voice/VoiceSheet.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceSheet } from './VoiceSheet';

// Render inside whatever provider the other feature tests use; copy the
// harness from an existing *.test.tsx in src/features/ rather than inventing one.

describe('VoiceSheet', () => {
  it('answers a typed question without writing anything', async () => {
    const user = userEvent.setup();
    render(<VoiceSheet open onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/digite um comando|type a command/i),
      'quanto arroz eu tenho');
    await user.click(screen.getByRole('button', { name: /enviar|send/i }));

    expect(await screen.findByText(/arroz/i)).toBeInTheDocument();
  });

  it('shows a confirmation card for a change and writes nothing until confirmed', async () => {
    const user = userEvent.setup();
    render(<VoiceSheet open onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/digite um comando|type a command/i),
      'adiciona 5 latas de feijao');
    await user.click(screen.getByRole('button', { name: /enviar|send/i }));

    expect(await screen.findByRole('button', { name: /confirmar|confirm/i }))
      .toBeInTheDocument();
    // The quantity on screen is still the old one until Confirmar is pressed.
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('shows what it heard when it did not understand', async () => {
    const user = userEvent.setup();
    render(<VoiceSheet open onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/digite um comando|type a command/i), 'aaa bbb');
    await user.click(screen.getByRole('button', { name: /enviar|send/i }));

    expect(await screen.findByText(/aaa bbb/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/voice/`
Expected: FAIL — `Cannot find module './VoiceSheet'`.

- [ ] **Step 3: Write the hook that holds the state machine**

Put the logic in a hook so the components stay presentational and the machine is testable on its own.

```ts
// src/features/voice/useVoice.ts
/**
 * The voice state machine.
 *
 *   idle → listening → thinking → (answer | pending | choice | notFound | unknown)
 *
 * A separate hook rather than state inside the sheet, because the transitions
 * are the part worth testing and a component that renders them is not.
 */
import { useCallback, useState } from 'react';
import { useAppContext } from '../../app/AppContext';
import { parse } from '../../voice/parse';
import { grammarFor } from '../../voice/grammar/registry';
import { execute, type Outcome, type VoiceDeps } from '../../services/voice/execute';
import { commit } from '../../services/voice/commit';
import { renderAnswer } from '../../services/voice/answer';
import type { InventoryItemView } from '../../types/domain';

export interface Exchange {
  readonly said: string;
  readonly outcome: Outcome;
  /** The spoken sentence, or null for an outcome that is not one. */
  readonly text: string | null;
}

export function useVoice(speak: (text: string, tag: string) => Promise<void>) {
  const { repositories, itemContext, settings, t, invalidate } = useAppContext();
  const [history, setHistory] = useState<readonly Exchange[]>([]);
  const [busy, setBusy] = useState(false);

  const grammar = grammarFor(settings.language);

  const deps: VoiceDeps = {
    items: repositories.items,
    locations: repositories.locations,
    context: itemContext,
    language: settings.language,
  };

  const run = useCallback(
    async (transcript: string) => {
      setBusy(true);
      try {
        const intent = parse(grammar, transcript, { today: itemContext.today });
        const outcome = await execute(deps, intent);

        // `execute` has no grammar, so the examples are filled in here.
        const withExamples: Outcome =
          outcome.kind === 'unknown'
            ? { ...outcome, examples: grammar.examples }
            : outcome.kind === 'answer' && outcome.answer.kind === 'HELP'
              ? { kind: 'answer', answer: { kind: 'HELP', examples: grammar.examples } }
              : outcome;

        const text =
          withExamples.kind === 'answer' ? renderAnswer(t, withExamples.answer) : null;

        setHistory((past) => [...past, { said: transcript, outcome: withExamples, text }]);
        if (text !== null) await speak(text, settings.language);
      } finally {
        setBusy(false);
      }
    },
    [deps, grammar, itemContext.today, settings.language, speak, t],
  );

  /** The confirmation card's button, and the only path that writes. */
  const confirm = useCallback(
    async (index: number) => {
      const entry = history[index];
      if (entry === undefined || entry.outcome.kind !== 'pending') return;
      await commit(deps, entry.outcome.write);
      // Every open list re-reads; the database stays the only source of truth.
      invalidate();
      setHistory((past) => past.filter((_, i) => i !== index));
    },
    [deps, history, invalidate],
  );

  /** Picking from "Qual deles?" re-runs the intent against an exact name. */
  const choose = useCallback(
    async (index: number, item: InventoryItemView) => {
      const entry = history[index];
      if (entry === undefined || entry.outcome.kind !== 'choice') return;
      const intent = entry.outcome.intent;
      if (!('item' in intent) || typeof intent.item !== 'string') return;
      const outcome = await execute(deps, { ...intent, item: item.name });
      const text = outcome.kind === 'answer' ? renderAnswer(t, outcome.answer) : null;
      setHistory((past) =>
        past.map((e, i) => (i === index ? { ...e, outcome, text } : e)),
      );
      if (text !== null) await speak(text, settings.language);
    },
    [deps, history, settings.language, speak, t],
  );

  const dismiss = useCallback((index: number) => {
    setHistory((past) => past.filter((_, i) => i !== index));
  }, []);

  return { history, busy, run, confirm, choose, dismiss, examples: grammar.examples };
}
```

- [ ] **Step 4: Build the components on top of it**

`VoiceSheet` renders `history` and a form; it holds no logic of its own.

```tsx
// src/features/voice/VoiceSheet.tsx (shape — style with a CSS module copied
// from an existing modal in src/features/, do not invent new sheet styling)
export function VoiceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, settings } = useAppContext();
  const speaker = useMemo(() => createSpeaker(() => settings.voiceSpeakAnswers), [
    settings.voiceSpeakAnswers,
  ]);
  const speakUnlessSilent = useCallback(
    async (text: string, tag: string) => {
      // The phone's own switch wins over the app's setting on Android; a
      // browser cannot read that state, so this resolves false there.
      if (await androidIsSilent()) return;
      await speaker.say(text, tag);
    },
    [speaker],
  );
  const voice = useVoice(speakUnlessSilent);
  const [typed, setTyped] = useState('');

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={t('voice.title')}>
      {voice.history.map((entry, index) => (
        <VoiceExchange
          key={index}
          entry={entry}
          onConfirm={() => void voice.confirm(index)}
          onChoose={(item) => void voice.choose(index, item)}
          onDismiss={() => voice.dismiss(index)}
        />
      ))}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = typed.trim();
          if (value === '') return;
          setTyped('');
          void voice.run(value);
        }}
      >
        <label htmlFor="voice-input">{t('voice.typeInstead')}</label>
        <input
          id="voice-input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={voice.busy}
        />
        <button type="submit" disabled={voice.busy}>{t('voice.send')}</button>
      </form>
    </div>
  );
}
```

`VoiceExchange` switches on `entry.outcome.kind` and renders one of:

- `answer` — `entry.text` as a paragraph.
- `pending` — `<ConfirmCard>`: item name, location, old value → new value, Confirmar and Cancelar. Give it `role="group"` with an `aria-labelledby` pointing at its heading, and move focus to Confirmar on mount. This feature exists for people not looking at the screen, so keyboard and screen-reader behaviour is the feature rather than a courtesy.
- `choice` — `<ChoiceList>`: `t('voice.which')` and a button per item, each labelled with the name and its quantity, so "o primeiro" has a visible referent.
- `notFound` — `t('voice.notFound', { phrase })`, plus a Create button when the intent was a writing one.
- `unknown` — `t('voice.notUnderstood')`, `t('voice.heard', { transcript })`, and `entry.outcome.examples` as a list.

`VoiceButton` renders nothing when `settings.voiceEnabled` is false. It calls `selectRecognizer(LOCALE_TAGS[settings.language])` once on mount; when that reports `unavailable` it still renders and opens the sheet straight to the typed box, showing `t('voice.unavailable')` once. When it reports `ready` it calls `listen`, then hands the transcript to `voice.run`.

**Use what the project already has.** Verified against the codebase:

- `src/components/ui/Dialog.tsx` is a modal built on the native `<dialog>` element. `showModal()` supplies focus trapping, Escape-to-close, inertness of the page behind, and correct screen-reader semantics — "all things a hand-rolled overlay gets subtly wrong", as its own header says — and on narrow screens it becomes a bottom sheet through CSS alone. `VoiceSheet` wraps `Dialog`; it does not reimplement one. Note `Dialog` requires a `closeLabel`.
- `Button` comes from `src/components/ui/primitives.tsx` and supports `variant="ghost"` and `iconOnly`, which is how the header's existing menu button is built.
- **There is no microphone icon.** Add `MicIcon` to `src/components/ui/icons.tsx` following the file's `svg(<path … />, props)` idiom; every icon there is inline SVG, because a webfont would be a network request.
- The header insertion point is the `headerActions` div in `src/app/Layout.tsx` (around line 157), before the language `<select>`.
- `useAppContext()` supplies `repositories` (`items`, `categories`, `locations`, `catalog`, `settings`), `settings`, `t`, `itemContext`, `updateSettings` and `invalidate`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/voice/`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/voice/
git commit -m "Voice: the sheet, the confirmation card, and the choice list"
```

---

## Task 20: Wire it into the shell and Settings

**Files:**
- Modify: `src/app/Layout.tsx:157` (the `headerActions` div)
- Modify: `src/features/settings/SettingsScreen.tsx`

- [ ] **Step 1: Add the button to the header**

Place `<VoiceButton />` inside `headerActions`, before the language select, so it sits first in the tab order among the header controls.

- [ ] **Step 2: Add the settings controls**

Two switches, following the pattern the other settings use: `voice.settingEnabled` and `voice.settingSpeak`. Under them, a diagnostics line reporting what `selectRecognizer(...).availability()` returns — ready, installable with an Install button, or unavailable with `t('voice.unavailable')`. Settings already tells the truth about storage; speech gets the same treatment.

- [ ] **Step 3: Run everything**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all PASS, including the offline audit.

- [ ] **Step 4: Drive it in a real browser**

```bash
npm run preview
```

Open the URL in Chrome and check, in order:

1. The microphone appears in the header.
2. Typing `quanto arroz eu tenho` answers, and the answer is spoken.
3. Typing `adiciona 5 latas de feijao` shows the card, and the inventory list behind it still shows the old number.
4. Confirmar changes it, and the list behind updates without a reload.
5. Turning `voiceSpeakAnswers` off silences the next answer.
6. `npm run smoke` still passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/Layout.tsx src/features/settings/SettingsScreen.tsx
git commit -m "Voice: a microphone in the header and two switches in Settings"
```

---

# Phase 5 — Documentation

## Task 21: Write it down

**Files:**
- Create: `docs/VOICE.md`
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/OFFLINE.md`, `docs/ANDROID.md`, `docs/TESTING.md`, `docs/CHANGELOG.md`

- [ ] **Step 1: Write `docs/VOICE.md`**

Cover, in this order: what you can say (the full phrase table per language), how a command becomes an action, why nothing is written before confirmation, how speech stays on the device on each platform, and what it will not do.

- [ ] **Step 2: Update the others**

- `ARCHITECTURE.md` — the speech seam beside the database seam, and the `voice/` (pure) and `services/voice/` (impure) split.
- `OFFLINE.md` — a section on speech: the three recognizers, `processLocally` failing closed, and the new audit rule.
- `ANDROID.md` — the plugin, and why the permission list stayed empty.
- `TESTING.md` — the phrase corpus, and the instruction that a phrase which fails in real use becomes a row before it becomes a fix.
- `CHANGELOG.md` — voice control as a feature the original never had.
- `README.md` — a Voice section, and these entries added to *What is not built yet*: no wake word or continuous listening, no voice on iPhone or Safari, no voice in the desktop build.

- [ ] **Step 3: Check the README's claims are still true**

Run: `grep -n "no permission\|asks the operating system\|makes no network" README.md docs/*.md`

Every sentence that survives must still be accurate. The zero-permission claim is still true; make sure nothing now overclaims about iPhone.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run smoke
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md
git commit -m "Document voice control, including what it will not do"
```

---

## Definition of done

- [ ] `npm test` passes, with the phrase corpus among the new tests and the original 402 untouched
- [ ] `npm run build` passes, including the offline audit with its new rule
- [ ] `npm run smoke` passes
- [ ] The Android APK builds and `aapt2 dump permissions` prints no foreign permission
- [ ] Every phrase in the spec's intent table is a row in the corpus
- [ ] `README.md` claims nothing the build does not check
