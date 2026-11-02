// ADR-265 — the Approval Type filter: the standard select whose option labels
// carry the counts ("All (12)", "Purchase Order (3)" …). Only types with rows
// are offered (the server's `counts`); a picked type that has emptied falls
// back to All (`effectiveType`).

import type { ApprovalTypeCount } from '@innovic/shared';

export const ALL_TYPES = '';

export function ApprovalTypeSelect({
  value,
  counts,
  total,
  onChange,
}: {
  value: string;
  counts: readonly ApprovalTypeCount[];
  total: number;
  onChange: (typeKey: string) => void;
}): React.JSX.Element {
  return (
    <select
      className="innovic-select"
      aria-label="Approval Type"
      title="Approval Type"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={ALL_TYPES}>All ({total})</option>
      {counts.map((c) => (
        <option key={c.typeKey} value={c.typeKey}>
          {c.typeLabel} ({c.n})
        </option>
      ))}
    </select>
  );
}

/** The picked type, or All when that type no longer has rows. */
export function effectiveType(value: string, counts: readonly ApprovalTypeCount[]): string {
  return value !== ALL_TYPES && counts.some((c) => c.typeKey === value) ? value : ALL_TYPES;
}
