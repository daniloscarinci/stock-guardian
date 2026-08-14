import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDaysBetween,
  formatCalendarDate,
  isValidCalendarDate,
  toCalendarDate,
  todayLocal,
} from './dates';

describe('calendar dates', () => {
  describe('validation', () => {
    it('accepts a well-formed date', () => {
      expect(isValidCalendarDate('2026-08-14')).toBe(true);
    });

    it.each([
      ['', 'empty'],
      ['2026-8-14', 'unpadded month'],
      ['14/08/2026', 'display format'],
      ['2026-08-14T00:00:00Z', 'an instant, not a date'],
      ['not-a-date', 'nonsense'],
    ])('rejects %s (%s)', (value) => {
      expect(isValidCalendarDate(value)).toBe(false);
    });

    it('rejects dates that look valid but do not exist', () => {
      // The original app never checked this: a string comparison happily
      // accepted 2026-02-30 and sorted it between real dates.
      expect(isValidCalendarDate('2026-02-30')).toBe(false);
      expect(isValidCalendarDate('2026-13-01')).toBe(false);
      expect(isValidCalendarDate('2026-04-31')).toBe(false);
      expect(isValidCalendarDate('2025-02-29')).toBe(false);
    });

    it('accepts a real leap day', () => {
      expect(isValidCalendarDate('2028-02-29')).toBe(true);
    });
  });

  describe('todayLocal', () => {
    it('uses the local calendar date, not the UTC one', () => {
      // 2026-08-14 21:30 in UTC-5 is already 2026-08-15 in UTC. The original
      // app used toISOString() here, so it treated "today" as tomorrow every
      // evening in the Americas and reported items expired a day early.
      const localEvening = new Date(2026, 7, 14, 21, 30, 0);
      expect(todayLocal(localEvening)).toBe('2026-08-14');
    });

    it('handles the first of the month', () => {
      expect(todayLocal(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
    });

    it('pads single-digit months and days', () => {
      expect(todayLocal(new Date(2026, 2, 7, 12))).toBe('2026-03-07');
    });
  });

  describe('arithmetic', () => {
    it('counts whole days between dates', () => {
      expect(calendarDaysBetween('2026-08-14', '2026-08-21')).toBe(7);
    });

    it('is negative when the target is in the past', () => {
      expect(calendarDaysBetween('2026-08-14', '2026-08-13')).toBe(-1);
    });

    it('is zero for the same day', () => {
      expect(calendarDaysBetween('2026-08-14', '2026-08-14')).toBe(0);
    });

    it('crosses month and year boundaries', () => {
      expect(calendarDaysBetween('2026-12-30', '2027-01-02')).toBe(3);
      expect(calendarDaysBetween('2026-02-28', '2026-03-01')).toBe(1);
      expect(calendarDaysBetween('2028-02-28', '2028-03-01')).toBe(2); // leap year
    });

    it('is unaffected by daylight saving transitions', () => {
      // Northern-hemisphere DST starts 2026-03-08 and ends 2026-11-01 in the US;
      // Brazil and Europe shift on other dates. Doing this arithmetic on local
      // Date objects yields 6.958... days and truncates to 6.
      expect(calendarDaysBetween('2026-03-05', '2026-03-12')).toBe(7);
      expect(calendarDaysBetween('2026-10-29', '2026-11-05')).toBe(7);
    });

    it('adds days across boundaries', () => {
      expect(addCalendarDays('2026-08-14', 30)).toBe('2026-09-13');
      expect(addCalendarDays('2026-12-30', 3)).toBe('2027-01-02');
      expect(addCalendarDays('2026-08-14', -14)).toBe('2026-07-31');
      expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    });
  });

  describe('toCalendarDate', () => {
    it('passes through a valid date', () => {
      expect(toCalendarDate('2026-08-14')).toBe('2026-08-14');
    });

    it('returns null for anything it cannot trust', () => {
      expect(toCalendarDate('2026-02-30')).toBeNull();
      expect(toCalendarDate('')).toBeNull();
      expect(toCalendarDate(null)).toBeNull();
      expect(toCalendarDate(undefined)).toBeNull();
      expect(toCalendarDate('  ')).toBeNull();
    });

    it('trims surrounding whitespace', () => {
      expect(toCalendarDate(' 2026-08-14 ')).toBe('2026-08-14');
    });
  });

  describe('formatting', () => {
    it.each([
      ['DD/MM/YYYY', '14/08/2026'],
      ['MM/DD/YYYY', '08/14/2026'],
      ['YYYY-MM-DD', '2026-08-14'],
    ] as const)('formats as %s', (format, expected) => {
      expect(formatCalendarDate('2026-08-14', format)).toBe(expected);
    });

    it('returns an empty string for a missing date', () => {
      expect(formatCalendarDate(null, 'DD/MM/YYYY')).toBe('');
    });
  });
});
