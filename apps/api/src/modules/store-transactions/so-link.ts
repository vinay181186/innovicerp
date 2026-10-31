// ADR-261 — the Stock Ledger's lead columns: which SO / JWSO line a movement
// belongs to. A ledger row only names its document in `source_type` +
// `source_ref`, so each kind is traced through the document that wrote it:
//
//   store_issue            issue line (store_transaction_id) → slip's Job Card
//                          source line, or the slip's Assembly SO (no line)
//   qc_accept              "<JC code> Op #n" → that Job Card's source line
//   production_order_close production_order_closes.store_txn_id → PRO → plan line
//   dispatch               "<dispatch code> / ln n…" → that dispatch line's SO line
//   reservation            "<SO code> / ln n" → that SO line
//   grn_qc                 "<GRN code> / ln <id prefix>" → GRN line → PO line's
//                          source SO line, else its OSP op's Job Card line
//
// Every other kind (manual adjust, stock count, tool moves, JW DC, rev change…)
// has no order line → "—". Used on the PAGE query only (25 rows): the SO
// columns are display-only, so the count and KPI queries stay as they were.

import { sql } from 'drizzle-orm';

import { polSql } from '../../lib/pol';

/** LATERAL `lnk(so_line_id, jw_line_id, so_id)` + the joins that read it. */
export const STOCK_LEDGER_SO_JOINS = sql`
  LEFT JOIN LATERAL (
    SELECT x.so_line_id, x.jw_line_id, x.so_id FROM (
      SELECT jc.source_so_line_id AS so_line_id, jc.source_jw_line_id AS jw_line_id,
             si.sales_order_id AS so_id,
             (sil.deleted_at IS NULL AND si.deleted_at IS NULL) AS live,
             sil.created_at AS made_at, sil.id AS row_id
      FROM public.store_issue_lines sil
      JOIN public.store_issues si ON si.id = sil.issue_id
      LEFT JOIN public.job_cards jc ON jc.id = si.job_card_id AND jc.deleted_at IS NULL
      WHERE st.source_type = 'store_issue' AND sil.store_transaction_id = st.id
      UNION ALL
      SELECT jc.source_so_line_id, jc.source_jw_line_id, NULL::uuid,
             true, jc.created_at, jc.id
      FROM public.job_cards jc
      WHERE st.source_type = 'qc_accept' AND jc.company_id = st.company_id
        AND jc.deleted_at IS NULL
        AND jc.code = split_part(st.source_ref, ' Op #', 1)
      UNION ALL
      SELECT pl.so_line_id, pl.jw_line_id, NULL::uuid,
             (pc.deleted_at IS NULL), pc.created_at, pc.id
      FROM public.production_order_closes pc
      JOIN public.production_orders pro ON pro.id = pc.production_order_id
      JOIN public.plans pl ON pl.id = pro.plan_id
      WHERE st.source_type = 'production_order_close' AND pc.store_txn_id = st.id
      UNION ALL
      SELECT cdl.sales_order_line_id, NULL::uuid, cd.sales_order_id,
             (cd.deleted_at IS NULL), cdl.created_at, cdl.id
      FROM public.customer_dispatches cd
      JOIN public.customer_dispatch_lines cdl
        ON cdl.customer_dispatch_id = cd.id AND cdl.deleted_at IS NULL
      WHERE st.source_type = 'dispatch' AND cd.company_id = st.company_id
        AND cd.code = split_part(st.source_ref, ' / ln ', 1)
        AND cdl.line_no::text = substring(st.source_ref from ' / ln ([0-9]+)')
      UNION ALL
      SELECT rsol.id, NULL::uuid, rso.id,
             (rso.deleted_at IS NULL), rsol.created_at, rsol.id
      FROM public.sales_orders rso
      JOIN public.sales_order_lines rsol
        ON rsol.sales_order_id = rso.id AND rsol.deleted_at IS NULL
      WHERE st.source_type = 'reservation' AND rso.company_id = st.company_id
        AND rso.code = split_part(st.source_ref, ' / ln ', 1)
        AND rsol.line_no::text = substring(st.source_ref from ' / ln ([0-9]+)')
      UNION ALL
      SELECT COALESCE(pol.source_so_line_id, gjc.source_so_line_id), gjc.source_jw_line_id,
             NULL::uuid, (gl.deleted_at IS NULL AND g.deleted_at IS NULL), gl.created_at, gl.id
      FROM public.goods_receipt_notes g
      JOIN public.goods_receipt_note_lines gl ON gl.goods_receipt_note_id = g.id
      LEFT JOIN public.purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
      LEFT JOIN public.jc_ops gop ON gop.id = pol.source_jc_op_id
      LEFT JOIN public.job_cards gjc ON gjc.id = gop.job_card_id
      WHERE st.source_type = 'grn_qc' AND g.company_id = st.company_id
        AND g.code = split_part(st.source_ref, ' / ln ', 1)
        AND split_part(st.source_ref, ' / ln ', 2) <> ''
        AND gl.id::text LIKE split_part(st.source_ref, ' / ln ', 2) || '%'
    ) x
    -- Deterministic when a ref matches more than one row: the live row first,
    -- then the newest, then by id.
    ORDER BY x.live DESC, x.made_at DESC, x.row_id
    LIMIT 1
  ) lnk ON true
  LEFT JOIN public.sales_order_lines sol ON sol.id = lnk.so_line_id
  LEFT JOIN public.job_work_order_lines jwl ON jwl.id = lnk.jw_line_id
  LEFT JOIN public.sales_orders so ON so.id = COALESCE(sol.sales_order_id, lnk.so_id)
  LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id
  LEFT JOIN public.item_revisions ir ON ir.id = st.item_revision_id`;

/** The select list the joins above feed. */
export const STOCK_LEDGER_SO_SELECT = sql`
  COALESCE(so.code, jw.code) AS "soCode",
  so.internal_so_no AS "soInternalNo",
  ${polSql('sol', 'jwl')} AS "clientPoLineNo",
  ir.rev AS "itemRevision"`;
