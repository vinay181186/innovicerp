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

/** The pending change for a LINE field. Line changes carry a composite field
 *  key `line:<lineId>:<attr>` (attr = item | qty | rate) so each line's change
 *  is matched exactly by the line's id — no reliance on label wording. */
export function linePendingChange(
  changes: readonly DocumentEditChange[],
  lineId: string,
  attr: 'item' | 'qty' | 'rate',
): DocumentEditChange | undefined {
  const key = `line:${lineId}:${attr}`;
  return changes.find((c) => c.field === key);
}
