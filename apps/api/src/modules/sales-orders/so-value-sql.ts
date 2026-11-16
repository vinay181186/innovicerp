// ADR-303 — the SO Master's two money columns as SQL aggregates over the
// order's lines (alias `l`). Shared by the list SELECT (service.ts line_agg) and
// the Sort & Filter map (sf-columns.ts), so both read the same figure.

import { sql } from 'drizzle-orm';

/** ADR-303 — Total Value (Basic) of one order, over the `l` lines of a GROUP
 *  BY sales_order_id: Σ Order Qty × Rate of the non-cancelled lines, summed
 *  unrounded and rounded once to the paisa — the SQL twin of linesBasicTotal
 *  (packages/shared lib/line-value.ts) = the detail's totals.subtotal. */
export const SO_TOTAL_VALUE_BASIC_AGG = sql`ROUND(COALESCE(SUM(
    CASE WHEN l.status <> 'cancelled'
         THEN l.order_qty::numeric * COALESCE(l.rate, 0) ELSE 0 END), 0), 2)`;

/** ADR-303 — Value to Dispatch (NAMING.md): Σ (Order Qty − Dispatched −
 *  Short-closed qty, floor 0) × Rate over the non-cancelled lines, no GST. A
 *  short-closed line's short-closed qty is everything it had not dispatched, so
 *  it adds nothing. */
export const SO_VALUE_TO_DISPATCH_AGG = sql`ROUND(COALESCE(SUM(
    CASE WHEN l.status <> 'cancelled' AND l.short_closed_at IS NULL
         THEN GREATEST(l.order_qty - l.dispatched_qty, 0)::numeric * COALESCE(l.rate, 0)
         ELSE 0 END), 0), 2)`;
