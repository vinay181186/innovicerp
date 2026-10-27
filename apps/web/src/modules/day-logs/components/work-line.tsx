// The full-width "Working on" line under EVERY sheet row (owner final
// 2026-10-27). The first cell stays empty under "#"; one cell spans the rest.
//   WorkLine     — read view: "Working on: …" (pre-wrap), plus the
//                  "Waiting for approval → …" line of a pending edit and the
//                  orange "Edit rejected: <reason>" line.
//   WorkEditLine — a textarea that GROWS AS YOU TYPE (auto height, no
//                  scrollbar, no resize handle). Enter is a plain newline.
// The row above passes NO_GAP on its <tr> so no rule shows between the two.

import type { DayLogEntry } from '@innovic/shared';
import { useLayoutEffect, useRef } from 'react';
import { spanText } from '../lib/sheet';

/** On the row above a Working on line: hides the rule between the two lines
 *  (the theme hands a <tr>'s inline border-bottom to its cells). */
export const NO_GAP: React.CSSProperties = { borderBottom: 'none' };

export const WORK_PLACEHOLDER =
  'Working on * — whatever you want to mention (work, lunch, meeting, leave…)';

const SMALL: React.CSSProperties = { fontSize: 'var(--fs-xs)', marginTop: 2 };

export function WorkLine({
  e,
  span,
  tint,
}: {
  e: Pick<DayLogEntry, 'description' | 'pending' | 'rejectReason'>;
  /** Columns the line spans (all but "#"). */
  span: number;
  tint?: React.CSSProperties | undefined;
}): React.JSX.Element {
  const p = e.pending;
  return (
    <tr style={tint}>
      <td />
      <td
        colSpan={span}
        className="td-left"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingTop: 0 }}
      >
        <span className="text3 fw-700">Working on:</span> {e.description}
        {p ? (
          <div className="text3" style={SMALL}>
            Waiting for approval → {spanText(p.fromTime, p.toTime)}
            {p.order ? ` · ${p.order.code}` : ''} · {p.description}
          </div>
        ) : null}
        {!p && e.rejectReason ? (
          <div style={{ ...SMALL, color: 'var(--amber2)', fontWeight: 700 }}>
            Edit rejected: {e.rejectReason}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

export function WorkEditLine({
  value,
  onChange,
  disabled,
  span,
  tint,
  placeholder = WORK_PLACEHOLDER,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  span: number;
  tint: React.CSSProperties;
  placeholder?: string;
  /** Shown under the box (the row's error). */
  children?: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow with the text: auto height, never a scrollbar.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <tr style={tint}>
      <td />
      <td colSpan={span} className="td-left" style={{ paddingTop: 0 }}>
        <textarea
          ref={ref}
          className="innovic-textarea"
          aria-label="Working on"
          rows={1}
          maxLength={2000}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: 'none', overflow: 'hidden', maxHeight: 'none', minHeight: 34 }}
        />
        {children}
      </td>
    </tr>
  );
}

/** The red line under a row's Working on box. */
export function RowError({ text }: { text: string }): React.JSX.Element {
  return (
    <div role="alert" style={{ color: 'var(--red2)', fontSize: 'var(--fs-xs)', paddingTop: 4 }}>
      {text}
    </div>
  );
}
