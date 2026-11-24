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
import { createdKey } from '../../../lib/list-order';
import { ospWipBucketSql } from '../../osp-wip/service';
import type { RawRow } from '../personal/list-query';
import { nextStep, nextStepAny } from './next-step';
import type { CheckCtx, CheckDef } from './types';

export function ospReadyToSendSql(c: CheckCtx): SQL {
  return sql`
    SELECT w.jc_op_id::text AS row_key, w.job_card_id AS id, w.jc_code AS code,
           'osp'::text AS kind, jc.jc_date::text AS doc_date, jc.due_date::text AS due_date,
           ${createdKey('jc.created_at')} AS sort_key,
           w.vendor_name::text AS party, w.item_code::text AS item_code,
           w.item_name::text AS item_name, w.ready_to_send_qty::numeric AS qty,
           i.uom::text AS uom, NULL::numeric AS amount, jc.created_by::text AS created_by,
           (CASE WHEN jc.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           w.jc_op_id::text AS x1, w.op_seq::text AS x2, w.operation::text AS x3,
           sp.po_id AS x4
    FROM public.v_osp_wip w
    JOIN public.job_cards jc ON jc.id = w.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = w.item_id
    -- ADR-312: the ONE open PO covering the op (status as poToDcSql reads a
    -- PO a DC can be made on); none or several → NULL (the job card).
    CROSS JOIN LATERAL (
      SELECT CASE WHEN COUNT(DISTINCT po.id) = 1 THEN MIN(po.id::text) END AS po_id
      FROM public.purchase_order_lines pol
      JOIN public.purchase_orders po
        ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
       AND po.company_id = ${c.cid}::uuid AND po.status IN ('open', 'partial')
      WHERE pol.deleted_at IS NULL
        AND pol.id IN ${opPoLineIdsSql(sql`w.jc_op_id`)}
    ) sp
    WHERE w.company_id = ${c.cid}::uuid
      ${ospWipBucketSql('ready_to_send')}`;
}

export function ospAtVendorLateSql(c: CheckCtx): SQL {
  return sql`
    SELECT w.jc_op_id::text AS row_key, w.job_card_id AS id, w.jc_code AS code,
           'osp'::text AS kind, jc.jc_date::text AS doc_date, pd.po_due::text AS due_date,
           ${createdKey('jc.created_at')} AS sort_key,
           w.vendor_name::text AS party, w.item_code::text AS item_code,
           w.item_name::text AS item_name, w.at_vendor_qty::numeric AS qty,
           i.uom::text AS uom, NULL::numeric AS amount, jc.created_by::text AS created_by,
           1::int AS is_late,
           w.jc_op_id::text AS x1, w.op_seq::text AS x2, w.operation::text AS x3,
           od.dc_id AS x4
    FROM public.v_osp_wip w
    JOIN public.job_cards jc ON jc.id = w.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = w.item_id
    -- ADR-312: the OLDEST still-issued out-DC on the op's PO lines (Receive),
    -- the same pick as the JC Ops card (jc-ops outsourceOpenDcId); none → NULL.
    LEFT JOIN LATERAL (
      SELECT dc.id::text AS dc_id
      FROM public.delivery_challan_lines dcl
      JOIN public.delivery_challans dc
        ON dc.id = dcl.delivery_challan_id AND dc.deleted_at IS NULL
       AND dc.company_id = ${c.cid}::uuid AND dc.status = 'issued'
      WHERE dcl.deleted_at IS NULL
        AND dcl.purchase_order_line_id IN ${opPoLineIdsSql(sql`w.jc_op_id`)}
      ORDER BY dc.dc_date ASC, dc.code ASC
      LIMIT 1
    ) od ON true
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
    // ADR-312: New DC on the op's PO (x4 = PO id).
    actionHref: nextStep('ospdc_create', 'entry', (r) =>
      r.x4 ? `/delivery-challans/new?poId=${r.x4}` : null,
    ),
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
    // ADR-312: Receive on the open out-DC (x4 = DC id). The receive endpoint
    // accepts OSP Outward DC entry OR GRN entry, and so does its page.
    actionHref: nextStepAny(
      [
        ['ospdc_create', 'entry'],
        ['grn_create', 'entry'],
      ],
      (r) => (r.x4 ? `/delivery-challans/${r.x4}/receive` : null),
    ),
    dated: true,
  },
];
