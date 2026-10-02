// Edit-approval (ADR-202) — the inline "pending change" chip shown on a LIVE
// document's detail page next to a field that has an edit waiting for approval.
// NO banner, NO header status tag — just the per-cell chip: the current value,
// then → the proposed value in an amber `.tag`.

import type { ActivityChangeValue, DocumentEditChange } from '@innovic/shared';

function fmtVal(v: ActivityChangeValue): string {
  if (v === null || v === '') return '—';
  return String(v);
}

/** The amber "→ after" chip. Reuses the shared `.tag` + `.b-amber` classes. */
export function PendingChangeChip({ after }: { after: ActivityChangeValue }): React.JSX.Element {
  return (
    <span
      className="tag b-amber"
      style={{ marginLeft: 6 }}
      title="A change to this field is waiting for approval"
    >
      → {fmtVal(after)}
    </span>
  );
}

/** The pending change for a header field, matched on the service field key the
 *  PO edit diff emits (poDate, poType, vendorId, remarks, dueDate, taxType …). */
export function headerPendingChange(
  changes: readonly DocumentEditChange[],
  field: string,
): DocumentEditChange | undefined {
  return changes.find((c) => c.field === field);
}

/** The pending change for a LINE field. The change object carries no line
 *  locator of its own (the frozen contract is {field,label,before,after,id}), so
 *  a line is matched when the change's label names it — "Line {lineNo}" — the
 *  same way the activity-log line reference reads. Degrades to no chip if the
 *  engine labels line changes differently. */
export function linePendingChange(
  changes: readonly DocumentEditChange[],
  lineNo: number,
  field: string,
): DocumentEditChange | undefined {
  const re = new RegExp(`\\bLine\\s*${lineNo}\\b`, 'i');
  return changes.find((c) => c.field === field && re.test(c.label));
}
