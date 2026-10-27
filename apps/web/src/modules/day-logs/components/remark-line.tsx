// The Remark line under a sheet row (owner 2026-10-27: "Remark BELOW each
// row, one line per row, where the user can type a long note"). The first
// cell stays empty under "#"; one cell spans every other column.
//   RemarkLine     — read view: "Remark: …", wrapping, only when there is one.
//   RemarkEditLine — a full-width textarea (2 rows, grows with the text,
//                    resizable). Enter is a plain newline — never a new row.
// The row above passes NO_GAP on its <tr> so no rule shows between the two.

import { useLayoutEffect, useRef } from 'react';

/** On the row above a remark line: hides the rule between the two lines
 *  (the theme hands a <tr>'s inline border-bottom to its cells). */
export const NO_GAP: React.CSSProperties = { borderBottom: 'none' };

export function RemarkLine({
  text,
  span,
  tint,
}: {
  text: string | null;
  /** Columns the remark cell spans (all but "#"). */
  span: number;
  tint: React.CSSProperties;
}): React.JSX.Element | null {
  if (!text?.trim()) return null;
  return (
    <tr style={tint}>
      <td />
      <td
        colSpan={span}
        className="td-left"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text2)' }}
      >
        <span className="text3">Remark:</span> {text}
      </td>
    </tr>
  );
}

export function RemarkEditLine({
  value,
  onChange,
  required,
  disabled,
  span,
  tint,
}: {
  value: string;
  onChange: (v: string) => void;
  /** "Remark *" (Work / Others) or "Remark" (Break). */
  required: boolean;
  disabled: boolean;
  span: number;
  tint: React.CSSProperties;
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow with the text (the theme caps a textarea's height).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <tr style={tint}>
      <td />
      <td colSpan={span} className="td-left">
        <textarea
          ref={ref}
          className="innovic-textarea"
          aria-label={required ? 'Remark *' : 'Remark'}
          rows={2}
          maxLength={2000}
          placeholder={required ? 'Remark *' : 'Remark'}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </td>
    </tr>
  );
}
