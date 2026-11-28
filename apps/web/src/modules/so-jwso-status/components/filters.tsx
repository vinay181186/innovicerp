// SO / JWSO status (ADR-325/326) — the filter-row pieces both pages share: a
// labelled group (label above, control at the input's height, so every group
// sits on one line with the From / To boxes) and a one-of-several button strip.

import type { ReactNode } from 'react';

/** A label above a control, level with the ReportFilter boxes beside it. */
export function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sjs-f" role="group" aria-label={label}>
      <span className="form-label">{label}</span>
      <div className="sjs-ctl">{children}</div>
    </div>
  );
}

/** One-of-several buttons (Quick range, Days, Show). `value` may match none. */
export function SegButtons<V extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: V; label: string }[];
  value: V | null;
  onChange: (v: V) => void;
}): React.JSX.Element {
  return (
    <div className="sjs-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`btn ${o.value === value ? 'btn-primary' : 'btn-ghost'}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
