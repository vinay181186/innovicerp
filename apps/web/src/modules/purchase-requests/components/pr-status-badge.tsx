// PR status → legacy .badge .b-* class (UI-002).
// Colours follow legacy renderPurchaseRequests `stColor` (L6253): Pending
// (=`open` here) amber → Approved blue → PO Created green → Cancelled red.
// The port previously used blue/cyan/green/grey, which signalled `open` as
// steady-state and `cancelled` as neutral — legacy flags both.

import type { PrStatus } from '@innovic/shared';

const CLASSES: Record<PrStatus, string> = {
  open: 'b-amber',
  approved: 'b-blue',
  po_created: 'b-green',
  cancelled: 'b-red',
};

export function PrStatusBadge(props: { status: PrStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{props.status.replaceAll('_', ' ')}</span>;
}
