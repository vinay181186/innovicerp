// ADR-264 phase 2 — outsource (OSP) checks, on the Production page.
// Both read v_osp_wip (the OSP At-Vendor register's view, 0110/0130) through
// the register's own bucket filter, osp-wip/service.ts ospWipBucketSql, so
// the check counts the rows the register lists under the same bucket:
//   prod_osp_send      — bucket 'ready_to_send' (qty cleared into the op, not
//                        yet done in-house, not yet sent). Qty = Ready to Send,
//                        date = the job card's Due Date.
//   prod_osp_at_vendor — bucket 'at_vendor', AND the op's PO line due date has
//                        passed. The op's PO lines are lib/osp-pr.ts
//                        opPoLineIdsSql (outsource_po_line_id + jc_op_po_lines);
//                        PO Due Date = the line's own, else the PO's, on a live
//                        PO that is not cancelled. With several lines the
//                        LATEST date is used, so a row is late only when every
//                        covering line is past due (no false alarm while a later
//                        line is still in time). Qty = At Vendor.
// Like the register, closed job cards are not filtered out (the view joins
// only live cards); cancelled cards are deleted, so never show.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { opPoLineIdsSql } from '../../../lib/osp-pr';
import { ospWipBucketSql } from '../../osp-wip/service';
import type { RawRow } from '../personal/list-query';
import type { CheckCtx, CheckDef } from './types';

export function ospReadyToSendSql(c: CheckCtx): SQL {
  return sql`
    SELECT w.jc_op_id::text AS row_key, w.job_card_id AS id, w.jc_code AS code,
           'osp'::text AS kind, jc.jc_date::text AS doc_date, jc.due_date::text AS due_date,
           COALESCE(jc.due_date, DATE '9999-12-31')::text AS sort_key,
           w.vendor_name::text AS party, w.item_code::text AS item_code,
           w.item_name::text AS item_name, w.ready_to_send_qty::numeric AS qty,
           i.uom::text AS uom, NULL::numeric AS amount, jc.created_by::text AS created_by,
           (CASE WHEN jc.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           w.jc_op_id::text AS x1, w.op_seq::text AS x2, w.operation::text AS x3
    FROM public.v_osp_wip w
    JOIN public.job_cards jc ON jc.id = w.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = w.item_id
    WHERE w.company_id = ${c.cid}::uuid
      ${ospWipBucketSql('ready_to_send')}`;
}

export function ospAtVendorLateSql(c: CheckCtx): SQL {
  return sql`
    SELECT w.jc_op_id::text AS row_key, w.job_card_id AS id, w.jc_code AS code,
           'osp'::text AS kind, jc.jc_date::text AS doc_date, pd.po_due::text AS due_date,
           pd.po_due::text AS sort_key,
           w.vendor_name::text AS party, w.item_code::text AS item_code,
           w.item_name::text AS item_name, w.at_vendor_qty::numeric AS qty,
           i.uom::text AS uom, NULL::numeric AS amount, jc.created_by::text AS created_by,
           1::int AS is_late,
           w.jc_op_id::text AS x1, w.op_seq::text AS x2, w.operation::text AS x3
    FROM public.v_osp_wip w
    JOIN public.job_cards jc ON jc.id = w.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = w.item_id
    CROSS JOIN LATERAL (
      SELECT MAX(COALESCE(pol.due_date, po.due_date)) AS po_due
      FROM public.purchase_order_lines pol
      JOIN public.purchase_orders po
        ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL AND po.status <> 'cancelled'
      WHERE pol.deleted_at IS NULL
        AND pol.id IN ${opPoLineIdsSql(sql`w.jc_op_id`)}
    ) pd
    WHERE w.company_id = ${c.cid}::uuid
      ${ospWipBucketSql('at_vendor')}
      AND pd.po_due < ${c.today}::date`;
}

const jcHref = (r: RawRow): string => docNavPage('job-card', r.id);

export const OSP_CHECKS: readonly CheckDef[] = [
  {
    key: 'prod_osp_send',
    dept: 'production',
    label: 'Outsource ready to send to vendor',
    head: ['JC No.', 'Process', 'Due Date'],
    href: '/delivery-challans?tab=at_vendor',
    query: ospReadyToSendSql,
    docHref: jcHref,
    refCode: (r) => r.x3,
    dated: true,
  },
  {
    key: 'prod_osp_at_vendor',
    dept: 'production',
    label: 'At vendor past PO due date',
    head: ['JC No.', 'Vendor', 'PO Due Date'],
    href: '/delivery-challans?tab=at_vendor',
    query: ospAtVendorLateSql,
    docHref: jcHref,
    dated: true,
  },
];
