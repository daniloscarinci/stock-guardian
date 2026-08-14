import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPIRY_WINDOWS, evaluateExpiry, expiresWithin, compareByExpiry } from './expiry';

const TODAY = '2026-08-14';
const evaluate = (date: string | null, windows = DEFAULT_EXPIRY_WINDOWS) =>
  evaluateExpiry(date, TODAY, windows);

describe('expiry evaluation', () => {
  describe('items that do not expire', () => {
    it('treats a missing date as "no expiration", not as expired', () => {
      // The original app compared '' < today, which is true, so every item
      // without a date was reported EXPIRED. It also *required* a date, which
      // meant a hammer could not be entered at all.
      const status = evaluate(null);
      expect(status.bucket).toBe('none');
      expect(status.daysUntil).toBeNull();
    });

    it('treats an unusable date as "no expiration" rather than guessing', () => {
      expect(evaluate('2026-02-30').bucket).toBe('none');
      expect(evaluate('').bucket).toBe('none');
    });

    it('never reports a non-expiring item as needing attention', () => {
      expect(evaluate(null).needsAttention).toBe(false);
    });
  });

  describe('buckets', () => {
    it('reports a past date as expired', () => {
      const status = evaluate('2026-08-13');
      expect(status.bucket).toBe('expired');
      expect(status.daysUntil).toBe(-1);
    });

    it('reports today as expiring today, not as expired', () => {
      // Preserves the original rule: `expiry < today` is expired, so an item
      // expiring today is still usable today.
      const status = evaluate(TODAY);
      expect(status.bucket).toBe('today');
      expect(status.daysUntil).toBe(0);
    });

    it('reports a date inside the nearest window as soon', () => {
      const status = evaluate('2026-08-18');
      expect(status.bucket).toBe('soon');
      expect(status.daysUntil).toBe(4);
      expect(status.windowDays).toBe(7);
    });

    it('assigns the smallest window that contains the date', () => {
      expect(evaluate('2026-08-21').windowDays).toBe(7); // exactly 7 days
      expect(evaluate('2026-08-22').windowDays).toBe(30); // 8 days
      expect(evaluate('2026-09-13').windowDays).toBe(30); // exactly 30 days
      expect(evaluate('2026-09-14').windowDays).toBe(90); // 31 days
    });

    it('reports a date beyond every window as valid', () => {
      const status = evaluate('2027-08-14');
      expect(status.bucket).toBe('valid');
      expect(status.windowDays).toBeNull();
    });

    it('treats the largest configured window as the boundary', () => {
      expect(evaluate('2026-11-12').bucket).toBe('soon'); // 90 days
      expect(evaluate('2026-11-13').bucket).toBe('valid'); // 91 days
    });
  });

  describe('configurable windows', () => {
    it('honours a single custom window', () => {
      const status = evaluate('2026-08-25', [14]);
      expect(status.bucket).toBe('soon');
      expect(status.windowDays).toBe(14);
    });

    it('reproduces the original 30-day-only behaviour when configured that way', () => {
      expect(evaluate('2026-09-10', [30]).bucket).toBe('soon');
      expect(evaluate('2026-09-14', [30]).bucket).toBe('valid');
    });

    it('sorts unordered windows before use', () => {
      expect(evaluate('2026-08-18', [90, 7, 30]).windowDays).toBe(7);
    });
  });

  describe('needsAttention', () => {
    it('is true for expired and for anything expiring today', () => {
      expect(evaluate('2026-01-01').needsAttention).toBe(true);
      expect(evaluate(TODAY).needsAttention).toBe(true);
    });

    it('is true within the warning windows', () => {
      expect(evaluate('2026-08-20').needsAttention).toBe(true);
    });

    it('is false for a date beyond every window', () => {
      expect(evaluate('2030-01-01').needsAttention).toBe(false);
    });
  });

  describe('expiresWithin', () => {
    it('counts an item expiring exactly on the boundary', () => {
      expect(expiresWithin('2026-09-13', TODAY, 30)).toBe(true);
    });

    it('excludes an item one day past the boundary', () => {
      expect(expiresWithin('2026-09-14', TODAY, 30)).toBe(false);
    });

    it('includes already-expired items, matching the dashboard question "what needs action"', () => {
      expect(expiresWithin('2026-01-01', TODAY, 30)).toBe(true);
    });

    it('excludes items with no expiration', () => {
      expect(expiresWithin(null, TODAY, 30)).toBe(false);
    });
  });

  describe('sorting', () => {
    it('orders soonest first', () => {
      const dates = ['2026-12-01', '2026-08-20', '2026-09-05'];
      expect([...dates].sort(compareByExpiry)).toEqual([
        '2026-08-20',
        '2026-09-05',
        '2026-12-01',
      ]);
    });

    it('places items without an expiration last, in both directions', () => {
      // Sorting by expiry is asking "what runs out first". Something that never
      // runs out belongs at the end, not at the top because null sorts low.
      const dates = ['2026-12-01', null, '2026-08-20'];
      expect([...dates].sort(compareByExpiry)).toEqual(['2026-08-20', '2026-12-01', null]);
      expect([...dates].sort((a, b) => compareByExpiry(a, b, 'desc'))).toEqual([
        '2026-12-01',
        '2026-08-20',
        null,
      ]);
    });

    it('does not throw on a malformed date', () => {
      expect(() => ['2026-02-30', '2026-08-20'].sort(compareByExpiry)).not.toThrow();
    });
  });
});
