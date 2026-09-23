// Select — the native dropdown, styled like Input (.innovic-select).
//
// This is for a SHORT, fixed list that comes from a master-driven enum (type,
// status, UOM, unit). A master or document picker — client, vendor, item, SO,
// job card — is never a Select: it is SearchableSelect, which searches the
// server and shows "CODE — Name".

import { forwardRef } from 'react';
import { cx } from './class-names';
import type { FieldWidth } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Options as plain strings (value === label) or {value,label}. */
  options?: ReadonlyArray<string | SelectOption> | undefined;
  /**
   * Shown as the empty first option (value ""), e.g. "Select type…". It is
   * `disabled hidden`: it is the "nothing picked yet" state, not a choice, so
   * a required select cannot be emptied again after a real pick. A field where
   * "none" IS a legitimate answer offers it as a real option instead —
   * `{ value: '', label: '— None —' }` in `options`.
   */
  placeholder?: string | undefined;
  /** Off-grid width (.fw-*). Inside a FormGrid the FormField sizes the field instead. */
  fieldWidth?: FieldWidth | undefined;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options = [], placeholder, fieldWidth, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx('innovic-select', fieldWidth && `fw-${fieldWidth}`, className)}
      {...rest}
    >
      {/* NOT `disabled hidden`: the HTML reset algorithm selects the first
          option that is not disabled, so a disabled placeholder is skipped and
          an uncontrolled select opens on the first real option instead of the
          prompt. Left selectable; `required` is what stops "" being submitted. */}
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ),
      )}
      {children}
    </select>
  );
});
