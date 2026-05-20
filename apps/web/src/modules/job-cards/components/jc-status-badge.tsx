// JC computed_status → legacy .badge .b-* class (UI-002).
// Mapping per docs/STYLE_GUIDE.md "JC (Job Card) status → badge class".

import type { JcComputedStatus } from '@innovic/shared';

const CLASSES: Record<JcComputedStatus, string> = {
  open: 'b-grey',
  qc_pending: 'b-amber',
  complete: 'b-cyan',
  closed: 'b-green',
  no_ops: 'b-red',
};

const LABELS: Record<JcComputedStatus, string> = {
  open: 'open',
  qc_pending: 'qc pending',
  complete: 'complete',
  closed: 'closed',
  no_ops: 'no ops',
};

export function JcStatusBadge(props: { status: JcComputedStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{LABELS[props.status]}</span>;
}
