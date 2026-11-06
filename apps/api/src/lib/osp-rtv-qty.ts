// ADR-276 — Returned to Vendor / Re-received on an outsource op: the cumulative
// challan quantities of its return-to-vendor NCs, closed NCs included. Same filter
// as flow-views getOpFlow's rtv_sent / rtv_received.
//
// NEVER v_osp_wip.returned_to_vendor_qty: that is the OPEN NC quantity, another fact.

import { sql, type SQL } from 'drizzle-orm';

/** Scalar SQL: Σ of one rtv column for the row aliased `opAlias`, which must carry
 *  jc_op_id and company_id (v_osp_wip). A scalar cannot multiply the row. */
export function ospRtvQtySql(
  column: 'rtv_sent_qty' | 'rtv_received_qty',
  opAlias = 'w',
): SQL<number> {
  const op = sql.identifier(opAlias);
  return sql<number>`(SELECT COALESCE(SUM(rtvnc.${sql.identifier(column)}), 0)::float8
    FROM public.nc_register rtvnc
    WHERE rtvnc.jc_op_id = ${op}.jc_op_id
      AND rtvnc.company_id = ${op}.company_id
      AND rtvnc.disposition = 'return_to_vendor'
      AND rtvnc.delivery_challan_id IS NOT NULL
      AND rtvnc.deleted_at IS NULL)`;
}
