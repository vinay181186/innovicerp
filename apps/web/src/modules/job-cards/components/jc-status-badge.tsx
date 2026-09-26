// JC computed_status → legacy .badge .b-* class (UI-002).
// Mapping per docs/STYLE_GUIDE.md "JC (Job Card) status → badge class".

import type { JcComputedStatus } from '@innovic/shared';

const CLASSES: Record<JcComputedStatus, string> = {
  open: 'b-grey',
  qc_pending: 'b-amber',
  complete: 'b-green', // wave 2: finished = green on every badge
  closed: 'b-green',
  no_ops: 'b-red',
};

export const JC_STATUS_LABEL: Record<JcComputedStatus, string> = {
  open: 'Open',
  qc_pending: 'QC Pending',
  complete: 'Completed',
  closed: 'Closed',
  no_ops: 'No Operations',
};

export function JcStatusBadge(props: { status: JcComputedStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{JC_STATUS_LABEL[props.status]}</span>;
}
