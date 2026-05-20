// PR status → legacy .badge .b-* class (UI-002).
// open=blue (active) → approved=cyan (progressing) → po_created=green
// (terminal — PR consumed by a PO) → cancelled=grey.

import type { PrStatus } from '@innovic/shared';

const CLASSES: Record<PrStatus, string> = {
  open: 'b-blue',
  approved: 'b-cyan',
  po_created: 'b-green',
  cancelled: 'b-grey',
};

export function PrStatusBadge(props: { status: PrStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{props.status.replaceAll('_', ' ')}</span>;
}
