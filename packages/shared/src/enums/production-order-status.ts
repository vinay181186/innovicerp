// Production Order (IN-PRO-#####) header status. Migration 0133.
//
// Only two states, on purpose: the order is either still being made or it has
// been closed. Everything in between ("is the Job Card finished yet?") is READ
// off the Job Card (`v_jc_status.computed_status`), never copied here — one
// source of truth for progress, one for the close.
export const PRODUCTION_ORDER_STATUSES = ['open', 'closed'] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];
