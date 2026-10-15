// ADR-233 — `Short Closed Qty`, the SQL twin of productionOrderShortClosedQty
// (@innovic/shared enums/production-order-status.ts). CHANGE BOTH TOGETHER.
//
//   status closed | short_closed  →  GREATEST(0, order_qty − COALESCE(credited_qty, 0))
//   any other status              →  0
//
// Worked out, never stored. The TS side is what every API response returns
// (toListItem); this twin exists only for SQL that has to sort / filter / report
// on the figure (sf-columns.ts, reports/definitions/production-orders.ts).

import { sql, type SQL } from 'drizzle-orm';

import { productionOrders } from '../../db/schema';

/** Raw SQL over a production_orders row the caller named `alias` ('po', …),
 *  for hand-written execute() queries. */
export function proShortClosedQtyRaw(alias: string): string {
  return `(CASE WHEN ${alias}.status IN ('closed', 'short_closed')
               THEN GREATEST(0, ${alias}.order_qty - COALESCE(${alias}.credited_qty, 0))
               ELSE 0 END)::int`;
}

/** The same rule over the drizzle `productionOrders` table (list / sf columns). */
export const PRO_SHORT_CLOSED_QTY_SQL: SQL<number> = sql<number>`(CASE WHEN ${productionOrders.status} IN ('closed', 'short_closed')
  THEN GREATEST(0, ${productionOrders.orderQty} - COALESCE(${productionOrders.creditedQty}, 0))
  ELSE 0 END)::int`;
