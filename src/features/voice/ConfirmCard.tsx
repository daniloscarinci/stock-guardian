/**
 * What would be written, before it is.
 *
 * Nothing in the voice feature reaches a write path except the Confirm button
 * below; `services/voice/commit.ts` is the only module that writes, and this is
 * the only thing that calls it. The card therefore has to state the change
 * completely enough to be judged: which item, where it is, and the value it
 * holds now beside the value it would hold.
 *
 * Focus moves here on mount, and the button carries the whole change in its
 * accessible name. This feature exists for people who are not looking at the
 * screen, so that is the feature rather than a courtesy - a card that appeared
 * silently and left focus in the text box would be a card nobody heard.
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

/** The three writes, reduced to the four things the card shows. */
interface Described {
  readonly name: string;
  readonly location: string | null;
  /** null when there is no old value, which is only true of a creation. */
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
        before: `${quantity(language, write.item.quantity)} ${write.item.unit}`,
        after: `${quantity(language, write.after)} ${write.item.unit}`,
      };

    case 'EXPIRY': {
      const before = formatCalendarDate(write.before, dateFormat);
      return {
        name: write.item.name,
        location: write.item.locationName,
        // An item with no date has no old value to strike through, but "None"
        // is the true one and reads better than an empty space.
        before: before === '' ? t('common.none') : before,
        after: formatCalendarDate(write.after, dateFormat),
      };
    }

    case 'CREATE':
      return {
        name: write.name,
        location: write.locationName,
        before: null,
        after: `${quantity(language, write.quantity)} ${write.unit}`,
      };
  }
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
  const confirmRef = useRef<HTMLButtonElement>(null);

  // The card appears in response to something said, not to something clicked,
  // so nothing else is going to move focus onto it.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const { name, location, before, after } = describe(write, t, settings.language, settings.dateFormat);

  // The button's name has to survive being read on its own, out of the visual
  // context that makes "Confirm" mean anything.
  const detail =
    before === null ? `${name}, ${after}` : `${name}, ${before} ${t('voice.becomes')} ${after}`;

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

      <div className={styles.actions}>
        <Button
          ref={confirmRef}
          variant="primary"
          disabled={busy}
          aria-label={t('voice.confirmAction', { detail })}
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
