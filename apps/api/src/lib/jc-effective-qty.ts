// ADR-185 — ONE definition of "JC Qty": how much of an order line a Job Card
// really stands for. A card still being made counts its Order Qty. A card
// whose Production Order has STOPPED ('closed' or 'short_closed') counts only
// what that order credited to stock — the rest went back to the plan's
// Pending (lib/plan-order-coverage.ts, the same rule). Every screen that
// states a JC Qty for an SO / JW line sums this expression, so the SO list,
// the SO detail, the Job Card source picker and the JW list can never
// disagree with the plan's Covered figure.
//
// `alias` is the SQL name the caller gave the job_cards row ('jc',
// '"job_cards"', …). Raw SQL on purpose: it is spliced into both drizzle
// `sql` templates and hand-written sql.raw / execute() queries.

import { sql, type SQL } from 'drizzle-orm';

export function jcEffectiveQtyRaw(alias: string): string {
  return `COALESCE((
    SELECT CASE WHEN po_e.status IN ('closed', 'short_closed')
                THEN COALESCE(po_e.credited_qty, 0) END
    FROM public.production_orders po_e
    WHERE po_e.job_card_id = ${alias}.id AND po_e.deleted_at IS NULL
    ORDER BY po_e.created_at DESC
    LIMIT 1
  ), ${alias}.order_qty)`;
}

export function jcEffectiveQtySql(alias: string): SQL<number> {
  return sql<number>`${sql.raw(jcEffectiveQtyRaw(alias))}`;
}

/** ADR-185 — what a still-open Job Card has yet to put into stock: its Order
 *  Qty less what its Production Order already credited (0 credited for a card
 *  with no order). A partly closed order's credited pieces are already in
 *  stock and must not be counted "in production" as well. */
export function jcPendingToStockQtySql(alias: string): SQL<number> {
  return sql<number>`${sql.raw(`GREATEST(${alias}.order_qty - COALESCE((
    SELECT po_o.credited_qty FROM public.production_orders po_o
    WHERE po_o.job_card_id = ${alias}.id AND po_o.deleted_at IS NULL
    ORDER BY po_o.created_at DESC LIMIT 1
  ), 0), 0)`)}`;
}
