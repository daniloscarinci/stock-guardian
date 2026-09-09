/**
 * What the application says when it opens, and when it is worth saying.
 *
 * Pure: a clock reading and some counts in, one sentence out. Everything that
 * involves a speaker, a phone or a launch lives in `useWelcome.ts`, so what is
 * actually said can be checked at every hour of the day and every shape of
 * inventory without anything making a sound.
 *
 * A GREETING ALONE GETS SWITCHED OFF WITHIN A WEEK. So this is not a greeting;
 * it is the shortest possible version of why somebody opened the application,
 * with a greeting on the front. Every number it reads has already been counted
 * for the dashboard - nothing is queried for the sake of being said out loud,
 * and nothing here can make the application slower to draw.
 */
import type { TranslateFn } from '../../i18n/translate';

/** The counts the welcome may mention, all of them already on screen. */
export interface WelcomeFacts {
  readonly expired: number;
  readonly expiringToday: number;
  /**
   * Expiring inside the warning windows - which means inside the FURTHEST of
   * them, because that is the horizon `dashboardStats` counts against. Said with
   * the number of days rather than as "soon", so that it means something.
   */
  readonly expiringSoon: number;
  readonly belowMinimum: number;
  /** The furthest warning window, in days. What `expiringSoon` is counted against. */
  readonly horizonDays: number;
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/**
 * Which greeting the hour calls for.
 *
 * The bands are Portuguese and Spanish, not English. Both split the day three
 * ways - bom dia, boa tarde, boa noite - and being greeted with "good morning"
 * at four in the afternoon is worse than not being greeted, so the bands belong
 * to the languages that have the distinction and English is given the same ones
 * rather than an invented set of its own.
 *
 * The small hours are night, not morning. At three o'clock a Brazilian says boa
 * noite, and "bom dia" there would be the same mistake in the other direction.
 */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * How many facts one spoken sentence may carry.
 *
 * Two. A spoken list cannot be scrolled back through, and the screen behind it
 * can show ten at once and does - so this names what is most urgent and leaves
 * the rest to the interface it is standing in front of.
 */
const MOST_FACTS = 2;

/**
 * The whole welcome, in the interface language.
 *
 * The facts are ordered by urgency and not by size: what has already gone off,
 * what goes off today, what goes off inside the warning window, what is below
 * its minimum. Nothing at all is itself worth saying, and briefly - an
 * application that answers "everything is fine" in one breath is one somebody
 * keeps switched on.
 */
export function composeWelcome(t: TranslateFn, facts: WelcomeFacts, hour: number): string {
  const greeting = t(`welcome.${timeOfDay(hour)}`);

  const reportable: string[] = [];
  if (facts.expired > 0) {
    reportable.push(t('welcome.expired', { count: facts.expired }));
  }
  if (facts.expiringToday > 0) {
    reportable.push(t('welcome.today', { count: facts.expiringToday }));
  }
  if (facts.expiringSoon > 0) {
    reportable.push(t('welcome.soon', { count: facts.expiringSoon, days: facts.horizonDays }));
  }
  if (facts.belowMinimum > 0) {
    reportable.push(t('welcome.low', { count: facts.belowMinimum }));
  }

  const said = reportable.length === 0 ? [t('welcome.nothing')] : reportable.slice(0, MOST_FACTS);
  return [`${greeting}.`, ...said].join(' ');
}
