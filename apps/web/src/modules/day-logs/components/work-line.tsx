// "Working on" — the compulsory free text of every entry.
//   WorkLine — the read-only table's full-width line under a row (person
//              page): "Working on: …" (pre-wrap).
//   WorkText — My Day Log's one-line sheet (owner "Option B", 2026-10-27):
//              the text in its own cell (pre-wrap), with the small
//              "Waiting for approval → …" line of a pending edit and the
//              orange "Edit rejected: <reason>" line under it, same cell.
//   WorkBox  — the sheet's textarea in that cell. It GROWS AS YOU TYPE (auto
//              height, no scrollbar, no resize handle). Enter is a newline.
// NO_GAP goes on the table row above a WorkLine so no rule shows between.

import type { DayLogEntry } from '@innovic/shared';
import { useLayoutEffect, useRef } from 'react';
import { spanText } from '../lib/sheet';

/** On the row above a Working on line: hides the rule between the two lines
 *  (the theme hands a <tr>'s inline border-bottom to its cells). */
export const NO_GAP: React.CSSProperties = { borderBottom: 'none' };

export const WORK_PLACEHOLDER = 'Working on * — work, lunch, meeting, leave…';

/** The dark bold "Working on" label (owner 2026-10-27: must stand out). */
const LABEL: React.CSSProperties = { color: 'var(--text)', fontWeight: 700 };

type WorkFacts = Pick<DayLogEntry, 'description' | 'pending' | 'rejectReason'>;

export function WorkLine({ e, span }: { e: WorkFacts; span: number }): React.JSX.Element {
  return (
    <tr>
      <td />
      <td
        colSpan={span}
        className="td-left"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingTop: 0 }}
      >
        <span style={LABEL}>Working on:</span> {e.description}
      </td>
    </tr>
  );
}

/** A saved entry's Working on cell of the one-line sheet. */
export function WorkText({ e }: { e: WorkFacts }): React.JSX.Element {
  const p = e.pending;
  return (
    <div className="dl-wtxt">
      {e.description}
      {p ? (
        <div className="dl-small text3">
          Waiting for approval → {spanText(p.fromTime, p.toTime)}
          {p.order ? ` · ${p.order.code}` : ''} · {p.description}
        </div>
      ) : null}
      {!p && e.rejectReason ? (
        <div className="dl-small fw-700" style={{ color: 'var(--amber2)' }}>
          Edit rejected: {e.rejectReason}
        </div>
      ) : null}
    </div>
  );
}

/** The Working on box of a new / edited row; `children` go under it. */
export function WorkBox({
  value,
  onChange,
  disabled,
  placeholder = WORK_PLACEHOLDER,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
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
    <div className="dl-wcell">
      <textarea
        ref={ref}
        className="innovic-textarea dl-wbox"
        aria-label="Working on"
        rows={3}
        maxLength={2000}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {children}
    </div>
  );
}

/** The red "Row N: …" line, full width under its row. */
export function RowError({ text }: { text: string }): React.JSX.Element {
  return (
    <div role="alert" className="dl-err" style={{ color: 'var(--red2)', fontSize: 'var(--fs-xs)' }}>
      {text}
    </div>
  );
}
