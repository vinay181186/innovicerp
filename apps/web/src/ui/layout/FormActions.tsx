// FormActions — THE place for a create / edit form's buttons (owner 2026-11-04: every
// Save button at the bottom). It stays in view at the bottom edge while the form
// scrolls, so Save is never out of reach on a long form:
//
//                               [Not saved]  [Cancel] [Save as Draft] [Save SO]
//
// Put it as the page's LAST element, outside any Panel: a `.panel` clips what sticks.
// Cancel first, the primary Save last. Pop-ups use Modal's `footer` instead.

import type { ReactNode } from 'react';

export interface FormActionsProps {
  /** The buttons, Cancel (ghost) first and the primary Save last. */
  children: ReactNode;
  /** The form has unsaved edits: shows the "Not saved" pill. */
  dirty?: boolean | undefined;
  /** Left side of the bar: why Save is greyed, or a short status line. */
  note?: ReactNode | undefined;
}

export function FormActions({
  children,
  dirty = false,
  note,
}: FormActionsProps): React.JSX.Element {
  return (
    <div className="form-actions">
      {note ? <div className="form-actions-note">{note}</div> : null}
      {dirty ? (
        <span className="badge b-amber" role="status">
          Not saved
        </span>
      ) : null}
      {children}
    </div>
  );
}
