/**
 * "Which one?" - a tie, offered rather than guessed.
 *
 * Two rules, both from `resolve.ts`, which never picks a winner among equals:
 *
 *   Each option shows its quantity as well as its name, so "the first one" has
 *   a visible referent and the choice can be made without opening the item.
 *
 *   When more matched than are listed, the list says so. `resolveItem` caps the
 *   offer at five; presenting five of forty as though it were the shortlist is
 *   a lie, and the honest response to forty is to ask for a clearer phrase.
 */
import { useId } from 'react';
import { useApp } from '../../app/AppContext';
import { Button } from '../../components/ui/primitives';
import { LOCALE_TAGS } from '../../i18n/translate';
import type { InventoryItemView } from '../../types/domain';
import styles from './Voice.module.css';

export function ChoiceList({
  items,
  total,
  busy,
  onChoose,
}: {
  readonly items: readonly InventoryItemView[];
  /** How many actually tied, before the cap. Never less than `items.length`. */
  readonly total: number;
  readonly busy: boolean;
  readonly onChoose: (item: InventoryItemView) => void;
}) {
  const { t, settings } = useApp();
  const headingId = useId();
  const number = new Intl.NumberFormat(LOCALE_TAGS[settings.language], {
    maximumFractionDigits: 3,
  });

  return (
    <div role="group" aria-labelledby={headingId}>
      <p id={headingId}>{t('voice.which')}</p>

      {total > items.length && (
        <p className={styles.capped}>
          {t('voice.whichOfMany', { shown: items.length, total })}
        </p>
      )}

      <ul className={styles.choices} role="list">
        {items.map((item) => (
          <li key={item.id}>
            <Button
              fullWidth
              disabled={busy}
              onClick={() => {
                onChoose(item);
              }}
            >
              {item.name}{' '}
              <span className={styles.choiceQuantity}>
                ({number.format(item.quantity)} {item.unit})
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
