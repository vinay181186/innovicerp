// ADR-276 — the only definition of At Vendor per job-card operation: the figure
// the Job Card shows, read by Job Card Op Flow, SO Status and SO Overview.
//
//   At Vendor = v_jc_op_status.at_vendor_qty + return-to-vendor top-up
//
// v_jc_op_status counts return-to-vendor pieces only on outsource ops / ops with
// the legacy PO link. A dual-lane op linked only through jc_op_po_lines gets them
// added here, so At Vendor agrees with Returned to Vendor - Re-received on every
// row. The top-up uses the view's rule: open NCs, disposition return to vendor,
// challan issued.
//
// Readers that deliberately use something else:
//   - PO close guard (purchase-orders/service.ts, shortClosePurchaseOrder): per
//     PO line, DC sent less received, excludes rework. Left as is.
// Readers of the view's column alone, without the top-up (differs only on a
// dual-lane op with an open return-to-vendor NC): op-entry, production-orders,
// reports/wip-by-operation. v_osp_wip has its own column.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

/** At Vendor keyed by jc_ops.id, for the live ops of the given job cards. Ops
 *  with nothing at the vendor are absent (read with `?? 0`). The value can be a
 *  decimal when the top-up is. Empty input → empty map, no query. */
export async function loadAtVendorByOp(
  tx: DbTransaction,
  companyId: string,
  jobCardIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (jobCardIds.length === 0) return out;
  const rows = await tx.execute(sql`
    WITH ops AS (
      SELECT o.id, o.op_type, o.outsource_po_line_id
      FROM public.jc_ops o
      WHERE o.company_id = ${companyId}::uuid
        AND o.job_card_id IN (${sql.join(
          jobCardIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        AND o.deleted_at IS NULL
    ),
    rtv AS (
      SELECT nc.jc_op_id,
             GREATEST(0, COALESCE(SUM(nc.rtv_sent_qty - nc.rtv_received_qty), 0)) AS qty
      FROM public.nc_register nc
      JOIN ops ON ops.id = nc.jc_op_id
      WHERE nc.deleted_at IS NULL
        AND nc.disposition = 'return_to_vendor'
        AND nc.delivery_challan_id IS NOT NULL
        AND nc.status <> 'closed'
      GROUP BY nc.jc_op_id
    )
    SELECT ops.id AS "jcOpId",
           COALESCE(v.at_vendor_qty, 0)
             + CASE WHEN ops.op_type <> 'outsource' AND ops.outsource_po_line_id IS NULL
                    THEN COALESCE(rtv.qty, 0) ELSE 0 END AS "atVendorQty"
    FROM ops
    LEFT JOIN public.v_jc_op_status v ON v.jc_op_id = ops.id
    LEFT JOIN rtv ON rtv.jc_op_id = ops.id
  `);
  for (const r of rows as unknown as Array<{ jcOpId: string; atVendorQty: number | string }>) {
    const qty = Number(r.atVendorQty ?? 0);
    if (qty > 0) out.set(r.jcOpId, qty);
  }
  return out;
}
