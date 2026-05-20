// PO status → legacy .badge .b-* class (UI-002).
// draft=grey (pre-active) → open=blue (active) → partial/qc_pending=amber
// (mid-state) → closed=green (terminal good) → cancelled=grey.

import type { PoStatus } from '@innovic/shared';

const CLASSES: Record<PoStatus, string> = {
  draft: 'b-grey',
  open: 'b-blue',
  partial: 'b-amber',
  qc_pending: 'b-amber',
  closed: 'b-green',
  cancelled: 'b-grey',
};

export function PoStatusBadge(props: { status: PoStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{props.status.replaceAll('_', ' ')}</span>;
}
