// Production Order header status → legacy .badge .b-* class. Four states
// (packages/shared/src/enums/production-order-status.ts, ADR-179 + ADR-182):
//   open             = nothing credited yet
//   partially_closed = some finished pieces credited, more still to come
//   closed           = fully credited (or closed short — then "Closed (Short N)")
//   short_closed     = STOPPED at some stage — nothing further may be done on
//                      the order or its Job Card, and the un-produced qty went
//                      back to the plan's Pending
// JC progress has its own badge (JcStatusBadge) — this tracks close only.
//
// The words come from the shared label map so the badge, the filter tiles and
// the report all read the same.

import { PRODUCTION_ORDER_STATUS_LABEL, type ProductionOrderStatus } from '@innovic/shared';

const CLASSES: Record<ProductionOrderStatus, string> = {
  // Wave 2 (owner): one colour per state across Plan / PO / JC / Op badges —
  // open = blue (not started), partly closed = amber (under way).
  open: 'b-blue',
  partially_closed: 'b-amber',
  closed: 'b-green',
  // Grey: a stopped order is a dead end, not a finished one (R5 palette).
  short_closed: 'b-grey',
};

const LABELS: Record<ProductionOrderStatus, string> = {
  open: 'Open',
  partially_closed: 'Partly Closed',
  closed: 'Closed',
  short_closed: PRODUCTION_ORDER_STATUS_LABEL.short_closed,
};

/** ADR-233 — the badge names how much was short-closed, so an order ended
 *  under target never reads as a plain "Closed": `Closed (Short 4)` for a
 *  Finish Short, `Short Closed (4)` for a stopped order. `shortClosedQty` is
 *  the server's `productionOrderShortClosedQty` (0 while open / partly closed). */
function labelFor(status: ProductionOrderStatus, shortClosedQty: number): string {
  if (shortClosedQty > 0 && status === 'closed') {
    return `${LABELS.closed} (Short ${shortClosedQty})`;
  }
  if (shortClosedQty > 0 && status === 'short_closed') {
    return `${LABELS.short_closed} (${shortClosedQty})`;
  }
  return LABELS[status];
}

export function PoStatusBadge({
  status,
  draft,
  shortClosedQty = 0,
}: {
  status: ProductionOrderStatus;
  draft?: boolean | undefined;
  /** ADR-233 `Short Closed Qty` — omit (0) where the screen does not carry it. */
  shortClosedQty?: number | undefined;
}): React.JSX.Element {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status.
  if (draft) {
    return (
      <span className="badge b-grey" title="An edit to this document is waiting for approval">
        Draft
      </span>
    );
  }
  return <span className={`badge ${CLASSES[status]}`}>{labelFor(status, shortClosedQty)}</span>;
}
