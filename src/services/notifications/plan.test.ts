/**
 * What gets scheduled, and what it says.
 *
 * Everything here is pure, so time is a parameter and no clock is stubbed: a
 * test that has to freeze `Date.now` is a test of a module that reads it, and
 * this one does not.
 *
 * The sentences are rendered through the real `translate` rather than a stub,
 * because half of what could go wrong is a missing key or a plural form that
 * does not exist in one of the three languages. A fake `t` returning its own
 * key would pass all of that.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SCHEDULED_NOTICES,
  NOTICE_ID_BASE,
  isExpiryNoticeId,
  planExpiryNotices,
  renderExpiryNotice,
  type DatedItem,
} from './plan';
import { translate } from '../../i18n/translate';
import type { Language } from '../../domain/settings';
import { addCalendarDays } from '../../domain/dates';

const t = (language: Language) => (key: string, values?: Record<string, string | number>) =>
  translate(language, key, values);

const en = t('en');

/** 14 March 2026, a Saturday, at 08:00 local - an hour before delivery time. */
const NOW = new Date(2026, 2, 14, 8, 0, 0, 0);
const TODAY = '2026-03-14';

function item(name: string, expirationDate: string | null, extra: Partial<DatedItem> = {}): DatedItem {
  return { id: `id-${name}`, name, expirationDate, ...extra };
}

function plan(items: readonly DatedItem[], options: Partial<Parameters<typeof planExpiryNotices>[1]> = {}) {
  return planExpiryNotices(items, { now: NOW, leadDays: 7, time: '09:00', ...options });
}

describe('planExpiryNotices', () => {
  describe('what it schedules', () => {
    it('warns one window ahead and again on the day', () => {
      const result = plan([item('Milk', '2026-04-01')]);

      expect(result.notices.map((n) => [n.kind, n.on, n.expiresOn])).toEqual([
        ['warning', '2026-03-25', '2026-04-01'],
        ['due', '2026-04-01', '2026-04-01'],
      ]);
      expect(result.dropped).toBe(0);
    });

    it('honours the user’s own warning window rather than a fixed seven', () => {
      const result = plan([item('Milk', '2026-06-01')], { leadDays: 30 });

      expect(result.notices[0]?.on).toBe('2026-05-02');
      expect(result.notices[0]?.leadDays).toBe(30);
    });

    /*
     * A window of zero would put the warning on the expiry day, where the `due`
     * notice already is. Two notifications an instant apart saying nearly the
     * same thing is the shape this module exists to avoid.
     */
    it('drops the warning entirely when the window is less than a day', () => {
      const result = plan([item('Milk', '2026-04-01')], { leadDays: 0 });

      expect(result.notices.map((n) => n.kind)).toEqual(['due']);
    });

    it('delivers at the configured time, in local time', () => {
      const [first] = plan([item('Milk', '2026-04-01')], { time: '18:45' }).notices;

      expect(first?.at.getFullYear()).toBe(2026);
      expect(first?.at.getMonth()).toBe(2);
      expect(first?.at.getDate()).toBe(25);
      expect(first?.at.getHours()).toBe(18);
      expect(first?.at.getMinutes()).toBe(45);
    });

    it('gives every notice an id inside this application’s own band', () => {
      const result = plan([item('Milk', '2026-04-01'), item('Bread', '2026-04-05')]);

      expect(result.notices.map((n) => n.id)).toEqual([
        NOTICE_ID_BASE,
        NOTICE_ID_BASE + 1,
        NOTICE_ID_BASE + 2,
        NOTICE_ID_BASE + 3,
      ]);
      expect(result.notices.every((n) => isExpiryNoticeId(n.id))).toBe(true);
      expect(isExpiryNoticeId(1)).toBe(false);
      expect(isExpiryNoticeId(NOTICE_ID_BASE - 1)).toBe(false);
    });

    it('orders by when it fires, soonest first', () => {
      const result = plan([
        item('Peaches', '2027-01-01'),
        item('Milk', '2026-03-20'),
        item('Bread', '2026-03-18'),
      ]);

      expect(result.notices.map((n) => n.on)).toEqual([
        '2026-03-18',
        '2026-03-20',
        '2026-12-25',
        '2027-01-01',
      ]);
    });
  });

  describe('what it leaves out', () => {
    it('skips an expiry that has already passed', () => {
      const result = plan([item('Milk', '2026-03-01'), item('Bread', addCalendarDays(TODAY, -1))]);

      expect(result.notices).toEqual([]);
    });

    /*
     * The warning day is behind us but the date is not, so the reminder that
     * still means something - the one on the day itself - has to survive.
     */
    it('keeps the day-of notice when only the warning day has passed', () => {
      const result = plan([item('Milk', '2026-03-16')]);

      expect(result.notices.map((n) => [n.kind, n.on])).toEqual([['due', '2026-03-16']]);
    });

    /*
     * An alarm set for a moment that has gone fires the instant it is
     * registered, which would mean opening the application at ten produced a
     * notification about nine o'clock.
     */
    it('skips today when the delivery time has already gone by', () => {
      const late = new Date(2026, 2, 14, 10, 30, 0, 0);

      expect(planExpiryNotices([item('Milk', TODAY)], { now: late, leadDays: 7, time: '09:00' }).notices).toEqual([]);
      expect(planExpiryNotices([item('Milk', TODAY)], { now: NOW, leadDays: 7, time: '09:00' }).notices).toHaveLength(1);
    });

    it('skips an item with no date, rather than treating blank as expired', () => {
      const result = plan([item('Hammer', null), item('Rope', ''), item('Tape', '   ')]);

      expect(result.notices).toEqual([]);
    });

    it('skips a date it cannot trust', () => {
      const result = plan([item('Milk', '2026-02-30'), item('Bread', 'next tuesday')]);

      expect(result.notices).toEqual([]);
    });

    it('skips archived stock', () => {
      const result = plan([
        item('Milk', '2026-04-01', { archivedAt: '2026-01-01T00:00:00.000Z' }),
        item('Bread', '2026-04-01'),
      ]);

      expect(result.notices).toHaveLength(2);
      expect(result.notices[0]?.items.map((i) => i.name)).toEqual(['Bread']);
    });
  });

  describe('grouping', () => {
    it('makes one notice of everything sharing a date, not one each', () => {
      const items = ['Milk', 'Yoghurt', 'Bread', 'Cheese', 'Eggs'].map((name) =>
        item(name, '2026-04-01'),
      );

      const result = plan(items);

      expect(result.notices).toHaveLength(2);
      expect(result.notices[0]?.items).toHaveLength(5);
    });

    it('names at most three and counts the rest', () => {
      const items = ['Milk', 'Yoghurt', 'Bread', 'Cheese', 'Eggs'].map((name) =>
        item(name, '2026-04-01'),
      );

      const [warning] = plan(items).notices;
      const rendered = renderExpiryNotice(en, warning!);

      expect(rendered.title).toBe('5 items expire in 7 days');
      expect(rendered.body).toBe('Bread, Cheese, Eggs and 2 more');
    });

    it('names them in the same order every time it is asked', () => {
      const names = ['Yoghurt', 'Milk', 'Bread'];
      const first = plan(names.map((n) => item(n, '2026-04-01'))).notices[0];
      const second = plan([...names].reverse().map((n) => item(n, '2026-04-01'))).notices[0];

      expect(renderExpiryNotice(en, first!).body).toBe(renderExpiryNotice(en, second!).body);
      expect(renderExpiryNotice(en, first!).body).toBe('Bread, Milk, Yoghurt');
    });

    it('keeps dates apart even when they are close together', () => {
      const result = plan([item('Milk', '2026-04-01'), item('Bread', '2026-04-02')]);

      expect(result.notices.map((n) => [n.on, n.items.map((i) => i.name)])).toEqual([
        ['2026-03-25', ['Milk']],
        ['2026-03-26', ['Bread']],
        ['2026-04-01', ['Milk']],
        ['2026-04-02', ['Bread']],
      ]);
    });

    /*
     * The one shape where a warning and a day-of notice land on the same
     * morning: something expiring today, and something else expiring exactly
     * one window later. They stay two, because "expires today" and "expires in
     * 7 days" are different instructions - and the urgent one sorts first, so
     * that a cap falling between them keeps the food that is going off.
     */
    it('puts the day-of notice first when both fall on one morning', () => {
      const result = plan([item('Milk', '2026-03-21'), item('Bread', '2026-03-28')]);

      const sameDay = result.notices.filter((n) => n.on === '2026-03-21');
      expect(sameDay.map((n) => n.kind)).toEqual(['due', 'warning']);
    });
  });

  describe('the cap', () => {
    it('defaults to forty', () => {
      expect(MAX_SCHEDULED_NOTICES).toBe(40);
    });

    it('keeps the soonest and drops the furthest away', () => {
      // Sixty distinct dates, one item each: 120 candidate notices.
      const items = Array.from({ length: 60 }, (_, index) =>
        item(`Item ${String(index)}`, addCalendarDays('2026-04-01', index)),
      );

      const result = plan(items);

      expect(result.notices).toHaveLength(MAX_SCHEDULED_NOTICES);
      expect(result.dropped).toBe(120 - MAX_SCHEDULED_NOTICES);

      // The window kept runs from the earliest warning forward, unbroken: the
      // first is a week before the first expiry, and every one after it fires
      // no earlier than the one before.
      expect(result.notices[0]?.on).toBe('2026-03-25');
      expect(result.notices.at(-1)?.on).toBe('2026-04-17');

      const times = result.notices.map((n) => n.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('reports nothing dropped when everything fits', () => {
      expect(plan([item('Milk', '2026-04-01')]).dropped).toBe(0);
    });

    it('takes a cap of its own, so the ceiling is testable without sixty items', () => {
      const items = [
        item('Milk', '2026-04-01'),
        item('Bread', '2026-05-01'),
        item('Rice', '2026-06-01'),
      ];

      const result = plan(items, { cap: 2 });

      expect(result.notices.map((n) => n.on)).toEqual(['2026-03-25', '2026-04-01']);
      expect(result.dropped).toBe(4);
    });
  });

  describe('the words', () => {
    const items = ['Leite', 'Iogurte', 'Pão'].map((name) => item(name, '2026-04-01'));

    it('says how many and by when, in English', () => {
      const [warning, due] = plan(items).notices;

      expect(renderExpiryNotice(t('en'), warning!)).toEqual({
        title: '3 items expire in 7 days',
        body: 'Iogurte, Leite, Pão',
      });
      expect(renderExpiryNotice(t('en'), due!)).toEqual({
        title: '3 items expire today',
        body: 'Iogurte, Leite, Pão',
      });
    });

    it('says it in Portuguese', () => {
      const [warning, due] = plan(items).notices;

      expect(renderExpiryNotice(t('pt-BR'), warning!)).toEqual({
        title: '3 itens vencem em 7 dias',
        body: 'Iogurte, Leite, Pão',
      });
      expect(renderExpiryNotice(t('pt-BR'), due!)).toEqual({
        title: '3 itens vencem hoje',
        body: 'Iogurte, Leite, Pão',
      });
    });

    it('says it in Spanish', () => {
      const [warning, due] = plan(items).notices;

      expect(renderExpiryNotice(t('es'), warning!)).toEqual({
        title: '3 ítems vencen en 7 días',
        body: 'Iogurte, Leite, Pão',
      });
      expect(renderExpiryNotice(t('es'), due!)).toEqual({
        title: '3 ítems vencen hoy',
        body: 'Iogurte, Leite, Pão',
      });
    });

    /*
     * One item is a different sentence in all three, and so is one day. The
     * window carries a plural of its own because the sentence has already spent
     * its single `count` on the items - the same trick `renderAnswer` uses.
     */
    it('gets the singulars right, for the items and for the window', () => {
      const [warning] = plan([item('Leite', '2026-03-15')], { leadDays: 1 }).notices;

      expect(renderExpiryNotice(t('en'), warning!).title).toBe('1 item expires in 1 day');
      expect(renderExpiryNotice(t('pt-BR'), warning!).title).toBe('1 item vence em 1 dia');
      expect(renderExpiryNotice(t('es'), warning!).title).toBe('1 ítem vence en 1 día');
    });
  });
});
