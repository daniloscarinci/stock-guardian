/**
 * Form controls.
 *
 * Every control is bound to a real `<label>` and, where it has help text or an
 * error, to those too through `aria-describedby`. The original application had
 * no labels at all - only placeholders, which are not an accessible name and
 * disappear the moment someone types.
 */
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';
import styles from './Field.module.css';

interface FieldShellProps {
  readonly label: string;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly optionalLabel?: string | undefined;
  readonly children: (props: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
}

function FieldShell({ label, help, error, optionalLabel, children }: FieldShellProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  const describedBy =
    [help !== undefined ? helpId : null, error !== undefined ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optionalLabel !== undefined && <span className={styles.optional}>{optionalLabel}</span>}
      </label>
      {children({ id, describedBy, invalid: error !== undefined })}
      {help !== undefined && (
        <p className={styles.help} id={helpId}>
          {help}
        </p>
      )}
      {error !== undefined && (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-describedby'> {
  readonly label: string;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly optionalLabel?: string | undefined;
}

export function TextField({ label, help, error, optionalLabel, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} help={help} error={error} optionalLabel={optionalLabel}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className={cx(styles.control, invalid && styles.invalid)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'aria-describedby'> {
  readonly label: string;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly optionalLabel?: string | undefined;
  readonly children: ReactNode;
}

export function SelectField({
  label,
  help,
  error,
  optionalLabel,
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldShell label={label} help={help} error={error} optionalLabel={optionalLabel}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className={cx(styles.select, invalid && styles.invalid)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'aria-describedby'> {
  readonly label: string;
  readonly help?: string | undefined;
  readonly error?: string | undefined;
  readonly optionalLabel?: string | undefined;
}

export function TextAreaField({
  label,
  help,
  error,
  optionalLabel,
  ...rest
}: TextAreaFieldProps) {
  return (
    <FieldShell label={label} help={help} error={error} optionalLabel={optionalLabel}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          className={cx(styles.textarea, invalid && styles.invalid)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

/** A labelled checkbox or radio rendered as a pill. */
export function OptionChip({
  type = 'checkbox',
  checked,
  onChange,
  name,
  children,
}: {
  readonly type?: 'checkbox' | 'radio' | undefined;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly name?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <label className={cx(styles.option, checked && styles.optionChecked)}>
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {children}
    </label>
  );
}

export function SwitchRow({
  label,
  help,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly help?: string | undefined;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className={styles.switchRow}>
      <span className={styles.switchText}>
        <label className={styles.switchLabel} htmlFor={id}>
          {label}
        </label>
        {help !== undefined && (
          <span className={styles.help} id={helpId}>
            {help}
          </span>
        )}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-describedby={help === undefined ? undefined : helpId}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </div>
  );
}

export { styles as fieldStyles };
