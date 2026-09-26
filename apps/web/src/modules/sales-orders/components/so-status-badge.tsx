// SO status → legacy .badge .b-* class (UI-002).
// Mapping per docs/STYLE_GUIDE.md "SO (Sales Order) status → badge class".

import type { SoStatus } from '@innovic/shared';
import { SO_STATUS_LABEL } from '../lib/so-status-label';

const CLASSES: Record<SoStatus, string> = {
  draft: 'b-amber',
  open: 'b-blue',
  closed: 'b-green',
  dispatched: 'b-cyan',
  cancelled: 'b-grey',
};

export function SoStatusBadge(props: { status: SoStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{SO_STATUS_LABEL[props.status]}</span>;
}
