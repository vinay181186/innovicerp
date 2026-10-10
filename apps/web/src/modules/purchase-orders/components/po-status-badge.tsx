// PO status → legacy .badge .b-* class (UI-002).
// draft=grey (pre-active) → open=blue (active) → closed=green (terminal good)
// → cancelled=grey.
//
// ADR-222: the retired `partial` / `qc_pending` codes take the SAME blue as
// open, so one of the seven old rows that still hold them is indistinguishable
// from an Open order — which is what it is. Both keys stay in the map only so
// those rows render; nothing writes them any more.

import type { PoStatus } from '@innovic/shared';
import { PO_STATUS_LABELS } from '../lib/po-labels';

export const PO_STATUS_BADGE_CLASSES: Record<PoStatus, string> = {
  draft: 'b-grey',
  open: 'b-blue',
  partial: 'b-blue',
  qc_pending: 'b-blue',
  closed: 'b-green',
  cancelled: 'b-grey',
};

export function PoStatusBadge(props: { status: PoStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status.
  if (props.draft) {
    return (
      <span className="badge b-grey" title="An edit to this document is waiting for approval">
        Draft
      </span>
    );
  }
  return (
    <span className={`badge ${PO_STATUS_BADGE_CLASSES[props.status]}`}>
      {PO_STATUS_LABELS[props.status]}
    </span>
  );
}
