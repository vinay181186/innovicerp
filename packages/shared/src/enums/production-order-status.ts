// Production Order (IN-PRO-#####) header status. Migration 0133; partial close
// added in ADR-179 (migration 0140-series).
//
// - open            nothing credited yet
// - partially_closed  some finished pieces credited, more still to come
// - closed          fully credited (credited_qty = order_qty) OR closed short
// - short_closed    stopped at ANY stage (ADR-182): nothing further may be
//                   done on the order or its Job Card, and the un-produced
//                   balance returns to the plan's pending qty
//
// Job-Card progress ("is the JC finished yet?") is still READ off
// `v_jc_status.computed_status`, never copied here. This header status tracks
// only how much of the order has been closed-and-credited.
export const PRODUCTION_ORDER_STATUSES = [
  'open',
  'partially_closed',
  'closed',
  'short_closed',
] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

/** Screen labels — NAMING.md: the document is a "Production Order", never "PO". */
export const PRODUCTION_ORDER_STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  open: 'Open',
  partially_closed: 'Partially Closed',
  closed: 'Closed',
  short_closed: 'Short Closed',
};

/** An order that can no longer be worked on: nothing may be logged, inspected,
 *  dispatched, edited or spawned from its Job Card (ADR-182). */
export function isProductionOrderStopped(status: ProductionOrderStatus): boolean {
  return status === 'short_closed';
}
