// Edit-approval (ADR-202) — the inline "pending change" chip shown on a LIVE
// document's detail page next to a field that has an edit waiting for approval.
// NO banner, NO header status tag — just the per-cell chip: the current value,
// then → the proposed value in an amber `.tag`.

import type { ActivityChangeValue, DocumentEditChange } from '@innovic/shared';
import { groupChanges } from './change-groups';

function fmtVal(v: ActivityChangeValue): string {
  if (v === null || v === '') return '—';
  return String(v);
}

/** The amber "→ after" chip. Reuses the shared `.tag` + `.b-amber` classes.
 *  `label` names the field when the cell shows more than one (e.g. a PO line's
 *  Remarks cell carries both Remarks and Ram Remark). */
export function PendingChangeChip({
  after,
  label,
}: {
  after: ActivityChangeValue;
  label?: string;
}): React.JSX.Element {
  return (
    <span
      className="tag b-amber"
      style={{ marginLeft: 6 }}
      title="A change to this field is waiting for approval"
    >
      {label ? `${label} ` : ''}→ {fmtVal(after)}
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
 *  key `line:<lineId>:<attr>` (attr = item | qty | rate | material | remarks |
 *  bomType | rmGrade | rmSize, and on a PO line also itemName | dueDate | pr |
 *  ramRemark | lineRemarks) so each line's change is matched exactly by the
 *  line's id — no reliance on label wording. `material` / `remarks` are the
 *  per-line fields a Delivery Challan edit can change (ADR-202 Phase 3) alongside
 *  its qty; `bomType` / `rmGrade` / `rmSize` are the per-line BOM Master fields
 *  (keyed by the line's child item id). */
export function linePendingChange(
  changes: readonly DocumentEditChange[],
  lineId: string,
  attr:
    | 'item'
    | 'qty'
    | 'rate'
    | 'material'
    | 'remarks'
    | 'bomType'
    | 'rmGrade'
    | 'rmSize'
    | 'itemName'
    | 'dueDate'
    | 'pr'
    | 'ramRemark'
    | 'lineRemarks',
): DocumentEditChange | undefined {
  const key = `line:${lineId}:${attr}`;
  return changes.find((c) => c.field === key);
}

/** Every pending change on ONE line (or Delivery Schedule row) — the
 *  `line:<lineId>:<attr>` / `ms:<id>:<attr>` boxes plus its `line:remove:<lineId>`
 *  box. For a JWSO / SO line whose attr names are not in the union above. */
export function pendingLineChanges(
  changes: readonly DocumentEditChange[],
  rowId: string,
  scope: 'line' | 'ms' = 'line',
): DocumentEditChange[] {
  return changes.filter(
    (c) => c.field.startsWith(`${scope}:${rowId}:`) || c.field === `${scope}:remove:${rowId}`,
  );
}

/** ADR-202 — the pending LINE / Delivery Schedule changes of a document, one
 *  amber chip per box, grouped per line (change-groups.ts). Renders nothing
 *  when only header fields (or nothing) are waiting — those keep their per-cell
 *  chip. For detail pages whose line table has no per-cell chip. */
export function PendingLineChanges({
  changes,
}: {
  changes: readonly DocumentEditChange[];
}): React.JSX.Element | null {
  const groups = groupChanges(changes).filter((g) => g.key !== 'header');
  if (groups.length === 0) return null;
  return (
    <div
      role="status"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)', alignItems: 'center' }}
    >
      <span className="text3" style={{ fontWeight: 700 }}>
        Line changes waiting for approval:
      </span>
      {groups.flatMap((g) =>
        g.rows.map(({ change: c, kind, fieldLabel }) => (
          <span
            key={c.id}
            className={`tag ${kind === 'add' ? 'b-green' : kind === 'remove' ? 'b-red' : 'b-amber'}`}
            style={{ whiteSpace: 'normal' }}
            title="Waiting for approval"
          >
            {kind === 'edit'
              ? `${g.heading ?? ''} · ${fieldLabel}: ${fmtVal(c.before)} → ${fmtVal(c.after)}`
              : `${kind === 'add' ? '+' : '−'} ${c.label}`}
          </span>
        )),
      )}
    </div>
  );
}
