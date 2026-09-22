// Production Order (IN-PRO-#####) header status. Migration 0133; partial close
// added in ADR-179 (migration 0140-series).
//
// - open            nothing credited yet
// - partially_closed  some finished pieces credited, more still to come
// - closed          fully credited (credited_qty = order_qty) OR closed short
//
// Job-Card progress ("is the JC finished yet?") is still READ off
// `v_jc_status.computed_status`, never copied here. This header status tracks
// only how much of the order has been closed-and-credited.
export const PRODUCTION_ORDER_STATUSES = ['open', 'partially_closed', 'closed'] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];
