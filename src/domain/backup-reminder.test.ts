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
