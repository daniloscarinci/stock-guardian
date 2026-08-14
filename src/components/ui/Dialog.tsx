/**
 * A modal dialog built on the native `<dialog>` element.
 *
 * `showModal()` gives focus trapping, Escape-to-close, inertness of the page
 * behind, and correct screen-reader semantics from the platform - all things a
 * hand-rolled overlay gets subtly wrong. On narrow screens the same component
 * becomes a bottom sheet through CSS alone.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './primitives';
import { CloseIcon } from './icons';
import styles from './Dialog.module.css';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: ReactNode;
  readonly footer?: ReactNode | undefined;
  readonly wide?: boolean | undefined;
  readonly closeLabel: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
  closeLabel,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // Fires for Escape as well as for `close()`, so the parent's state stays in
    // step however the dialog was dismissed.
    const handleClose = () => {
      onClose();
    };
    element.addEventListener('close', handleClose);
    return () => {
      element.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${wide ? styles.wide : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      // Clicking the backdrop closes: the click lands on the dialog element
      // itself only when it is outside the inner content box.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className={styles.inner}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description !== undefined && (
              <p className={styles.description} id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <Button variant="ghost" iconOnly onClick={onClose} aria-label={closeLabel}>
            <CloseIcon />
          </Button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer !== undefined && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}

/**
 * A confirmation dialog for destructive actions.
 *
 * Deliberately not `window.confirm`, which the original used: it cannot be
 * translated beyond the browser's own buttons, cannot explain consequences, and
 * cannot offer a safer alternative alongside the destructive one.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  closeLabel,
  alternative,
  destructive = true,
}: {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly closeLabel: string;
  readonly alternative?: ReactNode | undefined;
  readonly destructive?: boolean | undefined;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      closeLabel={closeLabel}
      footer={
        <>
          <Button onClick={onCancel}>{cancelLabel}</Button>
          {alternative}
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}
