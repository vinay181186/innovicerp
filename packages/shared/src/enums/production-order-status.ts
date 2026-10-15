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
  partially_closed: 'Partly Closed',
  closed: 'Closed',
  short_closed: 'Short Closed',
};

/** An order that can no longer be worked on: nothing may be logged, inspected,
 *  dispatched, edited or spawned from its Job Card (ADR-182). */
export function isProductionOrderStopped(status: ProductionOrderStatus): boolean {
  return status === 'short_closed';
}

/** ADR-233 — `Short Closed Qty`: pieces of the order that will never reach
 *  stock because the order was ended under target, by Finish Short (status
 *  `closed`, credited < order) or by Short Close (`short_closed`). It is
 *  Order Qty − Stock Received, and it INCLUDES any Lost Qty (NC scrap): Lost
 *  is the scrapped part of it, not a separate amount. 0 while the order is
 *  still open or partly closed — those pieces are Pending, not short.
 *
 *  Worked out, never stored: Order and Stock Received are stored, a Short
 *  Close cannot be reversed, and reversing a Finish Short re-opens the order
 *  (so this returns 0 again). The SQL twin is `PRO_SHORT_CLOSED_QTY_SQL` in
 *  apps/api/src/modules/production-orders — change both together. */
export function productionOrderShortClosedQty(order: {
  status: ProductionOrderStatus;
  orderQty: number;
  creditedQty: number | null;
}): number {
  if (order.status !== 'closed' && order.status !== 'short_closed') return 0;
  return Math.max(0, order.orderQty - (order.creditedQty ?? 0));
}
