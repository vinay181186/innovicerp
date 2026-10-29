// "Working On" — the compulsory free text of every entry.
//   WorkBox  — the textarea of a new row and of "Edit Working on". It GROWS AS
//              YOU TYPE (auto height, no scrollbar, no resize handle). Enter
//              is a newline.
//   RowError — the red "Row N: …" line under a row.

import { useLayoutEffect, useRef } from 'react';

export const WORK_PLACEHOLDER = 'Working on * — work, lunch, meeting, leave…';

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
