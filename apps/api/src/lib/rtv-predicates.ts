// Return-to-vendor challan predicates (ADR-211) — the ONE SQL definition.
//
// "An NC is ready for its return-to-vendor challan" mirrors the guards that
// createNcDcBatch (nc-register/create-nc-dc.ts) enforces before it raises the challan:
//   - disposition guard   nc.disposition = 'return_to_vendor'
//   - status guard        nc.status      = 'disposed'
//   - one-challan lock    nc.delivery_challan_id IS NULL
//   - active-challan check  no live delivery_challans row (deleted_at IS NULL,
//                           status <> 'cancelled') whose HEADER nc_id = nc.id
//                           OR with a live LINE whose nc_id = nc.id (0237 —
//                           one DC may carry several NCs, one per line)
// createNcDc keeps its own TypeScript checks (it needs the NC row it read
// FOR UPDATE); this SQL mirrors them for the readers. Keep in lock-step with
// createNcDc's guards — if one changes, change the other in the same commit.
// Readers, which must never disagree with createNcDc or each other:
//   - the NC list's pendingRtvChallan filter (+New DC → Against NC) — intended,
//     so an NC the list offers is one createNcDc will accept, and
//   - GET /delivery-challans/rtv-candidates + the Against PO guard
//     (delivery-challans/rtv-candidates.ts).

import { sql, type SQL } from 'drizzle-orm';

/** Parenthesised boolean SQL (no leading AND) for the NC row aliased `ncAlias`. */
export function rtvReadyForChallanSql(ncAlias = 'nc'): SQL {
  const nc = sql.identifier(ncAlias);
  return sql`(${nc}.disposition = 'return_to_vendor'::nc_disposition
    AND ${nc}.status = 'disposed'::nc_status
    AND ${nc}.delivery_challan_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_challans adc
       WHERE adc.nc_id = ${nc}.id
         AND adc.deleted_at IS NULL
         AND adc.status <> 'cancelled'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_challan_lines adcl
        JOIN public.delivery_challans ladc ON ladc.id = adcl.delivery_challan_id
       WHERE adcl.nc_id = ${nc}.id
         AND adcl.deleted_at IS NULL
         AND ladc.deleted_at IS NULL
         AND ladc.status <> 'cancelled'
    ))`;
}

/** The NC's source vendor as `src.vendor_id` — MIRRORS resolveNcSource
 *  (nc-register/cascades.ts):
 *    (a) GRN line set -> the GRN's vendor;
 *    (b) else origin op is an outsource op -> the vendor of the PO line raised
 *        for that op (source_jc_op_id), PO-backed rows first, newest.
 *  Two LATERAL joins. The caller's FROM must already have `nc` (nc_register),
 *  `oo` (jc_ops on nc.jc_op_id) and `grn` (the rejected GRN line's
 *  goods_receipt_notes). Read by the return-to-vendor picker
 *  (delivery-challans/rtv-candidates.ts) and the home's Purchase check
 *  pur_rtv_challan, so both name the same vendor. */
export const NC_SOURCE_VENDOR_JOINS = sql`
    LEFT JOIN LATERAL (
      SELECT po2.vendor_id
        FROM public.purchase_order_lines pol2
        LEFT JOIN public.purchase_orders po2
          ON po2.id = pol2.purchase_order_id AND po2.deleted_at IS NULL
       WHERE pol2.source_jc_op_id = oo.id AND pol2.deleted_at IS NULL
       ORDER BY (po2.id IS NOT NULL) DESC, pol2.created_at DESC
       LIMIT 1
    ) opo ON nc.grn_line_id IS NULL AND oo.op_type = 'outsource'
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN nc.grn_line_id IS NOT NULL THEN grn.vendor_id
        WHEN oo.op_type = 'outsource' THEN opo.vendor_id
      END AS vendor_id
    ) src ON TRUE`;
