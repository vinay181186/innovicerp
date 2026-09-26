// How much of each customer dispatch has been invoiced (ADR-189).
//
// There is no invoice → dispatch link: an invoice line points at the SO LINE
// (invoice_lines.sales_order_line_id), exactly as the SO detail's `billedQty`
// reads it. So the figure is derived per SO line, first-in-first-out: that
// line's invoiced qty is spread over its dispatches oldest first (dispatch
// date, then entry time, then line no), each dispatch line taking at most its
// own qty. Cancelled dispatches take nothing. The same rule gives the list and
// the detail the same number, and a dispatch is never shown as billed for
// more than it shipped.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';

export type BilledStatus = 'none' | 'partial' | 'full';

/** dispatch id → billed qty. `salesOrderId` narrows the work to one order
 *  (the detail read); omitted = every dispatch of the company (the list). */
export async function loadBilledQtyByDispatch(
  tx: DbTransaction,
  companyId: string,
  salesOrderId?: string,
): Promise<Map<string, number>> {
  const soFrag = salesOrderId ? sql`AND cd.sales_order_id = ${salesOrderId}::uuid` : sql``;
  const result = await tx.execute(sql`
    WITH inv AS (
      SELECT il.sales_order_line_id AS sol_id, SUM(il.qty) AS q
      FROM public.invoice_lines il
      JOIN public.invoices i ON i.id = il.invoice_id AND i.deleted_at IS NULL
      WHERE il.company_id = ${companyId}::uuid
        AND il.deleted_at IS NULL
        AND il.sales_order_line_id IS NOT NULL
      GROUP BY il.sales_order_line_id
    ),
    dl AS (
      SELECT cdl.customer_dispatch_id AS did, cdl.sales_order_line_id AS sol_id, cdl.qty,
             SUM(cdl.qty) OVER (
               PARTITION BY cdl.sales_order_line_id
               ORDER BY cd.dispatch_date, cd.created_at, cdl.line_no
               ROWS UNBOUNDED PRECEDING
             ) AS cum
      FROM public.customer_dispatch_lines cdl
      JOIN public.customer_dispatches cd
        ON cd.id = cdl.customer_dispatch_id AND cd.deleted_at IS NULL
      WHERE cd.company_id = ${companyId}::uuid
        AND cdl.deleted_at IS NULL
        AND cdl.sales_order_line_id IS NOT NULL
        AND cd.status <> 'cancelled'
        ${soFrag}
    )
    SELECT dl.did AS "dispatchId",
           SUM(GREATEST(0, LEAST(dl.qty, COALESCE(inv.q, 0) - (dl.cum - dl.qty))))::int AS "billed"
    FROM dl
    LEFT JOIN inv ON inv.sol_id = dl.sol_id
    GROUP BY dl.did
  `);
  const rows = result as unknown as Array<{ dispatchId: string; billed: number | string }>;
  return new Map(rows.map((r) => [r.dispatchId, Number(r.billed)]));
}

export function billedStatusOf(billedQty: number, totalQty: number): BilledStatus {
  if (billedQty <= 0) return 'none';
  return billedQty >= totalQty ? 'full' : 'partial';
}
