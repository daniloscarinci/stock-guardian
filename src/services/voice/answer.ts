/**
 * An Answer as a sentence.
 *
 * Three rules, all of which follow from the sentence being SPOKEN:
 *
 *   Name at most three items and count the rest. Forty names read aloud is
 *   noise, and the screen shows the full list anyway.
 *   An empty result is a sentence, never an empty list.
 *   Every number goes through `t`, so a plural is a plural in all three
 *   languages without this module knowing any of their rules.
 */
import type { TranslateFn } from '../../i18n/translate';
import type { Answer } from './execute';

/** How many names a spoken sentence may carry before it stops being one. */
const MAX_NAMES = 3;

/**
 * Up to three names, with the remainder counted rather than recited.
 *
 * The count goes through `t` because "and 1 more" and "e mais 1" are different
 * sentences in a way this module must not know about.
 */
function namesOf(t: TranslateFn, names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES).join(', ');
  const rest = names.length - MAX_NAMES;
  return rest <= 0 ? shown : `${shown} ${t('voice.andMore', { count: rest })}`;
}

export function renderAnswer(t: TranslateFn, answer: Answer): string {
  switch (answer.kind) {
    case 'QUANTITY': {
      const { name, quantity, unit, locationName } = answer.item;
      return locationName === null
        ? t('voice.quantityAnswerNoLocation', { name, quantity, unit })
        : t('voice.quantityAnswer', { name, quantity, unit, location: locationName });
    }

    case 'EXPIRING': {
      if (answer.items.length === 0) {
        // "Nothing has expired" and "nothing expires in 30 days" are different
        // reassurances, and only one of them is true of a question about the past.
        return answer.expiredOnly
          ? t('voice.expiredNone')
          : t('voice.expiringNone', { days: answer.withinDays });
      }
      return t('voice.expiringSome', {
        count: answer.items.length,
        days: answer.withinDays,
        names: namesOf(t, answer.items.map((item) => item.name)),
      });
    }

    case 'MISSING':
      return answer.lines.length === 0
        ? t('voice.missingNone')
        : t('voice.missingSome', {
            count: answer.lines.length,
            names: namesOf(t, answer.lines.map((line) => line.name)),
          });

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
            names: namesOf(t, answer.items.map((item) => item.name)),
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

    case 'HELP': {
      const title = t('voice.examplesTitle');
      // `execute` returns no examples; the caller that owns the grammar fills
      // them in. The title alone is still a sentence.
      return answer.examples.length === 0 ? title : `${title}: ${answer.examples.join('; ')}`;
    }
  }
}
