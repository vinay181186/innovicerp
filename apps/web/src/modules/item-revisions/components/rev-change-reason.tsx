// "Reason for Rev change" (ADR-289) — the box the SO and JWSO line forms show
// when a SAVED line's Drawing Rev is changed from the Rev it was loaded with.
// Sent as `revChangeReason` on that line. The server insists on it (min
// 5 characters) once the line already has a Plan / PRO / Job Card; the form
// asks for it on every Rev change so the person is never surprised by the
// round trip. The "cannot go backwards" guard (ADR-177) is separate and stays.
//
// Shown as an orange full-width strip row (`RevChangeReasonRow`) right under
// the changed line — owner 26-Nov-2026: the box inside the narrow Rev cell was
// hard to find. The cursor jumps into it when it opens, the changed Rev box
// turns orange (`REV_CHANGED_INPUT_STYLE`), and the save error carries a
// "Go to reason box ↓" button (`RevReasonGoToButton`).

import { normalizeRevision, REV_CHANGE_REASON_MIN } from '@innovic/shared';
import { forwardRef, useEffect, useRef } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

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

const REV_REASON_ERROR_TEXT = 'give a reason for changing the Drawing Rev';

/** The form's own refusal, named by line like the other line checks. */
export function revChangeReasonError(
  lineNo: number,
  reason: string | null | undefined,
): string | null {
  return String(reason ?? '').trim().length >= REV_CHANGE_REASON_MIN
    ? null
    : `Line ${lineNo}: ${REV_REASON_ERROR_TEXT} (at least ${REV_CHANGE_REASON_MIN} characters).`;
}

/** True for the message `revChangeReasonError` builds (and the API's same
 *  sentence) — the error banner then offers "Go to reason box ↓". */
export function isRevChangeReasonError(msg: string | null | undefined): boolean {
  return Boolean(msg?.includes(REV_REASON_ERROR_TEXT));
}

/** The changed Rev box, while its reason strip is open. */
export const REV_CHANGED_INPUT_STYLE: React.CSSProperties = {
  border: '2px solid var(--amber)',
  background: 'var(--amber3)',
};

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

type RowProps = {
  /** Every column of the line table, so the strip runs edge to edge. */
  colSpan: number;
  lineNo: number;
  savedRev: string;
  newRev: string;
  /** The live typed reason (for the counter). */
  reason: string | null | undefined;
  /** `register('lines.N.revChangeReason')` — its ref is merged, not replaced. */
  registration: UseFormRegisterReturn;
};

/** The orange strip row under a line whose saved Rev was changed. Render it
 *  only when `drawingRevChanged(savedRev, typedRev)` is true. */
export function RevChangeReasonRow({
  colSpan,
  lineNo,
  savedRev,
  newRev,
  reason,
  registration,
}: RowProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  // Focus once, when the strip first opens after the Rev was changed. A strip
  // that opens already holding a reason (form draft restored) is left alone.
  // The strip mounts on the first changed keystroke, so while the person is
  // still typing in the Rev box (saved 0, typing "AB") the focus waits for
  // that box's `change` event (Tab / Enter / click away); the timeout lets a
  // Tab's own focus move finish first.
  const openedEmpty = useRef(String(reason ?? '').trim() === '');
  useEffect(() => {
    if (!openedEmpty.current) return undefined;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && !rowRef.current?.contains(active)) {
      let timer: number | undefined;
      const onChange = (): void => {
        timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      };
      active.addEventListener('change', onChange, { once: true });
      return () => {
        active.removeEventListener('change', onChange);
        window.clearTimeout(timer);
      };
    }
    inputRef.current?.focus();
    return undefined;
  }, []);
  const { ref: registerRef, ...registerRest } = registration;
  const n = String(reason ?? '').trim().length;
  const ok = n >= REV_CHANGE_REASON_MIN;
  const inputId = `rev-reason-line-${lineNo}`;
  return (
    <tr ref={rowRef}>
      <td
        colSpan={colSpan}
        style={{
          background: 'var(--amber3)',
          borderBottom: '2px solid var(--amber)',
          whiteSpace: 'normal',
          padding: 'var(--sp-2) var(--sp-3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <label htmlFor={inputId} className="fw-700">
            Line {lineNo} · Reason for Rev change from{' '}
            <span className="mono">{normalizeRevision(savedRev)}</span> to{' '}
            <span className="mono">{normalizeRevision(newRev)}</span> <span className="req">★</span>
          </label>
          <RevChangeReasonInput
            id={inputId}
            lineNo={lineNo}
            savedRev={savedRev}
            data-rev-reason-line={lineNo}
            placeholder="e.g. Wrong rev typed by mistake"
            style={{ flex: '1 1 240px', minWidth: 0, border: '2px solid var(--amber)' }}
            {...registerRest}
            ref={(el) => {
              registerRef(el);
              inputRef.current = el;
            }}
          />
          <span
            className={ok ? 'green fw-700' : 'text2'}
            style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}
          >
            {ok ? '✓ OK' : `${n} / ${REV_CHANGE_REASON_MIN} letters`}
          </span>
        </div>
      </td>
    </tr>
  );
}

/** Scrolls to, focuses and briefly flashes the first reason strip (inside the
 *  same form as `from`) whose reason is still short. */
export function goToFirstShortRevReason(from: HTMLElement): void {
  const root: ParentNode = from.closest('form') ?? document;
  const target = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[data-rev-reason-line]'),
  ).find((el) => el.value.trim().length < REV_CHANGE_REASON_MIN);
  if (!target) return;
  target.scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
  target.style.boxShadow = '0 0 0 4px var(--amber)';
  window.setTimeout(() => {
    target.style.boxShadow = '';
  }, 1000);
}

/** "Go to reason box ↓" — put it beside the rev-reason error message. */
export function RevReasonGoToButton(): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ marginLeft: 'var(--sp-2)' }}
      onClick={(e) => goToFirstShortRevReason(e.currentTarget)}
    >
      Go to reason box ↓
    </button>
  );
}
