# Backup Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show when the user last made a backup, warn when a backup is overdue and data has changed since, offer a one-tap "Back up now", and stop backup files from carrying the Anthropic API key.

**Architecture:** One new setting (`lastBackupAt`) in the existing `settings` table, stamped into each backup file so a restore stays truthful, and kept at the newer value on import. A pure function decides the reminder state; a small repository supplies the two dates it needs; one shared export function serves both the dashboard and Settings. Spec: `docs/superpowers/specs/2026-11-07-backup-reminder-design.md`.

**Tech Stack:** TypeScript (strict), React 19, zod 4, SQLite (wasm) behind `SqlDriver`, vitest + Testing Library + happy-dom, ESLint `recommendedTypeChecked`.

**Conventions that apply to every task**

- Run every command from the project root: `C:\Users\danil\Desktop\Dad's games\Endoftheworld` (or `...\Stock Guardian\source` once the folder has been moved).
- Source files use **LF** line endings. New files: LF.
- **Do not commit, tag or push.** The owner asks for that separately. Each task ends with a **Checkpoint** (tests green), not a commit.
- `eslint` runs type-aware: `JSON.parse(...)` results must be cast to a named shape before member access; template literals may hold numbers but not nullish values; promises must be awaited or prefixed with `void`.
- Test files that render React start with `// @vitest-environment happy-dom`. Database tests use the in-memory driver exactly as `src/repositories/repositories.test.ts` does.
- Run one test file with: `npx vitest run <path>`. Whole suite: `npm test`. Types: `npx tsc --noEmit`. Lint: `npx eslint .`.

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/domain/settings.ts` | modify | 3 new settings keys; `DEVICE_ONLY_SETTING_KEYS`, `isDeviceOnlySettingKey` |
| `src/domain/backup-settings.test.ts` | create | tests for the above |
| `src/domain/backup-reminder.ts` | create | pure decision function and date helpers |
| `src/domain/backup-reminder.test.ts` | create | tests for the above |
| `src/i18n/relative-time.ts` | create | `formatDaysAgo(language, days)` |
| `src/i18n/relative-time.test.ts` | create | tests |
| `src/repositories/backup.repository.ts` | create | `dataSpan()` |
| `src/repositories/backup.repository.test.ts` | create | tests |
| `src/services/backup/export.service.ts` | modify | `stampLastBackupAt` option; skip device-only keys |
| `src/services/backup/backup-stamp.test.ts` | create | tests |
| `src/services/backup/import.service.ts` | modify | keep-the-newer rule; skip device-only keys |
| `src/services/backup/backup-import-settings.test.ts` | create | tests |
| `src/services/backup/run-export.ts` | create | `exportBackupToDevice` |
| `src/services/backup/run-export.test.ts` | create | tests |
| `src/i18n/locales/{en,pt-BR,es}.ts` | modify | 13 new `backup.*` keys each |
| `src/app/bootstrap.ts` | modify | expose `repositories.backup` |
| `src/features/phrasebook/PhrasebookScreen.test.tsx`, `src/features/voice/VoiceSheet.test.tsx` | modify | add `backup` to the repositories they build |
| `src/test/app-harness.tsx` | create | `renderWithApp` for the two new component tests |
| `src/features/dashboard/BackupReminder.tsx` + `.test.tsx` | create | the line, the banner, the button |
| `src/features/settings/BackupReminderSettings.tsx` + `.test.tsx` | create | status, switch, day choice, advice |
| `src/features/settings/BackupPanel.tsx` | modify | use the shared export; render the settings block |
| `src/features/dashboard/DashboardScreen.tsx` | modify | render `<BackupReminder />` |
| `README.md`, `docs/CHANGELOG.md` | modify | document both changes |

---

### Task 1: Settings keys and the device-only list

**Files:**
- Modify: `src/domain/settings.ts` (end of `settingsSchema`, and after `SETTINGS_KEYS`)
- Create: `src/domain/backup-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/backup-settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEVICE_ONLY_SETTING_KEYS,
  isDeviceOnlySettingKey,
  parseSettings,
} from './settings';

describe('backup settings', () => {
  it('defaults to no backup yet, the reminder on, and a 30 day window', () => {
    expect(DEFAULT_SETTINGS.lastBackupAt).toBeNull();
    expect(DEFAULT_SETTINGS.backupReminderEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.backupReminderDays).toBe(30);
  });

  it('keeps a valid lastBackupAt', () => {
    const { settings, invalidKeys } = parseSettings([
      { key: 'lastBackupAt', value: JSON.stringify('2026-11-07T12:00:00.000Z') },
    ]);
    expect(settings.lastBackupAt).toBe('2026-11-07T12:00:00.000Z');
    expect(invalidKeys).toEqual([]);
  });

  it('falls back to null for a damaged lastBackupAt without losing other settings', () => {
    const { settings, invalidKeys } = parseSettings([
      { key: 'lastBackupAt', value: JSON.stringify('not a date') },
      { key: 'language', value: JSON.stringify('es') },
    ]);
    expect(settings.lastBackupAt).toBeNull();
    expect(settings.language).toBe('es');
    expect(invalidKeys).toContain('lastBackupAt');
  });

  it('rejects a reminder window outside 1 to 365 days', () => {
    for (const bad of [0, -3, 400, 7.5]) {
      const { settings, invalidKeys } = parseSettings([
        { key: 'backupReminderDays', value: JSON.stringify(bad) },
      ]);
      expect(settings.backupReminderDays).toBe(30);
      expect(invalidKeys).toContain('backupReminderDays');
    }
  });

  it('names the Anthropic key, and only secrets like it, as device-only', () => {
    expect(DEVICE_ONLY_SETTING_KEYS).toContain('anthropicApiKey');
    expect(isDeviceOnlySettingKey('anthropicApiKey')).toBe(true);
    expect(isDeviceOnlySettingKey('aiEnabled')).toBe(false);
    expect(isDeviceOnlySettingKey('language')).toBe(false);
    expect(isDeviceOnlySettingKey('lastBackupAt')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/domain/backup-settings.test.ts`
Expected: FAIL (the file imports `DEVICE_ONLY_SETTING_KEYS` and `isDeviceOnlySettingKey`, which do not exist yet).

- [ ] **Step 3: Add the three keys to the schema**

In `src/domain/settings.ts`, replace

```ts
  replenishmentDismissed: z.array(z.string()).default([]),
});
```

with

```ts
  replenishmentDismissed: z.array(z.string()).default([]),

  /**
   * When the last backup file was made, as an ISO-8601 instant. Null until the
   * first one.
   *
   * It records that an export was STARTED, which is all the web side can know:
   * on Android the native shell writes the file to Downloads and reports nothing
   * back. Every export stamps this into the file it produces, so a backup
   * restored onto a new device says, truthfully, when that data was saved. On
   * import the newer of the stored and the incoming value wins - see
   * `applyImport` - so restoring an old file can never move it backwards.
   *
   * An unparseable value is dropped by `parseSettings` and reads as "no backup
   * yet", like any other setting.
   */
  lastBackupAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'not a date')
    .nullable()
    .default(null),

  /**
   * Whether the dashboard shows the backup line and, when one is overdue, the
   * warning. On: a passive line is the behaviour somebody would choose anyway,
   * and nothing here interrupts anybody.
   */
  backupReminderEnabled: z.boolean().default(true),

  /** How many days old a backup may be before, and only if data has changed since, it is flagged. */
  backupReminderDays: z.number().int().min(1).max(365).default(30),
});
```

- [ ] **Step 4: Add the device-only list**

In `src/domain/settings.ts`, directly after the line

```ts
export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];
```

add

```ts
/**
 * Settings that belong to THIS device and never travel in a backup.
 *
 * A backup is a file the user is encouraged to copy to a USB stick or to cloud
 * storage, and until this list existed it contained the Anthropic API key in
 * plain text. Export skips these keys; import ignores them, so even a file made
 * by an older version cannot overwrite the key the receiving device already has.
 */
export const DEVICE_ONLY_SETTING_KEYS = ['anthropicApiKey'] as const satisfies readonly SettingsKey[];

export function isDeviceOnlySettingKey(key: string): boolean {
  return (DEVICE_ONLY_SETTING_KEYS as readonly string[]).includes(key);
}
```

- [ ] **Step 5: Run the new test and the existing settings and seed tests**

Run: `npx vitest run src/domain/backup-settings.test.ts src/domain/settings.test.ts src/database/seed/seed.test.ts`
Expected: PASS. (`seed.test.ts` asserts the seeded settings equal `DEFAULT_SETTINGS`; seeding writes every default, so the new keys are covered.)

- [ ] **Step 6: Checkpoint**

Run: `npx tsc --noEmit`
Expected: no output.

---

### Task 2: The pure reminder logic

**Files:**
- Create: `src/domain/backup-reminder.ts`
- Create: `src/domain/backup-reminder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/backup-reminder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  evaluateBackupReminder,
  newerInstant,
  parseInstant,
  parseStoredInstant,
  reminderDayChoices,
  wholeDaysBetween,
  type BackupReminderInput,
} from './backup-reminder';

const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

const base: BackupReminderInput = {
  enabled: true,
  thresholdDays: 30,
  nowMs: NOW,
  lastBackupAt: null,
  earliestDataAt: ago(5),
  latestChangeAt: ago(1),
  hasData: true,
};

describe('wholeDaysBetween', () => {
  it('counts whole elapsed days and never goes negative', () => {
    expect(wholeDaysBetween(NOW - 36 * 3_600_000, NOW)).toBe(1);
    expect(wholeDaysBetween(NOW - 12 * 3_600_000, NOW)).toBe(0);
    expect(wholeDaysBetween(NOW + 5 * DAY_MS, NOW)).toBe(0);
  });
});

describe('parseInstant and parseStoredInstant', () => {
  it('reads an ISO instant and refuses anything else', () => {
    expect(parseInstant('2026-11-07T12:00:00.000Z')).toBe(NOW);
    expect(parseInstant('garbage')).toBeNull();
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
  });

  it('reads a JSON-encoded stored value', () => {
    expect(parseStoredInstant('"2026-11-07T12:00:00.000Z"')).toBe('2026-11-07T12:00:00.000Z');
    expect(parseStoredInstant('null')).toBeNull();
    expect(parseStoredInstant('"garbage"')).toBeNull();
    expect(parseStoredInstant('{broken')).toBeNull();
    expect(parseStoredInstant(undefined)).toBeNull();
  });
});

describe('newerInstant', () => {
  const a = '2026-09-01T00:00:00.000Z';
  const b = '2026-11-01T00:00:00.000Z';

  it('returns the later of two valid instants', () => {
    expect(newerInstant(a, b)).toBe(b);
    expect(newerInstant(b, a)).toBe(b);
  });

  it('returns the first when they are equal', () => {
    expect(newerInstant(a, a)).toBe(a);
  });

  it('returns the one valid value, or null when there is none', () => {
    expect(newerInstant(null, b)).toBe(b);
    expect(newerInstant(a, undefined)).toBe(a);
    expect(newerInstant('garbage', b)).toBe(b);
    expect(newerInstant(null, null)).toBeNull();
    expect(newerInstant('garbage', 'also garbage')).toBeNull();
  });
});

describe('reminderDayChoices', () => {
  it('offers 7, 14, 30, 60 and 90', () => {
    expect(reminderDayChoices(30)).toEqual([7, 14, 30, 60, 90]);
  });

  it('keeps a stored value that is not in the list, in order', () => {
    expect(reminderDayChoices(45)).toEqual([7, 14, 30, 45, 60, 90]);
    expect(reminderDayChoices(365)).toEqual([7, 14, 30, 60, 90, 365]);
  });
});

describe('evaluateBackupReminder', () => {
  it('is off when the reminder is switched off', () => {
    expect(evaluateBackupReminder({ ...base, enabled: false })).toEqual({ kind: 'off' });
  });

  it('is off when there is no data to protect', () => {
    expect(evaluateBackupReminder({ ...base, hasData: false })).toEqual({ kind: 'off' });
  });

  describe('never backed up', () => {
    it('says "never" while the data is young', () => {
      expect(evaluateBackupReminder({ ...base, earliestDataAt: ago(29) })).toEqual({ kind: 'never' });
    });

    it('becomes due on the threshold day, measured from the oldest data', () => {
      expect(evaluateBackupReminder({ ...base, earliestDataAt: ago(30) })).toEqual({
        kind: 'due',
        days: 30,
        never: true,
      });
    });

    it('treats an unparseable lastBackupAt as never', () => {
      expect(
        evaluateBackupReminder({ ...base, lastBackupAt: 'garbage', earliestDataAt: ago(40) }),
      ).toEqual({ kind: 'due', days: 40, never: true });
    });

    it('says "never" when no data date is known', () => {
      expect(evaluateBackupReminder({ ...base, earliestDataAt: null })).toEqual({ kind: 'never' });
    });
  });

  describe('backed up before', () => {
    it('is recent while the backup is younger than the threshold', () => {
      expect(
        evaluateBackupReminder({ ...base, lastBackupAt: ago(29), latestChangeAt: ago(1) }),
      ).toEqual({ kind: 'recent', days: 29 });
    });

    it('is due on the threshold day when something changed since', () => {
      expect(
        evaluateBackupReminder({ ...base, lastBackupAt: ago(30), latestChangeAt: ago(2) }),
      ).toEqual({ kind: 'due', days: 30, never: false });
    });

    it('stays quiet about an old backup of data that has not changed', () => {
      expect(
        evaluateBackupReminder({ ...base, lastBackupAt: ago(90), latestChangeAt: ago(100) }),
      ).toEqual({ kind: 'recent', days: 90 });
    });

    it('does not count a change made at the very instant of the backup', () => {
      expect(
        evaluateBackupReminder({ ...base, lastBackupAt: ago(40), latestChangeAt: ago(40) }),
      ).toEqual({ kind: 'recent', days: 40 });
    });

    it('is recent when no change date is known', () => {
      expect(
        evaluateBackupReminder({ ...base, lastBackupAt: ago(60), latestChangeAt: null }),
      ).toEqual({ kind: 'recent', days: 60 });
    });

    it('honours a shorter threshold', () => {
      expect(
        evaluateBackupReminder({
          ...base,
          thresholdDays: 7,
          lastBackupAt: ago(8),
          latestChangeAt: ago(1),
        }),
      ).toEqual({ kind: 'due', days: 8, never: false });
    });

    it('treats a backup dated in the future (a clock set backwards) as age zero', () => {
      const future = new Date(NOW + 5 * DAY_MS).toISOString();
      expect(
        evaluateBackupReminder({ ...base, lastBackupAt: future, latestChangeAt: ago(1) }),
      ).toEqual({ kind: 'recent', days: 0 });
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/domain/backup-reminder.test.ts`
Expected: FAIL (module `./backup-reminder` not found).

- [ ] **Step 3: Write the implementation**

Create `src/domain/backup-reminder.ts`:

```ts
/**
 * When to remind somebody to back up.
 *
 * Pure: no clock, no database, no interface. Everything it needs comes in as an
 * argument, so every state and every boundary is testable without a browser.
 *
 * The rule, and why each half is there:
 *
 *   due  = the reference is at least `thresholdDays` old
 *          AND (there has never been a backup OR something changed after it)
 *
 * The reference is the last backup, or - when there has never been one - the
 * oldest data, so somebody who installed yesterday is not nagged. The "changed
 * since" half is why a person who has not touched their stock for three months
 * is left alone: an old backup of unchanged data is not a risk. The quiet line
 * still says how old it is.
 */

export const DAY_MS = 86_400_000;

/** What Settings offers. A stored value outside this list is kept and shown. */
export const REMINDER_DAY_CHOICES = [7, 14, 30, 60, 90] as const;

export interface BackupReminderInput {
  readonly enabled: boolean;
  readonly thresholdDays: number;
  /** Milliseconds since the epoch. Passed in, never read from a clock here. */
  readonly nowMs: number;
  readonly lastBackupAt: string | null;
  /** Oldest `created_at` across items, locations and contacts. */
  readonly earliestDataAt: string | null;
  /** Newest `updated_at` across the same three tables. */
  readonly latestChangeAt: string | null;
  /** False means the inventory is empty, the same test the dashboard uses. */
  readonly hasData: boolean;
}

export type BackupReminderStatus =
  | { readonly kind: 'off' }
  | { readonly kind: 'never' }
  | { readonly kind: 'recent'; readonly days: number }
  | { readonly kind: 'due'; readonly days: number; readonly never: boolean };

/** Milliseconds for an ISO-8601 instant, or null when it is missing or unparseable. */
export function parseInstant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** The instant inside a stored settings value (`"2026-..."` as JSON), or null. */
export function parseStoredInstant(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' && parseInstant(value) !== null ? value : null;
  } catch {
    return null;
  }
}

function validInstant(value: string | null | undefined): string | null {
  return parseInstant(value) === null ? null : (value ?? null);
}

/** The later of two instants. One valid value wins over an invalid one; a tie returns the first. */
export function newerInstant(
  first: string | null | undefined,
  second: string | null | undefined,
): string | null {
  const a = validInstant(first);
  const b = validInstant(second);
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Whole elapsed days, never negative. */
export function wholeDaysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

/** The day choices to offer, with a stored value outside the list kept in order. */
export function reminderDayChoices(current: number): readonly number[] {
  const base: readonly number[] = REMINDER_DAY_CHOICES;
  return base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
}

export function evaluateBackupReminder(input: BackupReminderInput): BackupReminderStatus {
  if (!input.enabled || !input.hasData) return { kind: 'off' };

  const last = parseInstant(input.lastBackupAt);
  const earliest = parseInstant(input.earliestDataAt);
  const latestChange = parseInstant(input.latestChangeAt);

  const reference = last ?? earliest;
  const days = reference === null ? 0 : wholeDaysBetween(reference, input.nowMs);
  const changedSince = last === null || (latestChange !== null && latestChange > last);

  if (reference !== null && days >= input.thresholdDays && changedSince) {
    return { kind: 'due', days, never: last === null };
  }
  return last === null ? { kind: 'never' } : { kind: 'recent', days };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/domain/backup-reminder.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `npx tsc --noEmit && npx eslint src/domain`
Expected: no output.

---

### Task 3: "N days ago" in three languages

**Files:**
- Create: `src/i18n/relative-time.ts`
- Create: `src/i18n/relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/i18n/relative-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDaysAgo } from './relative-time';

describe('formatDaysAgo', () => {
  it.each([
    ['en', 0, 'today'],
    ['en', 1, 'yesterday'],
    ['en', 12, '12 days ago'],
    ['pt-BR', 0, 'hoje'],
    ['pt-BR', 1, 'ontem'],
    ['pt-BR', 12, 'há 12 dias'],
    ['es', 0, 'hoy'],
    ['es', 1, 'ayer'],
    ['es', 12, 'hace 12 días'],
  ] as const)('%s, %i days -> "%s"', (language, days, expected) => {
    expect(formatDaysAgo(language, days)).toBe(expected);
  });

  it('never goes into the future', () => {
    expect(formatDaysAgo('en', -3)).toBe('today');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/i18n/relative-time.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/i18n/relative-time.ts`:

```ts
/**
 * "today", "yesterday", "12 days ago" - in the interface language.
 *
 * `Intl.RelativeTimeFormat` ships with the browser, so there is no plural table
 * to maintain and all three languages come with it. Sentences take the result as
 * a `{when}` placeholder: "Last backup: {when}".
 */
import type { Language } from '../domain/settings';
import { LOCALE_TAGS } from './translate';

export function formatDaysAgo(language: Language, days: number): string {
  const whole = Math.max(0, Math.round(days));
  return new Intl.RelativeTimeFormat(LOCALE_TAGS[language], { numeric: 'auto' }).format(
    -whole,
    'day',
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/i18n/relative-time.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `npx tsc --noEmit`
Expected: no output.

---

### Task 4: The data-span repository

**Files:**
- Create: `src/repositories/backup.repository.ts`
- Create: `src/repositories/backup.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/repositories/backup.repository.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../database/driver/memory.driver';
import type { SqlDriver } from '../database/driver/types';
import { migrate } from '../database/migrations/runner';
import { seedDatabase } from '../database/seed/seed';
import { createBackupRepository } from './backup.repository';
import { createContactsRepository } from './contacts.repository';
import { createItemsRepository } from './items.repository';
import { createLocationsRepository } from './locations.repository';

describe('backup repository', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('reports no dates for an empty database', async () => {
    expect(await createBackupRepository(db).dataSpan()).toEqual({
      earliestAt: null,
      latestChangeAt: null,
    });
  });

  it('spans the items', async () => {
    await createItemsRepository(db).create({ name: 'Rice', quantity: 3 });
    await db.exec('UPDATE items SET created_at = ?, updated_at = ?', [
      '2026-01-02T00:00:00.000Z',
      '2026-03-04T00:00:00.000Z',
    ]);

    expect(await createBackupRepository(db).dataSpan()).toEqual({
      earliestAt: '2026-01-02T00:00:00.000Z',
      latestChangeAt: '2026-03-04T00:00:00.000Z',
    });
  });

  it('takes the earliest creation and the latest change across items, locations and contacts', async () => {
    await createItemsRepository(db).create({ name: 'Rice', quantity: 3 });
    await createLocationsRepository(db).create({ name: 'Pantry' });
    await createContactsRepository(db).create({ name: 'Ana' });

    await db.exec('UPDATE items SET created_at = ?, updated_at = ?', [
      '2026-02-01T00:00:00.000Z',
      '2026-02-10T00:00:00.000Z',
    ]);
    await db.exec('UPDATE locations SET created_at = ?, updated_at = ?', [
      '2026-02-05T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ]);
    await db.exec('UPDATE contacts SET created_at = ?, updated_at = ?', [
      '2026-01-15T00:00:00.000Z',
      '2026-01-20T00:00:00.000Z',
    ]);

    expect(await createBackupRepository(db).dataSpan()).toEqual({
      earliestAt: '2026-01-15T00:00:00.000Z',
      latestChangeAt: '2026-06-01T00:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/repositories/backup.repository.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/repositories/backup.repository.ts`:

```ts
/**
 * What the backup reminder needs to know about the data.
 *
 * Two dates across the three tables a person edits: when the oldest record was
 * made, and when anything was last changed. A quantity change updates its item,
 * so it counts. Settings are not included: changing the language is not a
 * reason to warn that a backup is stale.
 */
import type { SqlDriver, SqlRow } from '../database/driver/types';

export interface DataSpan {
  /** Smallest `created_at`, or null when there is no data. */
  readonly earliestAt: string | null;
  /** Largest `updated_at`, or null when there is no data. */
  readonly latestChangeAt: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function createBackupRepository(db: SqlDriver) {
  return {
    async dataSpan(): Promise<DataSpan> {
      const row = await db.selectOne<SqlRow>(
        `SELECT MIN(created_at) AS earliest, MAX(updated_at) AS latest FROM (
           SELECT created_at, updated_at FROM items
           UNION ALL SELECT created_at, updated_at FROM locations
           UNION ALL SELECT created_at, updated_at FROM contacts
         )`,
      );
      return { earliestAt: text(row?.earliest), latestChangeAt: text(row?.latest) };
    },
  };
}

export type BackupRepository = ReturnType<typeof createBackupRepository>;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/repositories/backup.repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint**

Run: `npx tsc --noEmit && npx eslint src/repositories`
Expected: no output.

---

### Task 5: Export stamps the file and leaves the key out

**Files:**
- Modify: `src/services/backup/export.service.ts`
- Create: `src/services/backup/backup-stamp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/backup/backup-stamp.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { serializeBackup } from './export.service';
import { inspectBackup } from './import.service';

interface BackupShape {
  readonly data: { readonly settings: Record<string, unknown> };
}

describe('backup stamping and device-only settings', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  it('records the stamp in the file, and the file still verifies', async () => {
    const stamp = '2026-11-07T12:00:00.000Z';
    const json = await serializeBackup(db, { stampLastBackupAt: stamp });

    expect((JSON.parse(json) as BackupShape).data.settings.lastBackupAt).toBe(stamp);

    const preview = await inspectBackup(json, db);
    expect(preview.ok).toBe(true);
    expect(preview.checksumValid).toBe(true);
  });

  it('writes nothing of its own when no stamp is given', async () => {
    const parsed = JSON.parse(await serializeBackup(db, {})) as BackupShape;
    expect(parsed.data.settings.lastBackupAt ?? null).toBeNull();
  });

  it('leaves the Anthropic key out of the file but keeps the other AI setting', async () => {
    await createSettingsRepository(db).save({
      anthropicApiKey: 'sk-ant-test-key-do-not-ship',
      aiEnabled: true,
    });

    const json = await serializeBackup(db, {});
    const parsed = JSON.parse(json) as BackupShape;

    expect(parsed.data.settings).not.toHaveProperty('anthropicApiKey');
    expect(parsed.data.settings.aiEnabled).toBe(true);
    expect(json).not.toContain('sk-ant-test-key-do-not-ship');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/services/backup/backup-stamp.test.ts`
Expected: FAIL (`stampLastBackupAt` is not an option yet, and the key is still exported).

- [ ] **Step 3: Implement it**

In `src/services/backup/export.service.ts`:

(a) Replace `import { nowInstant } from '../../domain/dates';` with

```ts
import { nowInstant } from '../../domain/dates';
import { isDeviceOnlySettingKey } from '../../domain/settings';
```

(b) Replace

```ts
export interface ExportOptions {
  /** Movement history can dwarf the inventory itself; opt in when needed. */
  readonly includeTransactions?: boolean;
}
```

with

```ts
export interface ExportOptions {
  /** Movement history can dwarf the inventory itself; opt in when needed. */
  readonly includeTransactions?: boolean;
  /**
   * When given, the file records this instant as its own `lastBackupAt`.
   *
   * Applied before the data is assembled, so the checksum - which covers `data` -
   * verifies. A backup restored onto a new device then says, truthfully, when
   * that data was saved.
   */
  readonly stampLastBackupAt?: string;
}
```

(c) Replace

```ts
  const settings: Record<string, unknown> = {};
  for (const row of settingRows) {
    try {
```

with

```ts
  const settings: Record<string, unknown> = {};
  for (const row of settingRows) {
    // Device-only settings (the API key) never leave the device in a backup.
    if (isDeviceOnlySettingKey(String(row.key))) continue;
    try {
```

(d) Replace

```ts
  const data: BackupData = {
    items: itemRows.map((row) => ({
```

with

```ts
  if (options.stampLastBackupAt !== undefined) {
    settings.lastBackupAt = options.stampLastBackupAt;
  }

  const data: BackupData = {
    items: itemRows.map((row) => ({
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/services/backup/backup-stamp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint: the existing backup tests still pass**

Run: `npx vitest run src/services/backup`
Expected: PASS (existing `backup.test.ts` and `fixtures.test.ts` unchanged and green).

---

### Task 6: Import keeps the newer time and ignores the key

**Files:**
- Modify: `src/services/backup/import.service.ts`
- Create: `src/services/backup/backup-import-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/backup/backup-import-settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { serializeBackup } from './export.service';
import { checksumOf } from './format';
import { applyImport, inspectBackup, type ImportMode } from './import.service';

const SEP = '2026-09-01T00:00:00.000Z';
const NOV = '2026-11-01T00:00:00.000Z';

async function freshDb(): Promise<SqlDriver> {
  const db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
  return db;
}

/** Inspects `json` against `target`, applies it, and fails loudly if it was refused. */
async function importInto(target: SqlDriver, json: string, mode: ImportMode): Promise<void> {
  const preview = await inspectBackup(json, target);
  if (!preview.ok || preview.payload === null) {
    throw new Error(`the file was refused: ${JSON.stringify(preview.problems)}`);
  }
  await applyImport(target, preview.payload, mode);
}

describe('importing settings from a backup', () => {
  let source: SqlDriver;
  let target: SqlDriver;

  beforeEach(async () => {
    source = await freshDb();
    target = await freshDb();
  });

  afterEach(async () => {
    await source.close().catch(() => undefined);
    await target.close().catch(() => undefined);
  });

  describe.each(['merge', 'replace'] as const)('%s mode', (mode) => {
    const lastBackupAfter = async (): Promise<string | null> =>
      (await createSettingsRepository(target).load()).settings.lastBackupAt;

    it('does not move lastBackupAt backwards', async () => {
      await createSettingsRepository(target).save({ lastBackupAt: NOV });
      await createSettingsRepository(source).save({ lastBackupAt: SEP });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(NOV);
    });

    it('moves lastBackupAt forwards', async () => {
      await createSettingsRepository(target).save({ lastBackupAt: SEP });
      await createSettingsRepository(source).save({ lastBackupAt: NOV });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(NOV);
    });

    it('sets lastBackupAt when the device had none', async () => {
      await createSettingsRepository(source).save({ lastBackupAt: SEP });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(SEP);
    });

    it('leaves lastBackupAt alone when the file has none', async () => {
      await createSettingsRepository(target).save({ lastBackupAt: NOV });

      await importInto(target, await serializeBackup(source, {}), mode);

      expect(await lastBackupAfter()).toBe(NOV);
    });

    it('never overwrites this device\'s Anthropic key, even from an older file that holds one', async () => {
      await createSettingsRepository(target).save({ anthropicApiKey: 'keep-me', aiEnabled: false });

      // Craft a file as an older version would have written it: a key inside, and a
      // checksum that matches, so the import is accepted and the key must be ignored.
      const doc = JSON.parse(await serializeBackup(source, {})) as {
        checksum: string;
        data: { settings: Record<string, unknown> };
      };
      doc.data.settings.anthropicApiKey = 'attacker-key';
      doc.data.settings.aiEnabled = true;
      doc.checksum = await checksumOf(doc.data);

      await importInto(target, JSON.stringify(doc), mode);

      const { settings } = await createSettingsRepository(target).load();
      expect(settings.anthropicApiKey).toBe('keep-me');
      expect(settings.aiEnabled).toBe(true);
    });

    it('does not create a key on a device that has none', async () => {
      const doc = JSON.parse(await serializeBackup(source, {})) as {
        checksum: string;
        data: { settings: Record<string, unknown> };
      };
      doc.data.settings.anthropicApiKey = 'attacker-key';
      doc.checksum = await checksumOf(doc.data);

      await importInto(target, JSON.stringify(doc), mode);

      expect((await createSettingsRepository(target).load()).settings.anthropicApiKey).toBe('');
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/services/backup/backup-import-settings.test.ts`
Expected: FAIL (the old-backup case moves `lastBackupAt` backwards and the key is overwritten).

- [ ] **Step 3: Add the imports**

In `src/services/backup/import.service.ts`, replace

```ts
import { foldText } from '../../domain/normalize';
```

with

```ts
import { foldText } from '../../domain/normalize';
import { newerInstant, parseStoredInstant } from '../../domain/backup-reminder';
import { isDeviceOnlySettingKey } from '../../domain/settings';
```

- [ ] **Step 4: Replace the settings loop**

In `src/services/backup/import.service.ts`, replace

```ts
    // ---- settings ----------------------------------------------------------
    let settingsApplied = 0;
    for (const [key, value] of Object.entries(data.settings)) {
      await tx.exec(
        `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :now)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        { key, value: JSON.stringify(value), now },
      );
      settingsApplied += 1;
    }
```

with

```ts
    // ---- settings ----------------------------------------------------------
    let settingsApplied = 0;
    for (const [key, value] of Object.entries(data.settings)) {
      // Device-only settings (the API key) are never restored. A file written by
      // an older version can still contain one; it must not overwrite the key
      // this device already has, nor plant one that was never entered here.
      if (isDeviceOnlySettingKey(key)) continue;

      let stored: unknown = value;
      if (key === 'lastBackupAt') {
        // Importing an old file must never move "last backup" backwards. Keep the
        // later of the stored and the incoming instant, in both modes.
        const rows = await tx.select<{ value: string }>(
          'SELECT value FROM settings WHERE key = :key',
          { key },
        );
        const existing = parseStoredInstant(rows[0]?.value);
        const incoming = typeof value === 'string' ? value : null;
        const winner = newerInstant(existing, incoming);
        if (winner === null || winner === existing) continue;
        stored = winner;
      }

      await tx.exec(
        `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :now)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        { key, value: JSON.stringify(stored), now },
      );
      settingsApplied += 1;
    }
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/services/backup/backup-import-settings.test.ts`
Expected: PASS (12 tests: 6 cases times 2 modes).

- [ ] **Step 6: Checkpoint**

Run: `npx vitest run src/services/backup && npx tsc --noEmit`
Expected: PASS, no type errors.

---

### Task 7: One shared way to make a backup

**Files:**
- Create: `src/services/backup/run-export.ts`
- Create: `src/services/backup/run-export.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/backup/run-export.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import type { Settings } from '../../domain/settings';
import { exportBackupToDevice } from './run-export';

interface BackupShape {
  readonly data: { readonly settings: Record<string, unknown> };
}

describe('exportBackupToDevice', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  const now = new Date(2026, 10, 7, 12, 0, 0); // 7 November 2026, local time

  it('saves the file, then records when, and returns both', async () => {
    const log: string[] = [];
    const saved: { filename: string; contents: string; mime: string }[] = [];
    const patches: Partial<Settings>[] = [];

    const result = await exportBackupToDevice({
      db,
      includeTransactions: false,
      now,
      save: (filename, contents, mime) => {
        log.push('save');
        saved.push({ filename, contents, mime });
      },
      updateSettings: (patch) => {
        log.push('record');
        patches.push(patch);
        return Promise.resolve();
      },
    });

    expect(log).toEqual(['save', 'record']);
    expect(result.filename).toBe('stock-guardian-backup-2026-11-07.json');
    expect(result.stampedAt).toBe(now.toISOString());
    expect(saved).toHaveLength(1);
    expect(saved[0]?.filename).toBe(result.filename);
    expect(saved[0]?.mime).toBe('application/json');
    expect(patches).toEqual([{ lastBackupAt: result.stampedAt }]);
  });

  it('stamps the file with the same instant it records', async () => {
    let contents = '';
    const result = await exportBackupToDevice({
      db,
      includeTransactions: false,
      now,
      save: (_filename, text) => {
        contents = text;
      },
      updateSettings: () => Promise.resolve(),
    });

    expect((JSON.parse(contents) as BackupShape).data.settings.lastBackupAt).toBe(result.stampedAt);
  });

  it('records nothing when the file cannot be saved', async () => {
    const patches: Partial<Settings>[] = [];

    await expect(
      exportBackupToDevice({
        db,
        includeTransactions: false,
        now,
        save: () => {
          throw new Error('disk full');
        },
        updateSettings: (patch) => {
          patches.push(patch);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('disk full');

    expect(patches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/services/backup/run-export.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/services/backup/run-export.ts`:

```ts
/**
 * Making a backup file, the one way.
 *
 * Settings and the dashboard both offer "back up now". Both call this, so they
 * cannot drift apart: same stamp, same file name, same order of operations.
 *
 * The order is the point:
 *
 *   1. choose one instant;
 *   2. build the file with that instant stamped inside it;
 *   3. hand the file to the device;
 *   4. only then record the instant.
 *
 * If building or saving fails, nothing is recorded, so the reminder never claims
 * a backup that was not made. If recording fails after the file was handed over,
 * the file exists and the error reaches the caller, who can press the button
 * again. On Android step 3 only STARTS the save (the native shell writes to
 * Downloads and reports nothing back), which is why every sentence in the
 * interface says "last backup" and never "you are safe".
 */
import type { SqlDriver } from '../../database/driver/types';
import { nowInstant } from '../../domain/dates';
import type { Settings } from '../../domain/settings';
import { downloadText } from '../download';
import { backupFilename, serializeBackup } from './export.service';

export interface ExportToDeviceArgs {
  readonly db: SqlDriver;
  readonly updateSettings: (patch: Partial<Settings>) => Promise<void>;
  readonly includeTransactions: boolean;
  /** Replaceable so tests need no browser. Defaults to the real download. */
  readonly save?: (filename: string, contents: string, mime: string) => void;
  /** Replaceable so tests are deterministic. Defaults to the current time. */
  readonly now?: Date;
}

export interface ExportToDeviceResult {
  readonly filename: string;
  readonly stampedAt: string;
}

export async function exportBackupToDevice(
  args: ExportToDeviceArgs,
): Promise<ExportToDeviceResult> {
  const now = args.now ?? new Date();
  const stampedAt = nowInstant(now);
  const filename = backupFilename(now);

  const json = await serializeBackup(args.db, {
    includeTransactions: args.includeTransactions,
    stampLastBackupAt: stampedAt,
  });

  (args.save ?? downloadText)(filename, json, 'application/json');
  await args.updateSettings({ lastBackupAt: stampedAt });

  return { filename, stampedAt };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/services/backup/run-export.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint**

Run: `npx tsc --noEmit && npx eslint src/services/backup`
Expected: no output.

---

### Task 8: The words, in three languages

**Files:**
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/pt-BR.ts`, `src/i18n/locales/es.ts`

The existing test `src/i18n/i18n.test.ts` fails if any language lacks a key English has, so it is the test for this task.

- [ ] **Step 1: Add the English keys, and watch the translation test fail**

In `src/i18n/locales/en.ts`, replace

```ts
    exported: 'Backup saved as {filename}',
```

with

```ts
    exported: 'Backup saved as {filename}',
    reminderStatus: 'Last backup: {when}',
    reminderNever: 'No backup yet',
    backUpNow: 'Back up now',
    backingUp: 'Backing up…',
    overdueTitle: 'Your last backup was {when}',
    overdueTitleNever: 'You have never made a backup',
    overdueBody: 'Changes made since then exist only on this device.',
    overdueBodyNever: 'Everything you have entered exists only on this device.',
    reminderSwitch: 'Remind me to back up',
    reminderAfter: 'Remind me after',
    reminderDaysOption: '{count} days',
    reminderAdvice: 'A backup protects you once the file is somewhere other than this device.',
    keyNotIncluded:
      'Your Anthropic key is never included in a backup. After restoring on another device, enter it again in Settings.',
```

Run: `npx vitest run src/i18n/i18n.test.ts`
Expected: FAIL for `pt-BR` and `es` (13 missing keys each).

- [ ] **Step 2: Add the Portuguese keys**

In `src/i18n/locales/pt-BR.ts`, replace

```ts
    exported: 'Backup salvo como {filename}',
```

with

```ts
    exported: 'Backup salvo como {filename}',
    reminderStatus: 'Último backup: {when}',
    reminderNever: 'Nenhum backup ainda',
    backUpNow: 'Fazer backup agora',
    backingUp: 'Fazendo backup…',
    overdueTitle: 'Seu último backup foi {when}',
    overdueTitleNever: 'Você nunca fez um backup',
    overdueBody: 'As alterações feitas desde então existem apenas neste aparelho.',
    overdueBodyNever: 'Tudo o que você cadastrou existe apenas neste aparelho.',
    reminderSwitch: 'Lembrar-me de fazer backup',
    reminderAfter: 'Lembrar-me após',
    reminderDaysOption: '{count} dias',
    reminderAdvice:
      'Um backup só protege você quando o arquivo está em algum lugar além deste aparelho.',
    keyNotIncluded:
      'Sua chave da Anthropic nunca é incluída em um backup. Depois de restaurar em outro aparelho, digite-a novamente em Configurações.',
```

- [ ] **Step 3: Add the Spanish keys**

In `src/i18n/locales/es.ts`, replace

```ts
    exported: 'Copia guardada como {filename}',
```

with

```ts
    exported: 'Copia guardada como {filename}',
    reminderStatus: 'Última copia: {when}',
    reminderNever: 'Aún no hay copia de seguridad',
    backUpNow: 'Hacer copia ahora',
    backingUp: 'Haciendo copia…',
    overdueTitle: 'Tu última copia de seguridad fue {when}',
    overdueTitleNever: 'Nunca has hecho una copia de seguridad',
    overdueBody: 'Los cambios hechos desde entonces solo existen en este dispositivo.',
    overdueBodyNever: 'Todo lo que has anotado solo existe en este dispositivo.',
    reminderSwitch: 'Recordarme hacer copias de seguridad',
    reminderAfter: 'Recordarme después de',
    reminderDaysOption: '{count} días',
    reminderAdvice:
      'Una copia solo te protege cuando el archivo está en algún sitio distinto de este dispositivo.',
    keyNotIncluded:
      'Tu clave de Anthropic nunca se incluye en una copia. Después de restaurar en otro dispositivo, vuelve a introducirla en Ajustes.',
```

- [ ] **Step 4: Run the translation test and confirm it passes**

Run: `npx vitest run src/i18n`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `npx tsc --noEmit`
Expected: no output.

---

### Task 9: Wire the repository into start-up

**Files:**
- Modify: `src/app/bootstrap.ts`
- Modify: `src/features/phrasebook/PhrasebookScreen.test.tsx`
- Modify: `src/features/voice/VoiceSheet.test.tsx`

Adding `backup` to the `Repositories` type makes the two existing tests that build one by hand fail the type check, so they are updated in the same task.

- [ ] **Step 1: Confirm the type check is currently clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Add the repository to start-up**

In `src/app/bootstrap.ts`:

(a) Replace

```ts
import { createSettingsRepository } from '../repositories/settings.repository';
import type { Settings } from '../domain/settings';
```

with

```ts
import { createSettingsRepository } from '../repositories/settings.repository';
import { createBackupRepository } from '../repositories/backup.repository';
import type { Settings } from '../domain/settings';
```

(b) Replace

```ts
  readonly settings: ReturnType<typeof createSettingsRepository>;
}
```

with

```ts
  readonly settings: ReturnType<typeof createSettingsRepository>;
  readonly backup: ReturnType<typeof createBackupRepository>;
}
```

(c) Replace

```ts
    settings: createSettingsRepository(db),
  };
}
```

with

```ts
    settings: createSettingsRepository(db),
    backup: createBackupRepository(db),
  };
}
```

- [ ] **Step 3: Run the type check and watch it fail in the two tests**

Run: `npx tsc --noEmit`
Expected: errors in `PhrasebookScreen.test.tsx` and `VoiceSheet.test.tsx`: property `backup` is missing in type.

- [ ] **Step 4: Update both tests**

In **each** of `src/features/phrasebook/PhrasebookScreen.test.tsx` and `src/features/voice/VoiceSheet.test.tsx`:

(a) Replace the import line

```ts
import { createSettingsRepository } from '../../repositories/settings.repository';
```

with

```ts
import { createSettingsRepository } from '../../repositories/settings.repository';
import { createBackupRepository } from '../../repositories/backup.repository';
```

(b) Replace

```ts
      contacts: createContactsRepository(db),
      settings: createSettingsRepository(db),
```

with

```ts
      contacts: createContactsRepository(db),
      settings: createSettingsRepository(db),
      backup: createBackupRepository(db),
```

- [ ] **Step 5: Run the type check and the two tests**

Run: `npx tsc --noEmit && npx vitest run src/features/phrasebook src/features/voice`
Expected: no type errors; tests PASS.

---

### Task 10: The dashboard reminder

**Files:**
- Create: `src/test/app-harness.tsx`
- Create: `src/features/dashboard/BackupReminder.tsx`
- Create: `src/features/dashboard/BackupReminder.test.tsx`

- [ ] **Step 1: Create the shared test harness**

Create `src/test/app-harness.tsx`:

```tsx
/**
 * Renders a component inside the real application context, over a database made
 * for the test. The same arrangement `VoiceSheet.test.tsx` and
 * `PhrasebookScreen.test.tsx` build by hand, once, for the tests that follow.
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AppProvider } from '../app/AppContext';
import type { AppContext } from '../app/bootstrap';
import type { SqlDriver } from '../database/driver/types';
import type { DatabaseDiagnostics } from '../database/worker/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings';
import { createBackupRepository } from '../repositories/backup.repository';
import { createCatalogRepository } from '../repositories/catalog.repository';
import { createCategoriesRepository } from '../repositories/categories.repository';
import { createContactsRepository } from '../repositories/contacts.repository';
import { createItemsRepository } from '../repositories/items.repository';
import { createLocationsRepository } from '../repositories/locations.repository';
import { createSettingsRepository } from '../repositories/settings.repository';

const DIAGNOSTICS: DatabaseDiagnostics = {
  sqliteVersion: 'test',
  vfsName: 'memory',
  journalMode: 'memory',
  foreignKeys: true,
  integrity: 'ok',
  poolCapacity: 0,
  poolFileCount: 0,
  pageCount: 0,
  pageSize: 4096,
};

/** `overrides` apply to the settings the interface starts with, not to the database rows. */
export function renderWithApp(
  ui: ReactElement,
  db: SqlDriver,
  overrides: Partial<Settings> = {},
) {
  const startup: AppContext = {
    db,
    repositories: {
      items: createItemsRepository(db),
      categories: createCategoriesRepository(db),
      locations: createLocationsRepository(db),
      catalog: createCatalogRepository(db),
      contacts: createContactsRepository(db),
      settings: createSettingsRepository(db),
      backup: createBackupRepository(db),
    },
    diagnostics: DIAGNOSTICS,
    settings: { ...DEFAULT_SETTINGS, language: 'en', ...overrides },
    invalidSettingKeys: [],
    quarantine: () => Promise.resolve('unused'),
    refreshDiagnostics: () => Promise.resolve(DIAGNOSTICS),
  };

  return render(<AppProvider startup={startup}>{ui}</AppProvider>);
}
```

- [ ] **Step 2: Write the failing component test**

Create `src/features/dashboard/BackupReminder.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createItemsRepository } from '../../repositories/items.repository';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { downloadText } from '../../services/download';
import type * as DownloadModule from '../../services/download';
import { renderWithApp } from '../../test/app-harness';
import { BackupReminder } from './BackupReminder';

vi.mock('../../services/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadModule>();
  return { ...actual, downloadText: vi.fn() };
});

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

let db: SqlDriver;

async function addItem(): Promise<void> {
  await createItemsRepository(db).create({ name: 'Rice', quantity: 3 });
}

/** Back-dates every item, so the data looks as old as the test needs. */
async function dateItems(createdAt: string, updatedAt: string): Promise<void> {
  await db.exec('UPDATE items SET created_at = ?, updated_at = ?', [createdAt, updatedAt]);
}

beforeEach(async () => {
  db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
  vi.mocked(downloadText).mockReset();
});

afterEach(async () => {
  cleanup();
  await db.close().catch(() => undefined);
});

describe('BackupReminder', () => {
  it('shows nothing when the reminder is switched off', async () => {
    await addItem();
    await dateItems(ago(60), ago(60));
    renderWithApp(<BackupReminder />, db, { backupReminderEnabled: false });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.queryByText(/backup/i)).toBeNull();
  });

  it('says "No backup yet" for young data that was never backed up, with no warning', async () => {
    await addItem();
    renderWithApp(<BackupReminder />, db);

    expect(await screen.findByText('No backup yet')).toBeTruthy();
    expect(screen.queryByText('You have never made a backup')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeTruthy();
  });

  it('warns when nothing was ever backed up and the data is old', async () => {
    await addItem();
    await dateItems(ago(40), ago(40));
    renderWithApp(<BackupReminder />, db);

    expect(await screen.findByText('You have never made a backup')).toBeTruthy();
    expect(screen.getByText('Everything you have entered exists only on this device.')).toBeTruthy();
  });

  it('shows a quiet line, not a warning, for an old backup of data that has not changed', async () => {
    await addItem();
    await dateItems(ago(100), ago(100));
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(90) });

    expect(await screen.findByText('Last backup: 90 days ago')).toBeTruthy();
    expect(screen.queryByText(/Changes made since then/)).toBeNull();
  });

  it('warns when there are changes after an old backup', async () => {
    await addItem();
    await dateItems(ago(60), ago(2));
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(41) });

    expect(await screen.findByText('Your last backup was 41 days ago')).toBeTruthy();
    expect(screen.getByText('Changes made since then exist only on this device.')).toBeTruthy();
  });

  it('"Back up now" saves a file, records it, and turns the warning into the quiet line', async () => {
    await addItem();
    await dateItems(ago(60), ago(2));
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(41) });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));

    expect(await screen.findByText('Last backup: today')).toBeTruthy();
    expect(screen.queryByText(/Changes made since then/)).toBeNull();

    expect(downloadText).toHaveBeenCalledTimes(1);
    const [filename, contents, mime] = vi.mocked(downloadText).mock.calls[0] ?? [];
    expect(filename).toMatch(/^stock-guardian-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe('application/json');

    const stamped = (JSON.parse(String(contents)) as { data: { settings: Record<string, unknown> } })
      .data.settings.lastBackupAt;
    expect(typeof stamped).toBe('string');

    const recorded = (await createSettingsRepository(db).load()).settings.lastBackupAt;
    expect(recorded).toBe(stamped);

    expect(screen.getByText(/^Backup saved as stock-guardian-backup-/)).toBeTruthy();
  });

  it('shows the error and records nothing when the backup fails', async () => {
    await addItem();
    await dateItems(ago(60), ago(2));
    vi.mocked(downloadText).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    renderWithApp(<BackupReminder />, db, { lastBackupAt: ago(41) });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));

    expect(await screen.findByText('disk full')).toBeTruthy();
    expect((await createSettingsRepository(db).load()).settings.lastBackupAt).toBeNull();
    expect(screen.getByText('Your last backup was 41 days ago')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/features/dashboard/BackupReminder.test.tsx`
Expected: FAIL (module `./BackupReminder` not found).

- [ ] **Step 4: Write the component**

Create `src/features/dashboard/BackupReminder.tsx`:

```tsx
/**
 * The backup line, and the warning it becomes when a backup is overdue.
 *
 * Quiet by default: one line saying when you last made a backup, with a button.
 * Only when the rule in `evaluateBackupReminder` says "due" does it turn into a
 * warning. It is rendered by the dashboard only when the inventory is not empty.
 *
 * It uses the `warning` tone and the default `status` role, not `alert`: a
 * persistent banner is not urgent and must not be announced on every render.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Alert, Button } from '../../components/ui/primitives';
import { evaluateBackupReminder } from '../../domain/backup-reminder';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatDaysAgo } from '../../i18n/relative-time';
import { exportBackupToDevice } from '../../services/backup/run-export';

export function BackupReminder() {
  const { t, db, repositories, settings, revision, updateSettings } = useApp();

  const span = useAsyncData(
    () => repositories.backup.dataSpan(),
    [repositories.backup, revision],
  );

  const [busy, setBusy] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Now" is read once, when the dashboard is shown - a lazy initialiser, because
  // the clock is impure and a render must not call it. The dashboard is mounted
  // afresh every time somebody navigates to it, which is when its age matters.
  const [nowMs] = useState(() => Date.now());

  if (!settings.backupReminderEnabled || span.data === undefined) return null;

  const status = evaluateBackupReminder({
    enabled: settings.backupReminderEnabled,
    thresholdDays: settings.backupReminderDays,
    nowMs,
    lastBackupAt: settings.lastBackupAt,
    earliestDataAt: span.data.earliestAt,
    latestChangeAt: span.data.latestChangeAt,
    // The dashboard renders this only for a non-empty inventory.
    hasData: true,
  });
  if (status.kind === 'off') return null;

  const backUp = async () => {
    setBusy(true);
    setError(null);
    try {
      const { filename } = await exportBackupToDevice({
        db,
        updateSettings,
        includeTransactions: false,
      });
      setSavedAs(filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const days = status.kind === 'recent' || status.kind === 'due' ? status.days : 0;
  const showsAge = status.kind === 'recent' || (status.kind === 'due' && !status.never);
  const when = showsAge ? formatDaysAgo(settings.language, days) : '';

  const button = (
    <Button
      size="small"
      variant={status.kind === 'due' ? 'primary' : 'secondary'}
      disabled={busy}
      onClick={() => {
        void backUp();
      }}
    >
      {busy ? t('backup.backingUp') : t('backup.backUpNow')}
    </Button>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      {status.kind === 'due' ? (
        <Alert
          tone="warning"
          title={status.never ? t('backup.overdueTitleNever') : t('backup.overdueTitle', { when })}
        >
          <p>{status.never ? t('backup.overdueBodyNever') : t('backup.overdueBody')}</p>
          <div style={{ marginTop: 'var(--space-3)' }}>{button}</div>
        </Alert>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <span>
            {status.kind === 'recent'
              ? t('backup.reminderStatus', { when })
              : t('backup.reminderNever')}
          </span>
          {button}
        </div>
      )}

      {savedAs !== null && (
        <p role="status" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          {t('backup.exported', { filename: savedAs })}
        </p>
      )}
      {error !== null && (
        <Alert tone="critical" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/features/dashboard/BackupReminder.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Checkpoint**

Run: `npx tsc --noEmit && npx eslint src/features/dashboard src/test`
Expected: no output.

---

### Task 11: Settings controls, and BackupPanel uses the shared export

**Files:**
- Create: `src/features/settings/BackupReminderSettings.tsx`
- Create: `src/features/settings/BackupReminderSettings.test.tsx`
- Modify: `src/features/settings/BackupPanel.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/features/settings/BackupReminderSettings.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryDriver } from '../../database/driver/memory.driver';
import type { SqlDriver } from '../../database/driver/types';
import { migrate } from '../../database/migrations/runner';
import { seedDatabase } from '../../database/seed/seed';
import { createSettingsRepository } from '../../repositories/settings.repository';
import { renderWithApp } from '../../test/app-harness';
import { BackupReminderSettings } from './BackupReminderSettings';

let db: SqlDriver;

beforeEach(async () => {
  db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
});

afterEach(async () => {
  cleanup();
  await db.close().catch(() => undefined);
});

const stored = async () => (await createSettingsRepository(db).load()).settings;

describe('BackupReminderSettings', () => {
  it('says there is no backup yet when there has not been one', () => {
    renderWithApp(<BackupReminderSettings />, db);
    expect(screen.getByText('No backup yet')).toBeTruthy();
  });

  it('says how long ago the last backup was', () => {
    const twelveDaysAgo = new Date(Date.now() - 12 * 86_400_000).toISOString();
    renderWithApp(<BackupReminderSettings />, db, { lastBackupAt: twelveDaysAgo });
    expect(screen.getByText('Last backup: 12 days ago')).toBeTruthy();
  });

  it('starts with the reminder on and 30 days chosen', () => {
    renderWithApp(<BackupReminderSettings />, db);
    expect((screen.getByLabelText('Remind me to back up') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Remind me after') as HTMLSelectElement).value).toBe('30');
  });

  it('switching the reminder off is saved and disables the day choice', async () => {
    renderWithApp(<BackupReminderSettings />, db);

    await userEvent.setup().click(screen.getByLabelText('Remind me to back up'));

    await waitFor(async () => {
      expect((await stored()).backupReminderEnabled).toBe(false);
    });
    // The interface updates after the write resolves, so wait for it as well.
    await waitFor(() => {
      expect((screen.getByLabelText('Remind me after') as HTMLSelectElement).disabled).toBe(true);
    });
  });

  it('choosing 60 days is saved', async () => {
    renderWithApp(<BackupReminderSettings />, db);

    await userEvent.setup().selectOptions(screen.getByLabelText('Remind me after'), '60');

    await waitFor(async () => {
      expect((await stored()).backupReminderDays).toBe(60);
    });
  });

  it('keeps a stored value that is not one of the offered choices', () => {
    renderWithApp(<BackupReminderSettings />, db, { backupReminderDays: 45 });
    expect(screen.getByRole('option', { name: '45 days' })).toBeTruthy();
    expect((screen.getByLabelText('Remind me after') as HTMLSelectElement).value).toBe('45');
  });

  it('gives the advice and says the key is never in a backup', () => {
    renderWithApp(<BackupReminderSettings />, db);
    expect(screen.getByText(/somewhere other than this device/)).toBeTruthy();
    expect(screen.getByText(/Your Anthropic key is never included in a backup/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/features/settings/BackupReminderSettings.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the component**

Create `src/features/settings/BackupReminderSettings.tsx`:

```tsx
/**
 * Backup status and reminder controls, inside the Backup card in Settings.
 *
 * The status line is shown whether or not the reminder is on: Settings is where
 * somebody goes to ask "when did I last do this". The switch only governs the
 * dashboard.
 */
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { SelectField, SwitchRow } from '../../components/ui/Field';
import { parseInstant, reminderDayChoices, wholeDaysBetween } from '../../domain/backup-reminder';
import { formatDaysAgo } from '../../i18n/relative-time';

export function BackupReminderSettings() {
  const { t, settings, updateSettings } = useApp();

  // Read once, when the panel is shown: a lazy initialiser, because a render must
  // not call the clock itself.
  const [nowMs] = useState(() => Date.now());

  const lastMs = parseInstant(settings.lastBackupAt);
  const status =
    lastMs === null
      ? t('backup.reminderNever')
      : t('backup.reminderStatus', {
          when: formatDaysAgo(settings.language, wholeDaysBetween(lastMs, nowMs)),
        });

  const muted = { color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' } as const;

  return (
    <div style={{ marginTop: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
      <p role="status">{status}</p>

      <SwitchRow
        label={t('backup.reminderSwitch')}
        checked={settings.backupReminderEnabled}
        onChange={(checked) => {
          void updateSettings({ backupReminderEnabled: checked });
        }}
      />

      <SelectField
        label={t('backup.reminderAfter')}
        value={String(settings.backupReminderDays)}
        disabled={!settings.backupReminderEnabled}
        onChange={(event) => {
          void updateSettings({ backupReminderDays: Number(event.target.value) });
        }}
      >
        {reminderDayChoices(settings.backupReminderDays).map((days) => (
          <option key={days} value={String(days)}>
            {t('backup.reminderDaysOption', { count: days })}
          </option>
        ))}
      </SelectField>

      <p style={muted}>{t('backup.reminderAdvice')}</p>
      <p style={muted}>{t('backup.keyNotIncluded')}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/features/settings/BackupReminderSettings.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Point BackupPanel at the shared export and render the new block**

In `src/features/settings/BackupPanel.tsx`:

(a) Replace

```ts
import { backupFilename, serializeBackup } from '../../services/backup/export.service';
```

with

```ts
import { exportBackupToDevice } from '../../services/backup/run-export';
```

(b) Replace

```ts
import { formatCalendarDate } from '../../domain/dates';
```

with

```ts
import { formatCalendarDate } from '../../domain/dates';
import { BackupReminderSettings } from './BackupReminderSettings';
```

(c) Replace

```ts
  const { t, db, repositories, itemContext, settings, invalidate } = useApp();
```

with

```ts
  const { t, db, repositories, itemContext, settings, invalidate, updateSettings } = useApp();
```

(d) Replace the whole `exportJson` function

```ts
  const exportJson = async () => {
    setBusy('export');
    setError(null);
    try {
      const json = await serializeBackup(db, { includeTransactions: includeHistory });
      const filename = backupFilename();
      downloadText(filename, json, 'application/json');
      setMessage(t('backup.exported', { filename }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
```

with

```ts
  const exportJson = async () => {
    setBusy('export');
    setError(null);
    try {
      const { filename } = await exportBackupToDevice({
        db,
        updateSettings,
        includeTransactions: includeHistory,
      });
      setMessage(t('backup.exported', { filename }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
```

(e) Replace

```tsx
          <Button onClick={() => void exportCsv()} disabled={busy !== null}>
            {busy === 'csv' ? t('common.loading') : t('backup.exportCsv')}
          </Button>
        </div>
      </Card>
```

with

```tsx
          <Button onClick={() => void exportCsv()} disabled={busy !== null}>
            {busy === 'csv' ? t('common.loading') : t('backup.exportCsv')}
          </Button>
        </div>
        <BackupReminderSettings />
      </Card>
```

- [ ] **Step 6: Checkpoint**

Run: `npx tsc --noEmit && npx eslint src/features/settings`
Expected: no output. (`downloadText` is still imported in `BackupPanel` and still used by the CSV export.)

---

### Task 12: Put the reminder on the dashboard

**Files:**
- Modify: `src/features/dashboard/DashboardScreen.tsx`

- [ ] **Step 1: Add the import**

In `src/features/dashboard/DashboardScreen.tsx`, replace

```ts
import { PREPAREDNESS_PRIORITY_WEIGHTS } from '../../domain/preparedness';
```

with

```ts
import { PREPAREDNESS_PRIORITY_WEIGHTS } from '../../domain/preparedness';
import { BackupReminder } from './BackupReminder';
```

- [ ] **Step 2: Render it between the header and the stat grid**

Replace

```tsx
      </header>

      <section className={screens.statGrid} aria-label={t('dashboard.inventoryOverview')}>
```

with

```tsx
      </header>

      <BackupReminder />

      <section className={screens.statGrid} aria-label={t('dashboard.inventoryOverview')}>
```

(That `</header>` is the one in the non-empty dashboard; the empty-inventory branch above it has none of this text after it, so the replacement is unique and the reminder never appears on the empty screen.)

- [ ] **Step 3: Checkpoint**

Run: `npx tsc --noEmit && npx eslint src && npm test`
Expected: no type or lint output; all tests PASS.

---

### Task 13: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: README**

In `README.md`, replace

```
Nothing is written until you have seen what the file contains and chosen merge or
replace.
```

with

```
Nothing is written until you have seen what the file contains and chosen merge or
replace.

**A reminder to back up.** The dashboard says when you last made a backup. When
one is overdue (30 days by default, 7 to 90 in Settings → Backup, or switched off)
and something has changed since, that line becomes a warning with a **Back up now**
button. Only a JSON export counts; the CSV cannot be restored. The application
knows an export was *started*, not that the file was kept: on Android it cannot see
whether the file reached Downloads. A backup protects you once the file is
somewhere other than this device.

**Your Anthropic key is never in a backup.** After restoring on another device,
enter it again in Settings. Backups made by versions before this one **do** contain
the key in plain text; if you stored or shared one, replace the key.
```

- [ ] **Step 2: CHANGELOG**

In `docs/CHANGELOG.md`, replace

```
# Changelog

## 2.8.0
```

with

```
# Changelog

## Unreleased

### A reminder to back up

Everything lives in a database on the device and nothing syncs, so the only
protection is an exported file - and nothing told anyone when they last made one.

The dashboard now carries one line: *Last backup: 12 days ago*, with **Back up
now**. When a backup is overdue and something has changed since, it becomes a
warning. "Overdue" is 30 days by default, 7 to 90 in **Settings → Backup**, and the
reminder can be switched off. An old backup of data that has not changed is not
flagged, and somebody who installed yesterday is not nagged.

The date is one new setting, stamped into every backup file so a backup restored
onto a new phone says when that data was saved. Importing never moves it backwards.
Only the JSON export counts. On Android the application can only know the export was
started, so the words say "last backup" and never "you are safe".

### The API key is no longer in backups

A backup file contained the Anthropic API key in plain text, and importing a file
overwrote the receiving device's key. The key is now left out of every export and
ignored on every import, in merge and replace alike. After restoring on another
device, enter it again.

**If you stored or shared a backup made by version 2.8.0 or earlier, it contains
your key. Replace the key.**

## 2.8.0
```

- [ ] **Step 3: Checkpoint**

Run: `git diff --stat -- README.md docs/CHANGELOG.md`
Expected: both files changed, insertions only.

---

### Task 14: Verify everything, and measure it in a real browser

**Files:**
- Create (outside the repository, in `$env:TEMP\sg-measure\`): `measure-reminder.mjs` and `time-dataspan.mjs`

- [ ] **Step 1: The project's own checks**

Run, in order:

```
npx tsc --noEmit
npx eslint .
npm test
npm run build
```

Expected: `tsc` and `eslint` print nothing; `npm test` ends with all test files and tests passed and `0 failed`; `npm run build` ends with `audit-offline: PASSED`.

- [ ] **Step 2: The smoke test, then stop the server it leaves behind**

Run: `npm run smoke`
Expected: ends with `smoke: 18 passed, 0 failed`.

`scripts/smoke.mjs` leaves a `vite preview` process on port 4173 on Windows. Stop it:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vite' -and $_.CommandLine -match 'preview' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

- [ ] **Step 3: Write the measuring script**

Create the folder `$env:TEMP\sg-measure` and, in it, `measure-reminder.mjs` (not in the repository):

```js
// Measures the backup reminder in a real browser, at phone and desktop width.
// Usage: node measure-reminder.mjs <projectRoot> <demoBackup.json> <outDir>
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const [, , rootArg, demoArg, outArg] = process.argv;
const ROOT = resolve(rootArg), DEMO = resolve(demoArg), OUT = resolve(outArg);
mkdirSync(OUT, { recursive: true });
const require = createRequire(join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const { createServer } = require('vite');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. A copy of the demo household whose items are 40 days old, with a valid checksum.
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { checksumOf } = await vite.ssrLoadModule('/src/services/backup/format.ts');
await vite.close();
const doc = JSON.parse(readFileSync(DEMO, 'utf8'));
const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
for (const item of doc.data.items) { item.createdAt = old; item.updatedAt = old; }
delete doc.data.settings.lastBackupAt;
doc.checksum = await checksumOf(doc.data);
const OLD_DEMO = join(OUT, 'old-demo.json');
writeFileSync(OLD_DEMO, JSON.stringify(doc));

// 2. Serve the production build.
const PORT = 4190, BASE = `http://localhost:${PORT}`;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
const stop = () => { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill(); };
for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(250); }

const SIZES = {
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const [size, opts] of Object.entries(SIZES)) {
    console.log(`\n== ${size} ==`);
    const ctx = await browser.newContext({ ...opts, locale: 'en-US', acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
    await page.setInputFiles('input[type=file]', OLD_DEMO);
    const merge = page.getByRole('button', { name: /^merge$/i });
    await merge.waitFor(); await merge.click(); await merge.waitFor({ state: 'detached' });
    await sleep(3000); // a reload right after a bulk import can show an empty first screen
    await page.goto(`${BASE}/#/`); await page.waitForSelector('h1'); await sleep(1500);

    const vw = opts.viewport.width;
    const within = (b) => b !== null && b.x >= 0 && b.x + b.width <= vw + 0.5;
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    // A. Never backed up, data 40 days old: the warning.
    const banner = page.locator('[role=status]').filter({ hasText: 'You have never made a backup' });
    check(`${size}: warning shown for old data never backed up`, (await banner.count()) === 1);
    check(`${size}: warning fits the screen width`, within(await banner.boundingBox()));
    check(`${size}: page does not scroll sideways`, await noOverflow());
    await page.screenshot({ path: join(OUT, `${size}-1-warning.png`) });

    // B. Back up now: a real download, stamped, and the warning becomes the quiet line.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Back up now' }).click(),
    ]);
    const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
    check(`${size}: file is named like a backup`, /^stock-guardian-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
    check(`${size}: file carries its own lastBackupAt`, typeof file.data.settings.lastBackupAt === 'string', String(file.data.settings.lastBackupAt));
    check(`${size}: file holds no Anthropic key`, !('anthropicApiKey' in file.data.settings));
    await page.getByText('Last backup: today').waitFor({ timeout: 10000 });
    check(`${size}: quiet line reads "Last backup: today"`, true);
    check(`${size}: warning is gone`, (await banner.count()) === 0);
    check(`${size}: quiet line fits the screen width`, within(await page.getByText('Last backup: today').boundingBox()));
    await page.screenshot({ path: join(OUT, `${size}-2-after-backup.png`) });

    // C. It survives a reload (after the write has settled).
    await sleep(3000);
    await page.reload(); await page.waitForSelector('h1'); await sleep(2000);
    check(`${size}: still "Last backup: today" after a reload`, (await page.getByText('Last backup: today').count()) === 1);

    // D. Settings: the controls, then switching the reminder off hides the dashboard line.
    await page.goto(`${BASE}/#/settings`); await sleep(1200);
    const sw = page.getByLabel('Remind me to back up');
    check(`${size}: Settings has the switch, on`, await sw.isChecked());
    check(`${size}: Settings has the day choice, 30`, (await page.getByLabel('Remind me after').inputValue()) === '30');
    check(`${size}: Settings says the key is never in a backup`, (await page.getByText(/Anthropic key is never included/).count()) === 1);
    await page.screenshot({ path: join(OUT, `${size}-3-settings.png`) });
    await sw.uncheck(); await sleep(600);
    await page.goto(`${BASE}/#/`); await sleep(1200);
    check(`${size}: switched off, the dashboard shows no backup line`, (await page.getByText(/Last backup:|No backup yet|never made a backup/).count()) === 0);

    check(`${size}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' ; '));
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
```

- [ ] **Step 4: Run it**

Build first if you changed anything since Step 1 (`npm run build`), then run it from the project root. The demo backup is the one in the Itch kit:

```powershell
node "$env:TEMP\sg-measure\measure-reminder.mjs" . "C:\Users\danil\Desktop\Stock Guardian\itch kit\tools\demo-backup-en.json" "$env:TEMP\sg-measure\shots"
```

Expected: every line `PASS`, ending `N passed, 0 failed`, and six screenshots in the `shots` folder. Open `phone-1-warning.png` and `desktop-1-warning.png` and look at them: the check proves the box fits the width, not that it looks right.

- [ ] **Step 5: Time the new query on a heavy stock**

The spec promised a timing on 1,500 items. Create `$env:TEMP\sg-measure\time-dataspan.mjs`:

```js
// Times dataSpan() on a 1,500-item stock, on the in-memory driver (so it measures the
// query, not OPFS). Run from the project root: node time-dataspan.mjs .
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(process.argv[2]);
const { createServer } = createRequire(join(ROOT, 'package.json'))('vite');
const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const { createMemoryDriver } = await load('/src/database/driver/memory.driver.ts');
  const { migrate } = await load('/src/database/migrations/runner.ts');
  const { seedDatabase } = await load('/src/database/seed/seed.ts');
  const { createItemsRepository } = await load('/src/repositories/items.repository.ts');
  const { createBackupRepository } = await load('/src/repositories/backup.repository.ts');

  const db = await createMemoryDriver();
  await migrate(db);
  await seedDatabase(db);
  const items = createItemsRepository(db);
  for (let i = 0; i < 1500; i++) await items.create({ name: `Item ${String(i)}`, quantity: 1 });

  const repo = createBackupRepository(db);
  const times = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    await repo.dataSpan();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`dataSpan on 1500 items: median ${times[12].toFixed(2)} ms, worst ${times[24].toFixed(2)} ms`);
} finally {
  await server.close();
}
```

Run: `node "$env:TEMP\sg-measure\time-dataspan.mjs" .`
Expected: a line such as `dataSpan on 1500 items: median 1.xx ms, worst 3.xx ms`. Anything above about 50 ms median means the query needs an index and the plan should stop here.

- [ ] **Step 6: Confirm nothing is left running and nothing was committed**

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 4173 -and $_.LocalPort -le 4190 }
```

Expected: no output.

Run: `git status --short`
Expected: modified and new files for this feature only (plus the earlier `Dialog.module.css` change and `Githubsite.txt`); nothing staged by this plan; **no new commits**.

---

## Executed on 2026-11-07: deviations from the text above

Executed inline on the local branch `backup-reminder`, uncommitted. Two things differed from the code printed in this plan, both found by `eslint`, and the plan above has been corrected to match what was built:

1. **No `Date.now()` during render** (`react-hooks/purity`). Both components read the clock once through `useState(() => Date.now())`. The dashboard remounts whenever someone navigates to it, which is when the age matters.
2. **No `import()` type annotation in a test** (`consistent-type-imports`): `import type * as DownloadModule` is used instead.

Also: Task 4's test and module were written in one step, so its red check was skipped. And in Task 14's script, Playwright's `uncheck()` fails on a controlled checkbox that flips a moment after the click, so the script clicks and polls instead.

Results: 57 test files, 2 461 tests passing (71 new); `tsc` and `eslint` clean; `npm run build` with `audit-offline: PASSED`; `npm run smoke` 18 of 18; the real-browser script 32 of 32 at phone and desktop width; `dataSpan` on 1 500 items 0.39 ms median.

## Known limits (stated, not hidden)

- **Android:** the app can only know an export was started, not that the native shell wrote the file. Every sentence says "last backup", never "safe".
- **After restoring an old backup**, locations and contacts are re-created with the import time, so the reminder may say changes exist since the backup's date. The data is exactly as old as the backup, so the nudge is defensible, but it is a side effect of how import stamps those two tables.
- **Backups already made** by 2.8.0 or earlier still contain the API key. The changelog and README say so; nothing here can reach into files people already saved.
- **A reload within about a second of a bulk import** can show an empty first screen (measured separately, not caused by or fixed here). The measuring script waits three seconds after importing to stay clear of it.

## Self-review against the spec

| Spec section | Task |
|---|---|
| Behaviour: quiet line, banner, Back up now | 10, 12 |
| Behaviour: Settings status, switch, days, advice | 11 |
| The rule and its boundaries | 2 |
| Where the time lives: three settings, no migration | 1 |
| Export stamps the file; checksum verifies | 5 |
| Import keeps the newer time, both modes | 6 |
| Shared `exportBackupToDevice`, order of operations | 7, 11 (BackupPanel), 10 (dashboard) |
| `dataSpan` over three tables | 4, 9 |
| Relative times via `Intl` | 3 |
| Settings text in three languages | 8 |
| Keeping the API key out of backups | 1, 5, 6, 8 (note text), 13 |
| Testing list items 1 to 9 | 2, 2, 1, 5, 6, 4, 7, 10, 5/6 |
| Documentation | 13 |
| Verification, measured in a browser | 14 |
