// ADR-264 — Store checks.
//   store_jwso_grn — JWSO lines whose customer material is not yet all
//                    received on a Party GRN: line open, not closed short,
//                    party material set, Order Qty > committed. "Committed"
//                    is THE one rule, party-grn/service.ts
//                    partyCommittedQtySql (ADR-247); the line test is
//                    job-work-orders/service.ts receivableFrag (~:414), which
//                    is a local there — written here per line, same words.
//                    Qty = Order Qty − committed.
//   store_party_qc — personal/rows-qc.ts grnQcSql, its Party GRN half only
//                    (kind = 'party_grn'): one row per Party GRN with a line
//                    whose QC Pending Qty (received − accepted − rejected) > 0.
//   store_po_grn   — every PO line still to receive (not only late): PO open /
//                    partial / qc_pending (lib/po-pending PO_OPEN_STATUSES),
//                    Pending by lib/po-pending poLinePendingSql > 0. Due Date =
//                    the line's own, else the PO's.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { PO_OPEN_STATUSES, poLinePendingSql } from '../../../lib/po-pending';
import { partyCommittedQtySql } from '../../party-grn/service';
import { grnQcSql } from '../personal/rows-qc';
import { entityHref } from '../personal/util';
import { type CheckCtx, type CheckDef, narrow } from './types';

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
    key: 'store_party_qc',
    dept: 'store',
    label: 'QC pending against party GRN',
    head: ['Party GRN No.', 'JWSO No.', 'GRN Date'],
    href: '/incoming-qc',
    query: (c) => narrow(grnQcSql(c.cid, {}), sql`x.kind = 'party_grn'`),
    docHref: (r) => entityHref('PartyGrn', r.id, r.code) ?? '/party-grn',
    refCode: (r) => r.x3,
    refHref: (r) => (r.x2 ? docNavPage('job-work-order', r.x2) : null),
    dated: false,
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
];
