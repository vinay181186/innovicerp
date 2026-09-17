// Production Order header status → legacy .badge .b-* class. Two states only
// (packages/shared/src/enums/production-order-status.ts): open = still being
// made, closed = stock credited. JC progress has its own badge (JcStatusBadge).

import type { ProductionOrderStatus } from '@innovic/shared';

const CLASSES: Record<ProductionOrderStatus, string> = {
  open: 'b-amber',
  closed: 'b-green',
};

export function PoStatusBadge({ status }: { status: ProductionOrderStatus }): React.JSX.Element {
  return <span className={`badge ${CLASSES[status]}`}>{status}</span>;
}
