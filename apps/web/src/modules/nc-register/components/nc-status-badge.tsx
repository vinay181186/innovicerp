// NC status → legacy .badge .b-* class (UI-002).
// pending=amber (needs attention) → disposed=blue (action taken, in-flight)
// → rework_done=cyan (intermediate good) → closed=green (terminal good).
//
// QC–NC handling (docs/QC-NC-HANDLING-DESIGN.md §2): the four "recovery under
// way" statuses. under_* stay amber — the pieces are still ours and still need
// attention; sent_to_vendor / received_qc_pending are blue like `disposed` —
// the action is taken and the next move belongs to someone else (the vendor,
// then Incoming QC). Text comes from NC_STATUS_LABELS so the badge, the list
// filter and the document read the same words.

import { NC_STATUS_LABELS, type NcStatus } from '@innovic/shared';

const CLASSES: Record<NcStatus, string> = {
  pending: 'b-amber',
  disposed: 'b-blue',
  under_rework: 'b-amber',
  under_repair: 'b-amber',
  sent_to_vendor: 'b-blue',
  received_qc_pending: 'b-blue',
  rework_done: 'b-cyan',
  closed: 'b-green',
};

export function NcStatusBadge(props: { status: NcStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{NC_STATUS_LABELS[props.status]}</span>;
}
