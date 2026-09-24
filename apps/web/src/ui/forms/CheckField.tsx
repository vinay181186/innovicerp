// CheckField — a native checkbox or radio with its label (.check-row).
//
// The box itself is a real <input>, tinted to the one Innovic blue by the
// theme; the whole row is the <label>, so clicking the text toggles it.
// `onChange` hands back the checked boolean, not the event.

import type { ReactNode } from 'react';
import { cx } from './class-names';

export interface CheckFieldProps {
  type?: 'checkbox' | 'radio' | undefined;
  label: ReactNode;
  /** Controlled state. Pass `defaultChecked` instead for an uncontrolled field. */
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onChange?: ((checked: boolean) => void) | undefined;
  /** Radios in one group share a name. */
  name?: string | undefined;
  value?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function CheckField({
  type = 'checkbox',
  label,
  checked,
  defaultChecked,
  onChange,
  name,
  value,
  id,
  disabled = false,
  className,
}: CheckFieldProps): React.JSX.Element {
  return (
    <label
      className={cx('check-row', className)}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <input
        type={type}
        id={id}
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
