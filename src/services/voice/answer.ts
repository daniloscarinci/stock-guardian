/**
 * An Answer as a sentence.
 *
 * Four rules, all of which follow from the sentence being SPOKEN:
 *
 *   Name at most three items and count the rest. Forty names read aloud is
 *   noise, and the screen shows the full list anyway.
 *   An empty result is a sentence, never an empty list.
 *   Every number goes through `t`, so a plural is a plural in all three
 *   languages without this module knowing any of their rules.
 *   Every date and quantity goes through the user's own format. `2026-09-12`
 *   and `0.333333` are stored values; neither is a thing anyone says.
 */
import { formatCalendarDate } from '../../domain/dates';
import type { DateFormat, Language } from '../../domain/settings';
import { LOCALE_TAGS } from '../../i18n/translate';
import type { TranslateFn } from '../../i18n/translate';
import type { Answer } from './execute';

/** How many names a spoken sentence may carry before it stops being one. */
const MAX_NAMES = 3;

/**
 * The display preferences a sentence needs and an `Answer` does not carry.
 *
 * `t` already knows the language for the purpose of choosing words. It does not
 * know how the user writes a date or a decimal, and those are settings.
 */
export interface AnswerOptions {
  readonly language: Language;
  readonly dateFormat: DateFormat;
}

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

/**
 * A stored quantity as a spoken one.
 *
 * `adjustQuantity` rounds to six decimal places, so `String(quantity)` can read
 * aloud as "zero point three three three three three three". The inventory
 * screen caps the same value at three digits; this matches it, and picks up the
 * locale's decimal separator on the way - "1,5 kg" in pt-BR, not "1.5 kg".
 */
function quantityOf(language: Language, quantity: number): string {
  return new Intl.NumberFormat(LOCALE_TAGS[language], { maximumFractionDigits: 3 }).format(quantity);
}

export function renderAnswer(t: TranslateFn, answer: Answer, options: AnswerOptions): string {
  switch (answer.kind) {
    case 'QUANTITY': {
      const { name, unit, locationName } = answer.item;
      const quantity = quantityOf(options.language, answer.item.quantity);
      return locationName === null
        ? t('voice.quantityAnswerNoLocation', { name, quantity, unit })
        : t('voice.quantityAnswer', { name, quantity, unit, location: locationName });
    }

    case 'EXPIRING': {
      if (answer.items.length === 0) {
        // "Nothing has expired" and "nothing expires in 30 days" are different
        // reassurances, and only one of them is true of a question about the past.
        // The empty future sentence spends its one plural on the window, which is
        // the only number in it.
        return answer.expiredOnly
          ? t('voice.expiredNone')
          : t('voice.expiringNone', { count: answer.withinDays });
      }

      const count = answer.items.length;
      const names = namesOf(t, answer.items.map((item) => item.name));

      // Already-expired stock takes no window at all. Saying "3 items expire
      // within 30 days" of food that went bad last week is not a tense error,
      // it is a false claim that the food is still good.
      if (answer.expiredOnly) return t('voice.expiredSome', { count, names });

      return t('voice.expiringSome', {
        count,
        names,
        // The window needs a plural of its own - "1 dia", "30 dias" - and the
        // sentence has already spent its single count on the items. Rendering it
        // as a phrase first gives it one, the way `andMore` gets one.
        window: t('voice.dayWindow', { count: answer.withinDays }),
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

    case 'EXPIRY_OF': {
      // `formatCalendarDate` returns '' for null and for anything it cannot
      // parse, which covers both cases at once: "Leite vence em ." is a worse
      // sentence than "Leite has no expiry date", and less true.
      const date = formatCalendarDate(answer.item.expirationDate, options.dateFormat);
      return date === ''
        ? t('voice.expiryOfNone', { name: answer.item.name })
        : t('voice.expiryOf', { name: answer.item.name, date });
    }

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
