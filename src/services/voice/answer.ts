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
 *
 * `total` exists for the answers whose list was cut by a page limit before it
 * ever reached this module. A category holding eighty items arrives with fifty
 * rows and a total of eighty, and "and 47 more" after three names would be a
 * number that is simply wrong. It defaults to the length, so every caller with
 * the whole list passes nothing.
 */
function namesOf(t: TranslateFn, names: readonly string[], total = names.length): string {
  const shown = names.slice(0, MAX_NAMES).join(', ');
  const rest = total - Math.min(MAX_NAMES, names.length);
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

    case 'CATEGORY':
      return answer.total === 0
        ? t('voice.categoryNone', { category: answer.categoryName })
        : t('voice.categorySome', {
            category: answer.categoryName,
            count: answer.total,
            names: namesOf(t, answer.items.map((item) => item.name), answer.total),
          });

    /*
     * The first match, whole, and the rest counted.
     *
     * A contact question has one useful answer - the number to call - and
     * reading four of them to somebody who asked for the doctor's is worse
     * than reading one and saying how many others matched. `contacts.search`
     * orders by priority, so the first row is the one the user reaches for
     * first in an emergency.
     */
    case 'CONTACT': {
      const contact = answer.contacts[0];
      if (contact === undefined) return t('voice.contactNone', { query: answer.query });

      const rest = answer.contacts.length - 1;
      const more = rest <= 0 ? '' : ` ${t('voice.contactMore', { count: rest })}`;

      // A contact with no phone number is still an answer, and a truer one than
      // a sentence with an empty space where the number should be.
      if (contact.phone === null || contact.phone.trim() === '') {
        return `${t('voice.contactNoPhone', { name: contact.name })}${more}`;
      }

      const line =
        contact.relationship === null || contact.relationship.trim() === ''
          ? t('voice.contactAnswer', { name: contact.name, phone: contact.phone })
          : t('voice.contactAnswerWithRelationship', {
              name: contact.name,
              relationship: contact.relationship,
              phone: contact.phone,
            });
      return `${line}${more}`;
    }

    /*
     * Movements, newest first, each with what happened and when.
     *
     * The type goes through the same `transaction.*` keys the rest of the
     * application uses for a history row, so "Comprado" is one word here and on
     * the item screen rather than two translations of the same fact.
     */
    case 'HISTORY': {
      if (answer.entries.length === 0) {
        return t('voice.historyNone', { name: answer.item.name });
      }

      const entries = answer.entries.map((entry) =>
        t('voice.historyEntry', {
          type: t(`transaction.${entry.type}`),
          quantity: quantityOf(options.language, entry.quantity),
          unit: answer.item.unit,
          date: formatCalendarDate(entry.on, options.dateFormat),
        }),
      );
      return t('voice.history', {
        name: answer.item.name,
        count: entries.length,
        entries: entries.join('; '),
      });
    }

    /*
     * The count first, because it is what was asked for, and the two shapes of
     * it after - a number of items says nothing about whether they are spread
     * across the household or piled in one box.
     *
     * Each of the three numbers needs its own plural, and a sentence gets one
     * `count`, so the other two are rendered as phrases first - exactly as
     * `dayWindow` is.
     */
    case 'TOTAL': {
      const { totalItems, categoriesUsed, locationsUsed } = answer.stats;
      if (totalItems === 0) return t('voice.totalNone');

      return t('voice.total', {
        count: totalItems,
        categories: t('voice.categoryCount', { count: categoriesUsed }),
        locations: t('voice.locationCount', { count: locationsUsed }),
      });
    }

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
