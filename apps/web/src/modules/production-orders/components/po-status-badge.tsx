// Production Order header status → legacy .badge .b-* class. Three states
// (packages/shared/src/enums/production-order-status.ts, ADR-179):
//   open             = nothing credited yet
//   partially_closed = some finished pieces credited, more still to come
//   closed           = fully credited (or closed short)
// JC progress has its own badge (JcStatusBadge) — this tracks close only.

import type { ProductionOrderStatus } from '@innovic/shared';

const CLASSES: Record<ProductionOrderStatus, string> = {
  open: 'b-amber',
  // A distinct blue so a half-closed order reads apart from open (amber) and
  // closed (green) at a glance.
  partially_closed: 'b-blue',
  closed: 'b-green',
};

const LABELS: Record<ProductionOrderStatus, string> = {
  open: 'open',
  partially_closed: 'partially closed',
  closed: 'closed',
};

export function PoStatusBadge({ status }: { status: ProductionOrderStatus }): React.JSX.Element {
  return <span className={`badge ${CLASSES[status]}`}>{LABELS[status]}</span>;
}
