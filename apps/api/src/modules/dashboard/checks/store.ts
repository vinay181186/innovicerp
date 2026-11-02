// ADR-264 — Store checks.
//   store_jwso_grn — JWSO lines whose customer material is not yet all
//                    received on a Party GRN: line open, not closed short,
//                    party material set, Order Qty > committed. "Committed"
//                    is THE one rule, party-grn/service.ts
//                    partyCommittedQtySql (ADR-247); the line test is
//                    job-work-orders/service.ts receivableFrag (~:414), which
//                    is a local there — written here per line, same words.
//                    Qty = Order Qty − committed.
//   store_po_grn   — every PO line still to receive (not only late): PO open /
//                    partial / qc_pending (lib/po-pending PO_OPEN_STATUSES),
//                    Pending by lib/po-pending poLinePendingSql > 0. Due Date =
//                    the line's own, else the PO's.
//   store_po_dc    — personal/rows-purchase.ts poToDcSql as is (approved PO of
//                    a send-out type with qty still to send on a DC).
//   store_tools_out — tool-issues/common.ts ISSUE_SELECT + TOOL_STILL_OUT (the
//                    register's and AL-021's "still out" rule), by Expected
//                    Return Date. Qty = Still Out.
//   store_count_approval — stock counts submitted, waiting approval. A count
//                    has no location (stock_counts carries none), so the
//                    reference column is empty.
// (store_party_qc moved out in phase 2: its rows are in QC's qc_incoming.)

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { PO_OPEN_STATUSES, poLinePendingSql } from '../../../lib/po-pending';
import { partyCommittedQtySql } from '../../party-grn/service';
import { ISSUE_SELECT, TOOL_STILL_OUT } from '../../tool-issues/common';
import { poToDcSql } from '../personal/rows-purchase';
import type { CheckCtx, CheckDef } from './types';

export function jwsoToReceiveSql(c: CheckCtx): SQL {
  return sql`
    SELECT jwl.id::text AS row_key, jw.id, jw.code, 'jw'::text AS kind,
           jw.jw_date::text AS doc_date, jwl.due_date::text AS due_date,
           COALESCE(jwl.due_date, jw.jw_date)::text AS sort_key,
           COALESCE(cl.name, jw.customer_name)::text AS party,
           COALESCE(pm.code, jwl.item_code_text)::text AS item_code,
           COALESCE(pm.name, jwl.part_name)::text AS item_name,
           (jwl.order_qty - cm.committed)::numeric AS qty,
           COALESCE(pm.uom, jwl.uom::text)::text AS uom,
           NULL::numeric AS amount, jw.created_by::text AS created_by,
           (CASE WHEN jwl.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(jw.client_po_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.job_work_order_lines jwl
    JOIN public.job_work_orders jw
      ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL AND jw.status = 'open'
    LEFT JOIN public.party_materials pm ON pm.id = jwl.party_material_id
    LEFT JOIN public.clients cl ON cl.id = jw.client_id AND cl.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT ${partyCommittedQtySql(sql`jwl.id`)} AS committed) cm
    WHERE jw.company_id = ${c.cid}::uuid AND jwl.deleted_at IS NULL
      AND jwl.status = 'open' AND jwl.short_closed_at IS NULL
      AND jwl.party_material_id IS NOT NULL
      AND jwl.order_qty > cm.committed`;
}

export function poLinesToReceiveSql(c: CheckCtx): SQL {
  return sql`
    SELECT pol.id::text AS row_key, po.id, po.code, po.po_type::text AS kind,
           po.po_date::text AS doc_date, COALESCE(pol.due_date, po.due_date)::text AS due_date,
           COALESCE(pol.due_date, po.due_date)::text AS sort_key,
           COALESCE(v.name, po.vendor_code_text)::text AS party,
           COALESCE(i.code, pol.item_code_text)::text AS item_code,
           COALESCE(pol.item_name, i.name)::text AS item_name,
           pend.q::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           po.created_by::text AS created_by,
           (CASE WHEN COALESCE(pol.due_date, po.due_date) < ${c.today}::date
                 THEN 1 ELSE 0 END)::int AS is_late,
           NULL::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders po ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
    LEFT JOIN public.vendors v ON v.id = po.vendor_id
    LEFT JOIN public.items i ON i.id = pol.item_id
    CROSS JOIN LATERAL (SELECT ${poLinePendingSql('pol', 'po')} AS q) pend
    WHERE po.company_id = ${c.cid}::uuid AND pol.deleted_at IS NULL
      AND po.status::text = ANY(${sql.param([...PO_OPEN_STATUSES])}::text[])
      AND pend.q > 0`;
}

export function toolsOutSql(c: CheckCtx): SQL {
  return sql`
    SELECT x.id::text AS row_key, x.id, x.code, 'tool_issue'::text AS kind,
           x.issue_date::text AS doc_date, x.expected_return_date::text AS due_date,
           COALESCE(x.expected_return_date, x.issue_date)::text AS sort_key,
           NULL::text AS party, x.item_code::text AS item_code, x.item_name::text AS item_name,
           x.still_out_qty::numeric AS qty, x.uom::text AS uom, NULL::numeric AS amount,
           x.created_by::text AS created_by,
           (CASE WHEN x.expected_return_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(x.issued_to), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM (
      ${ISSUE_SELECT}
      WHERE ti.company_id = ${c.cid}::uuid AND ti.deleted_at IS NULL
    ) x
    WHERE ${TOOL_STILL_OUT}`;
}

export function countApprovalSql(c: CheckCtx): SQL {
  return sql`
    SELECT sc.id::text AS row_key, sc.id, sc.code, sc.purpose::text AS kind,
           sc.count_date::text AS doc_date, NULL::text AS due_date,
           sc.count_date::text AS sort_key,
           NULL::text AS party, NULL::text AS item_code, NULL::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           sc.created_by::text AS created_by, 0::int AS is_late,
           NULL::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.stock_counts sc
    WHERE sc.company_id = ${c.cid}::uuid AND sc.deleted_at IS NULL
      AND sc.status = 'submitted'`;
}

export const STORE_CHECKS: readonly CheckDef[] = [
  {
    key: 'store_jwso_grn',
    dept: 'store',
    label: 'GRN pending against JWSO',
    head: ['JWSO No.', 'Client PO No.', 'Due Date'],
    href: '/party-grn',
    query: jwsoToReceiveSql,
    docHref: (r) => docNavPage('job-work-order', r.id),
    refCode: (r) => r.x1,
    dated: true,
  },
  {
    key: 'store_po_grn',
    dept: 'store',
    label: 'GRN pending',
    head: ['PO No.', 'Vendor', 'Due Date'],
    href: '/goods-receipt-notes',
    query: poLinesToReceiveSql,
    docHref: (r) => docNavPage('purchase-order', r.id),
    dated: true,
  },
  {
    key: 'store_po_dc',
    dept: 'store',
    label: 'PO material to send out (DC)',
    head: ['PO No.', 'Vendor', 'PO Date'],
    href: '/delivery-challans',
    query: (c) => poToDcSql(c.cid, c.today, {}),
    docHref: (r) => docNavPage('purchase-order', r.id),
    dated: false,
  },
  {
    key: 'store_tools_out',
    dept: 'store',
    label: 'Tools issued, not returned',
    head: ['Issue No.', 'Issued To', 'Expected Return'],
    href: '/issue-register?tab=tools',
    query: toolsOutSql,
    docHref: (r) => `/issue-register?tab=tools&search=${encodeURIComponent(r.code)}`,
    refCode: (r) => r.x1,
    dated: true,
  },
  {
    key: 'store_count_approval',
    dept: 'store',
    label: 'Stock count waiting approval',
    // stock_counts has no Location: the reference column stays empty.
    head: ['Count No.', '—', 'Count Date'],
    href: '/stock-counts',
    query: countApprovalSql,
    docHref: (r) => `/stock-counts/${r.id}`,
    dated: false,
    noQty: true,
  },
];
