/**
 * What would be written, before it is.
 *
 * Nothing in the voice feature reaches a write path except the Confirm button
 * below; `services/voice/commit.ts` is the only module that writes, and this is
 * the only thing that calls it. The card therefore has to state the change
 * completely enough to be judged: which row it is about, what else is known
 * about that row, and the value it holds now beside the value it would hold.
 *
 * Focus moves here on mount, and the button carries the whole change in its
 * accessible name. This feature exists for people who are not looking at the
 * screen, so that is the feature rather than a courtesy - a card that appeared
 * silently and left focus in the text box would be a card nobody heard.
 *
 * A card is now shown only for a write that GUESSED at something. An explicit
 * one is stored on the spot and offered back, because asking someone to confirm
 * the sentence they just said clearly is what made this tiring on a real phone.
 * So the card also says what it filled in: "10 becomes 11" is true and explains
 * nothing, and the thing the reader has to check is exactly the part that was
 * not heard.
 */
import { useEffect, useId, useRef } from 'react';
import { useApp } from '../../app/AppContext';
import { Button } from '../../components/ui/primitives';
import { formatCalendarDate } from '../../domain/dates';
import { LOCALE_TAGS } from '../../i18n/translate';
import type { PendingWrite } from '../../services/voice/execute';
import type { DateFormat, Language } from '../../domain/settings';
import type { TranslateFn } from '../../i18n/translate';
import styles from './Voice.module.css';

/**
 * Every write, reduced to the five things every card shows.
 *
 * Not everything a card shows: `details` below adds the lines a write has that
 * a name and a value cannot carry, and they are gathered separately because
 * only one kind of write has any.
 */
interface Described {
  readonly name: string;
  readonly location: string | null;
  /**
   * Which field is changing, where the card would otherwise not say.
   *
   * A quantity needs no label: "12 kg becomes 17 kg" under an item's name can
   * only be the quantity. A minimum and a target read identically without one -
   * two numbers, the same unit, the same arrow - and they are different
   * settings with different consequences. Null wherever the change speaks for
   * itself.
   */
  readonly field: string | null;
  /**
   * null when there is no old value, which is true of all four writes that
   * make something rather than change it: a new item, place, category or
   * contact. Nothing is being replaced, so there is nothing to strike through.
   */
  readonly before: string | null;
  readonly after: string;
}

/**
 * A stored quantity as a written one.
 *
 * `adjustQuantity` rounds to six decimal places, so `String(quantity)` can show
 * as `0.333333`. Three digits, in the user's own locale, is what the inventory
 * screen shows and what `renderAnswer` says aloud.
 */
function quantity(language: Language, value: number): string {
  return new Intl.NumberFormat(LOCALE_TAGS[language], { maximumFractionDigits: 3 }).format(value);
}

function describe(
  write: PendingWrite,
  t: TranslateFn,
  language: Language,
  dateFormat: DateFormat,
): Described {
  switch (write.kind) {
    case 'ADJUST':
      return {
        name: write.item.name,
        location: write.item.locationName,
        field: null,
        before: `${quantity(language, write.item.quantity)} ${write.item.unit}`,
        after: `${quantity(language, write.after)} ${write.item.unit}`,
      };

    /*
     * The location is the change here, so it is not repeated as context above
     * it. Every other card shows where the item is; this one shows where it is
     * going, and a "Location: Pantry" line over "Pantry becomes Cellar" reads
     * as though two different places were involved.
     *
     * A destination that has still to be made shows its name like any other.
     * That it does not exist yet is not something this line can carry - it is
     * said once, in the guesses below, where the reader is already being asked
     * to check what was filled in.
     */
    case 'MOVE':
      return {
        name: write.item.name,
        location: null,
        field: t('common.location'),
        before: write.fromLocationName ?? t('common.none'),
        after: write.to.name,
      };

    case 'MINIMUM':
      return {
        name: write.item.name,
        location: write.item.locationName,
        field: t('voice.fieldMinimum'),
        // Never set is not the same as set to zero: one leaves the global
        // threshold in charge and the other silences the item.
        before:
          write.before === null
            ? t('common.none')
            : `${quantity(language, write.before)} ${write.item.unit}`,
        after: `${quantity(language, write.after)} ${write.item.unit}`,
      };

    case 'TARGET':
      return {
        name: write.item.name,
        location: write.item.locationName,
        field: t('voice.fieldTarget'),
        before:
          write.before === null
            ? t('common.none')
            : `${quantity(language, write.before)} ${write.item.unit}`,
        after: `${quantity(language, write.after)} ${write.item.unit}`,
      };

    case 'EXPIRY': {
      const before = formatCalendarDate(write.before, dateFormat);
      return {
        name: write.item.name,
        location: write.item.locationName,
        field: null,
        // An item with no date has no old value to strike through, but "None"
        // is the true one and reads better than an empty space.
        before: before === '' ? t('common.none') : before,
        after: formatCalendarDate(write.after, dateFormat),
      };
    }

    case 'CREATE':
      return {
        name: write.name,
        location: write.location === null ? null : write.location.name,
        field: null,
        before: null,
        after: `${quantity(language, write.quantity)} ${write.unit}`,
      };

    /*
     * The first of three cards whose subject is not an item, so most of the
     * shape is empty rather than filled in: there is no quantity, no unit, and
     * no shelf to print above it, because the name IS the whole change.
     * `before` is null for the reason a creation's is - nothing is replaced.
     *
     * `locations.newLocation` rather than a sentence of this card's own. Those
     * are the words the Locations screen puts over the form that does exactly
     * this by hand, and a reader who has used that screen should recognise
     * what they are agreeing to. The name they said is the heading above it,
     * and the guess below repeats it in full - `voice.assumedNewLocation` is
     * where the card says no place is called this yet.
     */
    case 'NEW_LOCATION':
      return {
        name: write.name,
        location: null,
        field: null,
        before: null,
        after: t('locations.newLocation'),
      };

    /*
     * The same shape again, and the same argument for the words in it.
     * `categories.newCategory` is the heading the Categories screen puts over
     * the form that does this by hand, exactly as `locations.newLocation` is
     * on the Locations screen, so a reader who has made a category there
     * recognises what they are agreeing to. No new key, and nothing invented.
     */
    case 'NEW_CATEGORY':
      return {
        name: write.name,
        location: null,
        field: null,
        before: null,
        after: t('categories.newCategory'),
      };

    /*
     * The third of these, and `contacts.newContact` for the reason the two
     * above give: it is the heading the Contacts screen puts over the form
     * that does this by hand.
     *
     * `location` stays null even though this write HAS one. That slot is the
     * shelf an item sits on, labelled "Location" in the line it renders, and a
     * contact's location is where a PERSON is - a different fact under a
     * different word. It goes below with the rest of them, under the label its
     * own screen gives it.
     */
    case 'NEW_CONTACT':
      return {
        name: write.name,
        location: null,
        field: null,
        before: null,
        after: t('contacts.newContact'),
      };
  }
}

/**
 * The lines that go under the name, where the name is not the whole write.
 *
 * A second pass over the union rather than a sixth field on `Described`,
 * exactly as `assumed` below is: both answer a question only some kinds of
 * write have an answer to, and threading an empty array through every other
 * case above would say nothing eight times over.
 *
 * It exists for the contact, and the reason is `heardDigits`. That guess tells
 * the reader to check a number character by character, and a card that did not
 * show the number would be telling them to check something they cannot see.
 * The relationship is here beside it because it is stored too, and a card is
 * worth judging only if it states the whole change.
 *
 * The last two lines are what the grammar cannot fill and the Claude path can.
 * They render nothing today, because `execute` sets both to null on every
 * NEW_CONTACT it builds; they are written now so that the day something fills
 * them, the card shows them rather than storing a field it never mentioned.
 */
function details(write: PendingWrite, t: TranslateFn): readonly string[] {
  if (write.kind !== 'NEW_CONTACT') return [];

  const lines: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value !== null && value.trim() !== '') lines.push(`${label}: ${value}`);
  };

  add(t('contacts.relationship'), write.relationship);
  add(t('contacts.phone'), write.phone);
  add(t('contacts.email'), write.email);
  add(t('contacts.whereTheyAre'), write.location);
  return lines;
}

/**
 * Every guess this write is made of, in words.
 *
 * The facts are gathered before the reasons, because an assumption names a part
 * of the write and which part it names is knowable only from the write's kind.
 * A reason that cannot apply to a kind - 'quantity' to an expiry date, 'item'
 * to a creation - is never produced by `execute`, so the unused values here
 * cost a line and buy a switch with no casts in it.
 */
function assumed(
  write: PendingWrite,
  t: TranslateFn,
  language: Language,
  dateFormat: DateFormat,
): readonly string[] {
  // A place, a category and a contact have no item behind them, so none of
  // these can come off one. Nor is any of them ever read for one: the only
  // reason NEW_LOCATION produces is `newLocation`, which interpolates `place`
  // below; the only one NEW_CATEGORY produces is `newCategory`, which
  // interpolates nothing; and the only one NEW_CONTACT produces is
  // `heardDigits`, which interpolates nothing either. The branches exist so
  // the switch below needs no casts, and `write.name` is at least the truthful
  // thing to sit in a slot nothing reaches for; a unit has no such value, so
  // it is blank.
  const itemless =
    write.kind === 'NEW_LOCATION' || write.kind === 'NEW_CATEGORY' || write.kind === 'NEW_CONTACT';
  const name = write.kind === 'CREATE' || itemless ? write.name : write.item.name;
  const unit = write.kind === 'CREATE' ? write.unit : itemless ? '' : write.item.unit;
  const amount =
    write.kind === 'ADJUST'
      ? Math.abs(write.delta)
      : write.kind === 'CREATE'
        ? write.quantity
        : 0;
  const date = write.kind === 'EXPIRY' ? formatCalendarDate(write.after, dateFormat) : '';
  // All three writes that name a place, because any of them can name one that
  // has still to be made and the reader has to see the name either way. For
  // the third the place is the write itself, so its own name is the one.
  const place =
    write.kind === 'MOVE'
      ? write.to.name
      : write.kind === 'CREATE'
        ? (write.location?.name ?? '')
        : write.kind === 'NEW_LOCATION'
          ? write.name
          : '';

  return write.assumptions.map((reason) => {
    switch (reason) {
      case 'quantity':
        return t('voice.assumedQuantity', { quantity: quantity(language, amount) });
      case 'item':
        return t('voice.assumedItem', { name });
      case 'unit':
        return t('voice.assumedUnit', { unit });
      case 'date':
        return t('voice.assumedDate', { date });
      case 'newItem':
        return t('voice.assumedNewItem', { name });
      // Only a MOVE produces this, and it names the shelf that was matched
      // rather than the words that were said - the reader has to check that
      // the two are the same place.
      case 'location':
        return t('voice.assumedLocation', { location: place });
      // Names who chose, rather than borrowing `item`'s "you did not say its
      // whole name" - which is a sentence about something the reader of an
      // assistant proposal never did.
      case 'assistant':
        return t('voice.assumedAssistant');
      /*
       * The opposite of `location`, and the reader checks a different thing.
       * `location` picked one of their shelves and asks which; this one found
       * none and asks about the spelling of a name that is about to become a
       * row. MOVE, CREATE and NEW_LOCATION all produce it, and all three carry
       * the name - on the last of them it is the write's own.
       */
      case 'newLocation':
        return t('voice.assumedNewLocation', { location: place });
      /*
       * NEW_CATEGORY produces this and nothing else does, which is what makes
       * the sentence's "this" point at something: the card's heading IS the
       * name about to become a row, because `describe` above puts it there.
       * So the line was left as it was written rather than grown a `{category}`
       * of its own - it would repeat the heading a reader has just been given,
       * and the three translations already say the true thing.
       *
       * `newLocation` above does interpolate, and that is not an
       * inconsistency: MOVE and CREATE produce it under a card headed with the
       * ITEM, so the place has to be named in the sentence or it is named
       * nowhere at all.
       */
      case 'newCategory':
        return t('voice.assumedNewCategory');
      /*
       * NEW_CONTACT produces this, and it was written before anything did.
       * Re-read against the card a reader now actually sees: "I heard this
       * number rather than being shown it. Check every digit." "This number"
       * had nothing to point at while no card carried a number, which is why
       * `details` above puts the digits on the card under the name and into
       * the button's accessible name. With them there the sentence is true and
       * complete, so it stands as Task 2 wrote it in all three languages - and
       * it interpolates nothing, which is right here for `newCategory`'s
       * reason: the number is already in front of the reader, and repeating it
       * inside the warning would print it twice.
       */
      case 'heardDigits':
        return t('voice.assumedHeardDigits');
    }
  });
}

export function ConfirmCard({
  write,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly write: PendingWrite;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const { t, settings } = useApp();
  const headingId = useId();
  const guessesId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  // The card appears in response to something said, not to something clicked,
  // so nothing else is going to move focus onto it.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const { name, location, field, before, after } =
    describe(write, t, settings.language, settings.dateFormat);
  const lines = details(write, t);
  const guesses = assumed(write, t, settings.language, settings.dateFormat);

  // The button's name has to survive being read on its own, out of the visual
  // context that makes "Confirm" mean anything - which is why the lines above
  // are in it and not only on the card. Focus lands here, so a number printed
  // anywhere else is a number the reader who was told to check it never hears.
  // Every write but the contact returns none of them, so this reads exactly as
  // it did for the other eight.
  const change =
    before === null ? after : `${before} ${t('voice.becomes')} ${after}`;
  const detail = [name, ...lines, field === null ? change : `${field}: ${change}`].join(', ');

  return (
    <section className={styles.card} role="group" aria-labelledby={headingId}>
      <h3 className={styles.cardTitle} id={headingId}>
        {name}
      </h3>

      {location !== null && (
        <p className={styles.cardMeta}>
          {t('common.location')}: {location}
        </p>
      )}

      {/* Each line carries its own label, because the facts under a name are
          not all the same kind of fact the way an item's shelf always is. */}
      {lines.map((line) => (
        <p className={styles.cardMeta} key={line}>
          {line}
        </p>
      ))}

      {field !== null && <p className={styles.cardMeta}>{field}</p>}

      <p className={styles.change}>
        {before !== null && (
          <>
            <span className={styles.before}>{before}</span>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <span className="sr-only">{t('voice.becomes')}</span>
          </>
        )}
        <span className={styles.after}>{after}</span>
      </p>

      {/*
        Named on the button as well as shown, through `aria-describedby`. Focus
        lands on Confirm, so a description attached anywhere else is a
        description nobody reading with their ears would ever reach.
      */}
      {guesses.length > 0 && (
        <div className={styles.guesses} id={guessesId}>
          <p className={styles.cardMeta}>{t('voice.assumedTitle')}</p>
          <ul className={styles.guessList} role="list">
            {guesses.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          ref={confirmRef}
          variant="primary"
          disabled={busy}
          aria-label={t('voice.confirmAction', { detail })}
          aria-describedby={guesses.length === 0 ? undefined : guessesId}
          onClick={onConfirm}
        >
          {t('voice.confirm')}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {t('voice.cancel')}
        </Button>
      </div>
    </section>
  );
}
