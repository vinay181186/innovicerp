// Input — the one text / number / date box (.innovic-input).
//
// 13px Barlow, 28px tall like every other control, 1px --border, 6px radius,
// blue focus ring. Pair it with FormField for a label; a bare Input belongs
// only in a table cell or a toolbar, where `fieldWidth` gives it one of the
// four token widths instead of an inline pixel width.
//
// Dates are native type="date" (ISO). Numbers and codes take `mono`.
// Mouse-wheel editing of number inputs is already blocked app-wide by
// lib/number-wheel-guard.ts — no per-field handler is needed here.

import { forwardRef } from 'react';
import { cx } from './class-names';

/** Off-grid widths from the tokens: 64 / 104 / 144 / 224px. */
export type FieldWidth = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Validation / provenance state painted on the border:
 * ok = green, bad = red, derived = filled in from another document (grey wash).
 */
export type InputState = 'ok' | 'bad' | 'derived';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Off-grid width (.fw-*). Inside a FormGrid the FormField sizes the field instead. */
  fieldWidth?: FieldWidth | undefined;
  /** Border / background state: .is-ok · .is-bad · .is-derived. */
  state?: InputState | undefined;
  /** Render the value in the mono face — codes, IDs, quantities, dates. */
  mono?: boolean | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, fieldWidth, state, mono = false, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cx(
        'innovic-input',
        fieldWidth && `fw-${fieldWidth}`,
        state && `is-${state}`,
        mono && 'mono',
        className,
      )}
      {...rest}
    />
  );
});
