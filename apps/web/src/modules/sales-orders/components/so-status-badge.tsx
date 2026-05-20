// SO status → legacy .badge .b-* class (UI-002).
// Mapping per docs/STYLE_GUIDE.md "SO (Sales Order) status → badge class".

import type { SoStatus } from '@innovic/shared';

const CLASSES: Record<SoStatus, string> = {
  open: 'b-blue',
  closed: 'b-green',
  dispatched: 'b-cyan',
  cancelled: 'b-grey',
};

export function SoStatusBadge(props: { status: SoStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{props.status}</span>;
}
