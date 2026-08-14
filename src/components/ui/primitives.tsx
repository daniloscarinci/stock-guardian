/**
 * Small, shared UI primitives.
 *
 * Deliberately plain: real `<button>` elements, real semantics, no library. The
 * original application used `<span onclick>` for its clickable catalog entries,
 * which cannot be focused or activated from a keyboard at all.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './primitives.module.css';

export type Tone = 'critical' | 'warning' | 'ok' | 'info' | 'neutral';

/* ---- Button --------------------------------------------------------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | undefined;
  readonly size?: 'medium' | 'small' | undefined;
  readonly iconOnly?: boolean | undefined;
  readonly fullWidth?: boolean | undefined;
}

export function Button({
  variant = 'secondary',
  size = 'medium',
  iconOnly = false,
  fullWidth = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    size === 'small' ? styles.small : '',
    iconOnly ? (size === 'small' ? styles.smallIcon : styles.iconOnly) : '',
    fullWidth ? styles.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

/* ---- Badge ---------------------------------------------------------------- */

/**
 * A status chip.
 *
 * `glyph` is not decoration. Status must never be carried by colour alone, so
 * each tone pairs its colour with a distinct shape and always shows its label.
 */
export function Badge({
  tone = 'neutral',
  glyph,
  children,
  title,
}: {
  readonly tone?: Tone | undefined;
  readonly glyph?: string | undefined;
  readonly children: ReactNode;
  readonly title?: string | undefined;
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={title}>
      {glyph !== undefined && (
        <span className={styles.badgeGlyph} aria-hidden="true">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}

/* ---- Card ----------------------------------------------------------------- */

export function Card({
  title,
  hint,
  actions,
  children,
  className,
  as: Element = 'section',
  ...rest
}: {
  readonly title?: ReactNode | undefined;
  readonly hint?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly as?: 'section' | 'div' | 'article' | undefined;
  readonly 'aria-labelledby'?: string | undefined;
}) {
  return (
    <Element className={`${styles.card} ${className ?? ''}`} {...rest}>
      {(title !== undefined || actions !== undefined) && (
        <header className={styles.cardHeader}>
          <div>
            {title !== undefined && <h2 className={styles.cardTitle}>{title}</h2>}
            {hint !== undefined && <p className={styles.cardHint}>{hint}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </Element>
  );
}

/* ---- Stat ----------------------------------------------------------------- */

export function Stat({
  label,
  value,
  hint,
  tone,
  onClick,
  ariaLabel,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly hint?: string | undefined;
  readonly tone?: 'critical' | 'warning' | 'ok' | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly ariaLabel?: string | undefined;
}) {
  const toneClass =
    tone === 'critical'
      ? styles.toneCritical
      : tone === 'warning'
        ? styles.toneWarning
        : tone === 'ok'
          ? styles.toneOk
          : '';

  const content = (
    <>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {hint !== undefined && <span className={styles.statHint}>{hint}</span>}
    </>
  );

  // A stat that filters the list is a button, not a div with a click handler:
  // it must be reachable and activatable from the keyboard.
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        className={`${styles.stat} ${styles.statInteractive} ${toneClass}`}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  }

  return <div className={`${styles.stat} ${toneClass}`}>{content}</div>;
}

/* ---- Empty state ---------------------------------------------------------- */

export function EmptyState({
  title,
  body,
  actions,
}: {
  readonly title: string;
  readonly body?: string | undefined;
  readonly actions?: ReactNode | undefined;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {body !== undefined && <p className={styles.emptyBody}>{body}</p>}
      {actions !== undefined && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}

/* ---- Loading -------------------------------------------------------------- */

export function Loading({ label }: { readonly label: string }) {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/* ---- Alert ---------------------------------------------------------------- */

export function Alert({
  tone = 'info',
  title,
  children,
  role = 'status',
}: {
  readonly tone?: Tone | undefined;
  readonly title?: string | undefined;
  readonly children?: ReactNode | undefined;
  readonly role?: 'status' | 'alert' | undefined;
}) {
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={role}>
      {title !== undefined && <p className={styles.alertTitle}>{title}</p>}
      {children}
    </div>
  );
}
