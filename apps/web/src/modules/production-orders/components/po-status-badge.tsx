// Production Order header status → legacy .badge .b-* class. Four states
// (packages/shared/src/enums/production-order-status.ts, ADR-179 + ADR-182):
//   open             = nothing credited yet
//   partially_closed = some finished pieces credited, more still to come
//   closed           = fully credited (or closed short)
//   short_closed     = STOPPED at some stage — nothing further may be done on
//                      the order or its Job Card, and the un-produced qty went
//                      back to the plan's Pending
// JC progress has its own badge (JcStatusBadge) — this tracks close only.
//
// The words come from the shared label map so the badge, the filter tiles and
// the report all read the same.

import { PRODUCTION_ORDER_STATUS_LABEL, type ProductionOrderStatus } from '@innovic/shared';

const CLASSES: Record<ProductionOrderStatus, string> = {
  open: 'b-amber',
  // A distinct blue so a half-closed order reads apart from open (amber) and
  // closed (green) at a glance.
  partially_closed: 'b-blue',
  closed: 'b-green',
  // Red: a stopped order is a dead end, not a finished one.
  short_closed: 'b-red',
};

const LABELS: Record<ProductionOrderStatus, string> = {
  open: 'Open',
  partially_closed: 'Partly Closed',
  closed: 'Closed',
  short_closed: PRODUCTION_ORDER_STATUS_LABEL.short_closed,
};

export function PoStatusBadge({ status }: { status: ProductionOrderStatus }): React.JSX.Element {
  return <span className={`badge ${CLASSES[status]}`}>{LABELS[status]}</span>;
}
