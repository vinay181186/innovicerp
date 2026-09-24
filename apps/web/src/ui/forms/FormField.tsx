// FormField — the one labelled form group.
//
// .form-grp → .form-label (11px mono uppercase, ★ in --red2 when required) →
// the control → .form-help, or .form-error when the field is in error.
//
// Width comes from `size` on the 12-column FormGrid and is chosen by CONTENT
// TYPE, never by position:
//   xs   2/12  %, rev, line no., days, UOM, short code
//   sm   3/12  qty, rate, amount, date, doc number
//   md   4/12  select / type, ref no., phone, item code   (default)
//   lg   6/12  party (client / vendor), item name, email
//   full 12/12 remarks, address, any textarea
//
// Off-grid controls (table cells, toolbars) are not FormFields — they use the
// .fw-* width classes instead (Input's `fieldWidth` prop).
//
// `span` is the legacy partner of FormGrid's legacy `cols`: on an equal-column
// grid (.form-grid / -3 / -4) the 12-column .f-* spans are meaningless, so a
// field there says span={2} / span="full" and gets .form-span-2 / .form-full.
// New forms use the 12-column grid and `size`, and never pass either.

import type { ReactNode } from 'react';
import { cx } from './class-names';

export type FormFieldSize = 'xs' | 'sm' | 'md' | 'lg' | 'full';

const SIZE_CLASS: Record<FormFieldSize, string> = {
  xs: 'f-xs',
  sm: 'f-sm',
  md: 'f-md',
  lg: 'f-lg',
  full: 'f-full',
};

export interface FormFieldProps {
  label: ReactNode;
  /** Renders the ★ required marker after the label. */
  required?: boolean | undefined;
  /** Quiet 11px note under the control. Hidden while `error` is set. */
  help?: ReactNode | undefined;
  /** 11px red note under the control; replaces `help` while it is set. */
  error?: ReactNode | undefined;
  /** Field width on the 12-column grid, by content type. Default 'md'. */
  size?: FormFieldSize | undefined;
  /**
   * @deprecated Legacy equal-column grids only (`<FormGrid cols={2|3|4}>`),
   * where the 12-column `.f-*` spans mean nothing — `.f-md` is `span 4`, which
   * inside `.form-grid-4` is the whole row. Emits `.form-full` / `.form-span-2`
   * so those grids still lay out, and picks the matching `size` when none is
   * given: 'full' → full, 2 → lg. Omit it on the canonical 12-column grid.
   */
  span?: 'full' | 2 | undefined;
  /** id of the control inside, so clicking the label focuses it. */
  htmlFor?: string | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
}

export function FormField({
  label,
  required = false,
  help,
  error,
  size,
  span,
  htmlFor,
  className,
  children,
}: FormFieldProps): React.JSX.Element {
  // design-ref/components/forms/FormField.jsx:5-6 — `size` wins; `span` only
  // supplies a default and its own legacy class.
  const resolved: FormFieldSize = size ?? (span === 'full' ? 'full' : span === 2 ? 'lg' : 'md');
  const spanClass = span === 'full' ? 'form-full' : span === 2 ? 'form-span-2' : undefined;

  return (
    <div className={cx('form-grp', SIZE_CLASS[resolved], spanClass, className)}>
      <label className="form-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="req">★</span> : null}
      </label>
      {children}
      {error ? (
        <div className="form-error">{error}</div>
      ) : help ? (
        <div className="form-help">{help}</div>
      ) : null}
    </div>
  );
}
