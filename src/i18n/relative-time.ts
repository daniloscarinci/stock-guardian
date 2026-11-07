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
