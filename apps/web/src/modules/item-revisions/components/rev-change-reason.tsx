// "Reason for Rev change" (ADR-289) — the one box the SO and JWSO line forms
// show when a SAVED line's Drawing Rev is changed from the Rev it was loaded
// with. Sent as `revChangeReason` on that line. The server insists on it (min
// 5 characters) once the line already has a Plan / PRO / Job Card; the form
// asks for it on every Rev change so the person is never surprised by the
// round trip. The "cannot go backwards" guard (ADR-177) is separate and stays.

import { normalizeRevision, REV_CHANGE_REASON_MIN } from '@innovic/shared';
import { forwardRef } from 'react';

/** True when a saved line's Drawing Rev was changed. A new line (no saved Rev)
 *  never asks. */
export function drawingRevChanged(
  savedRev: string | null | undefined,
  typedRev: string | null | undefined,
): boolean {
  const saved = normalizeRevision(String(savedRev ?? ''));
  const typed = normalizeRevision(String(typedRev ?? ''));
  return saved !== '' && typed !== '' && saved !== typed;
}

/** The form's own refusal, named by line like the other line checks. */
export function revChangeReasonError(
  lineNo: number,
  reason: string | null | undefined,
): string | null {
  return String(reason ?? '').trim().length >= REV_CHANGE_REASON_MIN
    ? null
    : `Line ${lineNo}: give a reason for changing the Drawing Rev (at least ${REV_CHANGE_REASON_MIN} characters).`;
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  lineNo: number;
  savedRev: string;
};

/** The text box. Spread react-hook-form's `register(...)` straight onto it. */
export const RevChangeReasonInput = forwardRef<HTMLInputElement, InputProps>(
  function RevChangeReasonInput({ lineNo, savedRev, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className="innovic-input"
        autoComplete="off"
        maxLength={500}
        aria-label={`Reason for Rev change, line ${lineNo}`}
        title="Reason for Rev change"
        placeholder={`Reason for Rev change from ${normalizeRevision(savedRev)} ★`}
        style={{ marginTop: 'var(--sp-1)' }}
        {...rest}
      />
    );
  },
);
