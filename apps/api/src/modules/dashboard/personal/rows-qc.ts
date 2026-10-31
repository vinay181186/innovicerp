// ADR-250 — QC inner queries for the per-person home (list-query.ts shape).
//   grn_qc    — one row per GRN document still waiting for Incoming QC:
//               purchase GRN lines qc_status pending / in_progress (AL-008's
//               test) + party GRN lines by party-grn QC_OPEN_SQL (partial
//               QC, 0233). qty = Σ QC Pending Qty (received − accepted −
//               rejected) on both halves, owner D3 2026-10-31.
//               x1 = first waiting line id (the Inspect deep link),
//               x2/x3 = the PO / JWSO behind it (id, number).
//               kind = 'party_grn', or the GRN's GRN Type (ADR-251, the
//               register's grnTypeSql rule) so Inspect opens the page that
//               lists the call.
//   capa_mine — open CAPAs where the caller is the Responsible person
//               (capa_records.responsible holds the person's name).
//               x1 = the next step, x2 = the problem.
//   qc_report_missing — ADR-252: one row per QC entry saved with
//               report_required = true, accepted qty > 0, not reversed, and
//               no report (neither op_log.qc_report_path nor a qc_documents
//               row on the entry). Entries saved before 0216 (NULL) never
//               show here (D8). id = the job card; row_key = the entry;
//               kind = 'so' | 'jwso'; party = the report's name;
//               x1 = the order id, x2 = the order line id, x3 = POL.

import { type SQL, sql } from 'drizzle-orm';
import { QC_OPEN_SQL, QC_PENDING_QTY_SQL } from '../../party-grn/qc-state';
import { polSql } from '../../../lib/pol';
import { qcProcessReportJoin } from '../../../lib/qc-process-report';
import { grnTypeSql } from '../../qc-history/register-incoming';
import { filterFrag, type ListFilter } from './list-query';

export function grnQcSql(cid: string, f: ListFilter): SQL {
  return sql`
    SELECT g.id::text AS row_key, g.id, g.code, ${grnTypeSql('g')}::text AS kind,
           g.grn_date::text AS doc_date, NULL::text AS due_date, g.grn_date::text AS sort_key,
           COALESCE(v.name, g.vendor_code_text)::text AS party,
           (ARRAY_AGG(COALESCE(i.code, gl.item_code_text) ORDER BY gl.line_no))[1]::text AS item_code,
           (ARRAY_AGG(COALESCE(gl.item_name, i.name) ORDER BY gl.line_no))[1]::text AS item_name,
           COALESCE(SUM(gl.received_qty - gl.qc_accepted_qty - gl.qc_rejected_qty), 0)::numeric AS qty,
           (ARRAY_AGG(i.uom ORDER BY gl.line_no))[1]::text AS uom,
           NULL::numeric AS amount, g.created_by::text AS created_by, 0::int AS is_late,
           (ARRAY_AGG(gl.id::text ORDER BY gl.line_no))[1] AS x1,
           g.purchase_order_id::text AS x2,
           COALESCE(po.code, g.po_code_text)::text AS x3
    FROM public.goods_receipt_notes g
    JOIN public.goods_receipt_note_lines gl
      ON gl.goods_receipt_note_id = g.id AND gl.deleted_at IS NULL
     AND gl.qc_status IN ('pending', 'in_progress')
    LEFT JOIN public.vendors v ON v.id = g.vendor_id
    LEFT JOIN public.items i ON i.id = gl.item_id
    LEFT JOIN public.purchase_orders po ON po.id = g.purchase_order_id AND po.deleted_at IS NULL
    WHERE g.company_id = ${cid}::uuid AND g.deleted_at IS NULL
      ${filterFrag(f, 'g.id', 'g.created_by')}
    GROUP BY g.id, v.name, po.code
    UNION ALL
    SELECT p.id::text AS row_key, p.id, p.code, 'party_grn'::text AS kind,
           p.grn_date::text AS doc_date, NULL::text AS due_date, p.grn_date::text AS sort_key,
           COALESCE(c.name, p.client_code_text)::text AS party,
           (ARRAY_AGG(pgl.party_material_code_text ORDER BY pgl.line_no))[1]::text AS item_code,
           (ARRAY_AGG(pgl.party_material_name ORDER BY pgl.line_no))[1]::text AS item_name,
           COALESCE(SUM(${QC_PENDING_QTY_SQL}), 0)::numeric AS qty,
           NULL::text AS uom,
           NULL::numeric AS amount, p.created_by::text AS created_by, 0::int AS is_late,
           (ARRAY_AGG(pgl.id::text ORDER BY pgl.line_no))[1] AS x1,
           p.job_work_order_id::text AS x2,
           COALESCE(jw.code, p.jw_code_text)::text AS x3
    FROM public.party_grn p
    JOIN public.party_grn_lines pgl
      ON pgl.party_grn_id = p.id AND pgl.deleted_at IS NULL AND ${QC_OPEN_SQL}
    LEFT JOIN public.clients c ON c.id = p.client_id
    LEFT JOIN public.job_work_orders jw ON jw.id = p.job_work_order_id AND jw.deleted_at IS NULL
    WHERE p.company_id = ${cid}::uuid AND p.deleted_at IS NULL
      ${filterFrag(f, 'p.id', 'p.created_by')}
    GROUP BY p.id, c.name, jw.code`;
}

export function capaMineSql(cid: string, today: string, myName: string, f: ListFilter): SQL {
  return sql`
    SELECT c.id::text AS row_key, c.id, c.code, 'capa'::text AS kind,
           c.capa_date::text AS doc_date, c.target_date::text AS due_date,
           COALESCE(c.target_date, c.capa_date)::text AS sort_key,
           c.department::text AS party, c.item_code::text AS item_code, NULL::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           c.created_by::text AS created_by,
           (CASE WHEN c.target_date < ${today}::date THEN 1 ELSE 0 END)::int AS is_late,
           (CASE WHEN NULLIF(btrim(c.root_cause), '') IS NULL THEN 'Root cause'
                 WHEN NULLIF(btrim(c.corrective_action), '') IS NULL THEN 'Corrective action'
                 WHEN NULLIF(btrim(c.verification), '') IS NULL THEN 'Verification'
                 ELSE 'Preventive action' END)::text AS x1,
           left(COALESCE(c.problem, ''), 80)::text AS x2, NULL::text AS x3
    FROM public.capa_records c
    WHERE c.company_id = ${cid}::uuid AND c.deleted_at IS NULL
      AND lower(c.status) NOT IN ('closed', 'verified')
      -- A login with no name matches nothing — never the CAPAs whose
      -- Responsible is blank.
      AND btrim(${myName}) <> ''
      AND lower(btrim(COALESCE(c.responsible, ''))) = lower(btrim(${myName}))
      ${filterFrag(f, 'c.id', null)}`;
}

export function qcReportMissingSql(cid: string, f: ListFilter): SQL {
  return sql`
    SELECT ol.id::text AS row_key, jc.id, jc.code,
           (CASE WHEN jc.source_so_line_id IS NULL AND jc.source_jw_line_id IS NOT NULL
                 THEN 'jwso' ELSE 'so' END)::text AS kind,
           ol.log_date::text AS doc_date, NULL::text AS due_date, ol.log_date::text AS sort_key,
           COALESCE(pr.report_name, jo.operation)::text AS party,
           COALESCE(i.code, sol.item_code_text, jwl.item_code_text)::text AS item_code,
           COALESCE(i.name, sol.part_name, jwl.part_name)::text AS item_name,
           ol.qty::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           ol.created_by::text AS created_by, 0::int AS is_late,
           COALESCE(sol.sales_order_id, jwl.job_work_order_id)::text AS x1,
           COALESCE(sol.id, jwl.id)::text AS x2,
           ${polSql('sol', 'jwl')}::text AS x3
    FROM public.op_log ol
    JOIN public.jc_ops jo ON jo.id = ol.jc_op_id AND jo.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = jc.item_id
    LEFT JOIN public.sales_order_lines sol
      ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines jwl
      ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
    ${qcProcessReportJoin(cid, 'jo.operation', 'pr')}
    -- log_type / report_required / the blank-path test are
    -- op_log_qc_report_owed_idx's predicate (0216) word for word — keep them
    -- identical or the planner can no longer use that index.
    WHERE ol.company_id = ${cid}::uuid AND ol.log_type = 'qc'
      AND ol.report_required = true AND ol.qty > 0
      AND ol.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.op_log rv WHERE rv.reversal_of_id = ol.id)
      AND NULLIF(btrim(COALESCE(ol.qc_report_path, '')), '') IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.qc_documents qd
                      WHERE qd.op_log_id = ol.id AND qd.deleted_at IS NULL)
      ${filterFrag(f, 'jc.id', 'ol.created_by')}`;
}
