// ADR-264 — Purchase checks, each the ADR-250 home rule imported as is:
//   pur_pr_pending  — personal/rows-purchase.ts prToPoSql (pr_to_po: every live
//                     PR with balance still to order — PRs have no approval,
//                     owner rule 2026-10-31; the same three conditions as
//                     purchase-requests prWaitingForPoSql).
//   pur_po_overdue  — poOverdueSql (issued PO past its Due Date), narrowed to
//                     POs whose Pending (lib/po-pending, qty − accepted) > 0.
//   pur_po_approval — poDraftSql (PO in draft, waiting approval); the status
//                     reads how long it has waited since its PO Date.
//   pur_osp_no_pr   — outsource op (op_type 'outsource', live, not complete by
//                     v_jc_op_status computed_status — the JC screens' op
//                     status) on an OPEN job card (live, not closed) with no
//                     purchase paperwork: lib/osp-pr.ts ospOpHasPurchaseSql
//                     (live outsource PR by source_jc_op_id — the rule the
//                     Outsource-balance action reads — or by the op's
//                     outsource_pr_id, or any covering PO line incl.
//                     jc_op_po_lines). Qty = the card's Order Qty, date = its
//                     Due Date.
//   pur_rtv_challan — NC ready for its return-to-vendor challan, lib/
//                     rtv-predicates.ts rtvReadyForChallanSql (createNcDc's
//                     guards); vendor = NC_SOURCE_VENDOR_JOINS (the RTV
//                     picker's own vendor rule). Date = Disposition Date (age).
//                     Qty = the NC's Deviated (rejected) qty.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { ospOpHasPurchaseSql } from '../../../lib/osp-pr';
import { NC_SOURCE_VENDOR_JOINS, rtvReadyForChallanSql } from '../../../lib/rtv-predicates';
import { poDraftSql, poOverdueSql, prToPoSql } from '../personal/rows-purchase';
import { type CheckCtx, type CheckDef, narrow } from './types';

export function ospOpsNoPrSql(c: CheckCtx): SQL {
  return sql`
    SELECT o.id::text AS row_key, jc.id, jc.code, 'osp_op'::text AS kind,
           jc.jc_date::text AS doc_date, jc.due_date::text AS due_date,
           COALESCE(jc.due_date, DATE '9999-12-31')::text AS sort_key,
           COALESCE(v.name, o.outsource_vendor_text)::text AS party,
           i.code::text AS item_code, i.name::text AS item_name,
           jc.order_qty::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           jc.created_by::text AS created_by,
           (CASE WHEN jc.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           o.id::text AS x1, o.op_seq::text AS x2, o.operation::text AS x3
    FROM public.jc_ops o
    JOIN public.job_cards jc
      ON jc.id = o.job_card_id AND jc.deleted_at IS NULL AND jc.closed_at IS NULL
    JOIN public.v_jc_op_status vs ON vs.jc_op_id = o.id AND vs.computed_status <> 'complete'
    LEFT JOIN public.items i ON i.id = jc.item_id
    LEFT JOIN public.vendors v ON v.id = o.outsource_vendor_id
    WHERE o.company_id = ${c.cid}::uuid AND o.deleted_at IS NULL
      AND o.op_type = 'outsource'
      AND NOT ${ospOpHasPurchaseSql('o')}`;
}

export function rtvChallanSql(c: CheckCtx): SQL {
  return sql`
    SELECT nc.id::text AS row_key, nc.id, nc.code, 'nc'::text AS kind,
           nc.disposition_date::text AS doc_date, NULL::text AS due_date,
           nc.disposition_date::text AS sort_key,
           v.name::text AS party,
           COALESCE(i.code, nc.item_code_text)::text AS item_code,
           COALESCE(i.name, nc.item_name_text)::text AS item_name,
           nc.rejected_qty::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           nc.created_by::text AS created_by, 0::int AS is_late,
           NULL::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.nc_register nc
    LEFT JOIN public.items i ON i.id = nc.item_id
    -- The aliases NC_SOURCE_VENDOR_JOINS needs, joined exactly as the RTV
    -- picker (delivery-challans/rtv-candidates.ts) joins them.
    LEFT JOIN public.jc_ops oo ON oo.id = nc.jc_op_id AND oo.company_id = nc.company_id
    LEFT JOIN public.goods_receipt_note_lines gl
      ON gl.id = nc.grn_line_id AND gl.company_id = nc.company_id AND gl.deleted_at IS NULL
    LEFT JOIN public.goods_receipt_notes grn
      ON grn.id = gl.goods_receipt_note_id AND grn.deleted_at IS NULL
    ${NC_SOURCE_VENDOR_JOINS}
    LEFT JOIN public.vendors v ON v.id = src.vendor_id AND v.deleted_at IS NULL
    WHERE nc.company_id = ${c.cid}::uuid AND nc.deleted_at IS NULL
      AND ${rtvReadyForChallanSql('nc')}`;
}

export const PURCHASE_CHECKS: readonly CheckDef[] = [
  {
    key: 'pur_pr_pending',
    dept: 'purchase',
    label: 'PR pending for PO',
    head: ['PR No.', 'Vendor', 'Due Date'],
    href: '/purchase-requests',
    query: (c) => prToPoSql(c.cid, c.today, {}),
    docHref: (r) => docNavPage('purchase-request', r.id),
    dated: true,
  },
  {
    key: 'pur_po_overdue',
    dept: 'purchase',
    label: 'Overdue POs (material not received)',
    head: ['PO No.', 'Vendor', 'Due Date'],
    href: '/purchase-orders',
    query: (c) => narrow(poOverdueSql(c.cid, c.today, {}), sql`x.qty > 0`),
    docHref: (r) => docNavPage('purchase-order', r.id),
    dated: true,
  },
  {
    key: 'pur_po_approval',
    dept: 'purchase',
    label: 'PO waiting for approval',
    head: ['PO No.', 'Vendor', 'PO Date'],
    href: '/purchase-orders',
    query: (c) => poDraftSql(c.cid, c.today, {}),
    docHref: (r) => docNavPage('purchase-order', r.id),
    dated: false,
  },
  {
    key: 'pur_osp_no_pr',
    dept: 'purchase',
    label: 'Outsource ops with no PR yet',
    head: ['JC No.', 'Process', 'Due Date'],
    href: '/purchase-requests',
    query: ospOpsNoPrSql,
    docHref: (r) => docNavPage('job-card', r.id),
    refCode: (r) => r.x3,
    dated: true,
  },
  {
    key: 'pur_rtv_challan',
    dept: 'purchase',
    label: 'RTV — return challan to raise',
    head: ['NC No.', 'Vendor', 'Disposed On'],
    href: '/delivery-challans',
    query: rtvChallanSql,
    docHref: (r) => docNavPage('nc', r.id),
    dated: false,
  },
];
