/**
 * What to schedule, and what each one will say. Pure and I/O-free.
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE: A CAPACITOR WEBVIEW CANNOT WAKE UP.
 * There is no background execution here - no worker running while the
 * application is closed, no daily job, nothing that could look at the database
 * on a Tuesday and decide what to say. So the text of every notification is
 * decided in advance, on a day the application happens to be open, and handed
 * to Android's alarm manager with the date it should appear.
 *
 * That is the design rather than a limitation being hidden. Somebody who does
 * not open this application for three months still gets every reminder that was
 * planned on their last visit, because the sentences were already written and
 * the alarms were already set. What they do not get is a reminder about an item
 * they added after that visit, or one whose date they changed on paper. Opening
 * the application is what refreshes the plan, and `docs/ANDROID.md` says so in
 * those words rather than implying a watcher that does not exist.
 *
 * FOUR RULES, EACH FOR A DIFFERENT REASON:
 *
 *   One notification per day per kind, never one per item. Ten tins bought in
 *   one shop expire on one date; ten buzzes on that morning is how somebody
 *   learns to swipe this application away without reading it.
 *   At most three names, then a count - the same `namesOf` a spoken answer
 *   uses, imported rather than rewritten.
 *   Nothing in the past is scheduled. An alarm set for last Tuesday fires the
 *   instant it is set, which would greet somebody with a week of stale news
 *   every time they opened the application.
 *   A cap, honoured by dropping the furthest away. Android stops accepting
 *   pending alarms somewhere around fifty and does it silently, so the
 *   arithmetic has to happen here, where it can be tested, rather than being
 *   discovered on a phone.
 */
import {
  addCalendarDays,
  calendarDaysBetween,
  todayLocal,
  toCalendarDate,
  type CalendarDate,
} from '../../domain/dates';
import { namesOf } from '../voice/answer';
import type { TranslateFn } from '../../i18n/translate';

/**
 * The ceiling, and it is deliberately well under the one Android enforces.
 *
 * The documented failure is that an application which registers too many
 * pending alarms simply stops getting them, with no error and no log line, so
 * the number to pick is not "the limit" but "the limit with room in it". Around
 * fifty is the figure that shows up across Android versions and manufacturer
 * builds; forty leaves a fifth of it spare for an OEM that counts differently,
 * and for anything else in this application that might one day schedule.
 *
 * Forty is also far more than it sounds, because a notification here is a whole
 * day's expiries rather than one item. An inventory of any size at all produces
 * one entry per dated day, not one per tin, so forty covers the next forty days
 * on which something happens - which for a preparedness store stocked in bulk
 * is most of a year.
 *
 * What is dropped when it binds is the furthest away, never the soonest: the
 * milk this week matters more than the tinned peaches in 2029, and by the time
 * the peaches are near, the application will have been opened again.
 */
export const MAX_SCHEDULED_NOTICES = 40;

/**
 * The band of notification ids this application owns.
 *
 * Cancelling before rescheduling is the only way not to duplicate, and
 * `cancelAll()` would take down anything else that ever schedules from this
 * package - so what gets cancelled is identified by its id falling in here.
 * The base is arbitrary and the property that matters is that it is far from
 * zero, so that an id chosen by hand somewhere else cannot collide with one of
 * these by accident. Android ids are signed 32-bit, and this band sits well
 * inside that.
 */
export const NOTICE_ID_BASE = 811_000_000;
export const NOTICE_ID_LIMIT = NOTICE_ID_BASE + 1_000;

/** Whether an id belongs to this application's expiry reminders. */
export function isExpiryNoticeId(id: number): boolean {
  return Number.isInteger(id) && id >= NOTICE_ID_BASE && id < NOTICE_ID_LIMIT;
}

/**
 * The little an item has to be for this module to plan around it.
 *
 * Deliberately not `InventoryItem`: everything here needs is a name, a date and
 * whether the thing is still in service, and asking for the whole row would tie
 * the planner to a repository it has no other reason to know about.
 */
export interface DatedItem {
  readonly id: string;
  readonly name: string;
  readonly expirationDate: string | null;
  /** Non-null means archived, and archived stock is not reminded about. */
  readonly archivedAt?: string | null;
}

/**
 * `warning` is the one that arrives with time to act; `due` is the morning of.
 *
 * They stay separate rather than being merged into one message per day, because
 * "3 items expire today" and "3 items expire in 7 days" are different
 * instructions and a sentence carrying both would blur the one that is urgent.
 * Two on a day is the worst case and it is rare - it needs one item expiring
 * today and another expiring exactly one warning window later.
 */
export type ExpiryNoticeKind = 'warning' | 'due';

export interface ExpiryNotice {
  /** In the band above. Assigned by position, so the same plan yields the same ids. */
  readonly id: number;
  readonly kind: ExpiryNoticeKind;
  /** The calendar day it appears on. */
  readonly on: CalendarDate;
  /** The expiry date every item in it shares. */
  readonly expiresOn: CalendarDate;
  /** Days between the two. Zero for `due`. */
  readonly leadDays: number;
  /** The instant handed to the alarm manager, in the phone's local time. */
  readonly at: Date;
  readonly items: readonly { readonly id: string; readonly name: string }[];
}

export interface ExpiryPlan {
  readonly notices: readonly ExpiryNotice[];
  /** How many the cap left out. Zero in any ordinary inventory. */
  readonly dropped: number;
}

export interface PlanOptions {
  /** Everything is measured from here, so a test can hold time still. */
  readonly now: Date;
  /**
   * How many days before an expiry the warning arrives.
   *
   * The smallest of the user's `expiryWarningDays`, which is the same window
   * `evaluateExpiry` calls the one that describes the urgency. The larger ones
   * describe a colour on a list; a notification about something three months
   * off is not a reminder, it is noise.
   */
  readonly leadDays: number;
  /** `HH:MM`, the phone's local time. */
  readonly time: string;
  readonly cap?: number;
}

/** `HH:MM` to two numbers, falling back to 09:00 for anything else. */
function parseTime(time: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (match === null) return { hour: 9, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * A calendar day plus a time of day, as a local instant.
 *
 * Built from components rather than by parsing, for the reason dates.ts exists:
 * `new Date('2026-03-14T09:00')` is parsed as local by some engines and as UTC
 * by others, and a reminder delivered at 06:00 because of it would look like a
 * bug in the alarm rather than in the string.
 */
function instantOn(date: CalendarDate, hour: number, minute: number): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/**
 * Codepoint order, not a locale collation, and it does not need to be one.
 *
 * What this is for is that the same inventory produces the same three names
 * every time it is planned. A notification whose text changed between two
 * openings for no reason would be this application telling somebody something
 * different about a fact that did not move.
 */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function planExpiryNotices(
  items: readonly DatedItem[],
  options: PlanOptions,
): ExpiryPlan {
  const cap = options.cap ?? MAX_SCHEDULED_NOTICES;
  const { hour, minute } = parseTime(options.time);
  const today = todayLocal(options.now);

  /*
   * Grouped by the date on the packet, which is the same thing as grouping by
   * the day the reminder fires: the lead time is one number for the whole
   * inventory, so two items share a warning day exactly when they share an
   * expiry day. That is why every notice below can name a single date.
   */
  const byExpiry = new Map<CalendarDate, { id: string; name: string }[]>();

  for (const item of items) {
    // Archived stock is out of service. Reminding somebody to check something
    // they have already taken off the shelf is the fastest way to teach them
    // that these reminders are not worth reading.
    if (item.archivedAt != null) continue;

    const expiresOn = toCalendarDate(item.expirationDate);
    // No date is "does not expire", not "expired" - the correction expiry.ts
    // exists to make. A hammer is not late.
    if (expiresOn === null) continue;

    const group = byExpiry.get(expiresOn);
    if (group === undefined) byExpiry.set(expiresOn, [{ id: item.id, name: item.name }]);
    else group.push({ id: item.id, name: item.name });
  }

  const planned: Omit<ExpiryNotice, 'id'>[] = [];

  for (const [expiresOn, group] of byExpiry) {
    group.sort(byName);
    const members = Object.freeze(group);

    const candidates: { kind: ExpiryNoticeKind; on: CalendarDate; leadDays: number }[] = [
      { kind: 'due', on: expiresOn, leadDays: 0 },
    ];
    // A lead of zero would put the warning on the expiry day, which the `due`
    // notice already covers. Anything less is not a window at all.
    if (options.leadDays >= 1) {
      candidates.push({
        kind: 'warning',
        on: addCalendarDays(expiresOn, -options.leadDays),
        leadDays: options.leadDays,
      });
    }

    for (const candidate of candidates) {
      // Cheap reject first: a day already behind us cannot carry an instant
      // ahead of us, and this keeps a decade of expired stock from building a
      // Date per row.
      if (calendarDaysBetween(today, candidate.on) < 0) continue;

      const at = instantOn(candidate.on, hour, minute);
      // Strictly future. An alarm set for a moment that has passed fires
      // immediately, so "today at 09:00" at half past ten is not a reminder,
      // it is a notification about the notification you already had.
      if (at.getTime() <= options.now.getTime()) continue;

      planned.push({ kind: candidate.kind, on: candidate.on, expiresOn, leadDays: candidate.leadDays, at, items: members });
    }
  }

  /*
   * Soonest first, because that is the order the cap has to eat from the far
   * end of. The tie-break matters on exactly one shape - an item expiring on a
   * day another item's warning also lands on - and it puts the urgent one
   * first, so that if the cap falls between them the one that survives is the
   * food going off today.
   */
  planned.sort((a, b) => {
    const byTime = a.at.getTime() - b.at.getTime();
    if (byTime !== 0) return byTime;
    if (a.kind !== b.kind) return a.kind === 'due' ? -1 : 1;
    return a.expiresOn < b.expiresOn ? -1 : a.expiresOn > b.expiresOn ? 1 : 0;
  });

  const kept = planned.slice(0, Math.max(0, cap));
  return {
    notices: kept.map((notice, index) => ({ ...notice, id: NOTICE_ID_BASE + index })),
    dropped: planned.length - kept.length,
  };
}

/**
 * What one notice says, in the user's language.
 *
 * A title and a body rather than a sentence, because that is the shape Android
 * shows: the title survives every collapsed state a notification can be in, and
 * the body is what expands under it. So the title carries the count and the
 * deadline - the part that has to be readable at a glance on a locked phone -
 * and the names go below.
 */
export function renderExpiryNotice(
  t: TranslateFn,
  notice: ExpiryNotice,
): { readonly title: string; readonly body: string } {
  const count = notice.items.length;
  const body = namesOf(t, notice.items.map((item) => item.name));

  if (notice.kind === 'due') {
    return { title: t('notifications.dueTitle', { count }), body };
  }

  return {
    title: t('notifications.warningTitle', {
      count,
      // The window needs a plural of its own - "1 dia", "7 dias" - and the
      // sentence has already spent its single `count` on the items. Rendering
      // it as a phrase first gives it one, exactly as `renderAnswer` does.
      window: t('voice.dayWindow', { count: notice.leadDays }),
    }),
    body,
  };
}
