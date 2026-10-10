// PR status → .badge .b-* class (UI-002).
// One colour per status across the app (R5 settled map, same as the PO badge):
// Open / Approved (awaiting the next step) blue → PO Created green →
// Cancelled grey.

import type { PrStatus } from '@innovic/shared';
import { PR_STATUS_LABELS } from '../lib/pr-labels';

const CLASSES: Record<PrStatus, string> = {
  open: 'b-blue',
  approved: 'b-blue',
  po_created: 'b-green',
  cancelled: 'b-grey',
};

export function PrStatusBadge(props: { status: PrStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status.
  if (props.draft) {
    return (
      <span className="badge b-grey" title="An edit to this document is waiting for approval">
        Draft
      </span>
    );
  }
  return <span className={`badge ${CLASSES[props.status]}`}>{PR_STATUS_LABELS[props.status]}</span>;
}
