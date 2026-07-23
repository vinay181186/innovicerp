-- 0071 — OSP At-Vendor register: accepted = incoming-QC accepted, add In-QC.
--
-- Same correction as 0070 for the register view v_osp_wip. It derived
-- accepted_qty from the DC receipt (received − rejected) = physically returned,
-- not QC-accepted. Re-source returned/accepted/rejected from the OSP return GRN
-- (goods_receipt_note_lines) so the register agrees with the JC op table:
--   returned  = SUM(grl.received_qty)
--   accepted  = SUM(grl.qc_accepted_qty)   ← incoming-QC passed (the real "done")
--   rejected  = SUM(grl.qc_rejected_qty)
--   in_qc     = returned − accepted − rejected   (NEW, appended — returned but
--               incoming-QC still pending)
-- Reconciliation: order = accepted + in_qc + at_vendor + not_sent.
--
-- CREATE OR REPLACE: returned/rejected/accepted change expression (same name/
-- type/position); in_qc_qty appended as the new last column. Idempotent.

CREATE OR REPLACE VIEW public.v_osp_wip AS
WITH receipts AS (
  -- Returned + QC-accepted + QC-rejected from the OSP return GRN, per outsource
  -- op, via the op's PO line. Mirrors v_jc_op_status (0070) so the two agree.
  SELECT
    o.id AS jc_op_id,
    COALESCE(SUM(grl.received_qty), 0)::numeric AS returned_qty,
    COALESCE(SUM(grl.qc_accepted_qty), 0)::numeric AS accepted_qty,
    COALESCE(SUM(grl.qc_rejected_qty), 0)::numeric AS rejected_qty
  FROM public.jc_ops o
  LEFT JOIN public.goods_receipt_note_lines grl
    ON grl.purchase_order_line_id = o.outsource_po_line_id AND grl.deleted_at IS NULL
  LEFT JOIN public.goods_receipt_notes grn
    ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
  WHERE o.op_type = 'outsource' AND o.deleted_at IS NULL
  GROUP BY o.id
)
SELECT
  o.id                                   AS jc_op_id,
  o.company_id,
  o.op_seq,
  o.operation,
  o.outsource_status,
  jc.id                                  AS job_card_id,
  jc.code                                AS jc_code,
  jc.order_qty                           AS order_qty,
  i.id                                   AS item_id,
  i.code                                 AS item_code,
  i.name                                 AS item_name,
  so.code                                AS so_code,
  COALESCE(v.name, o.outsource_vendor_text) AS vendor_name,
  v.code                                 AS vendor_code,
  COALESCE(o.outsource_sent_qty, 0)      AS sent_qty,
  COALESCE(r.returned_qty, 0)::int       AS returned_qty,
  COALESCE(r.rejected_qty, 0)::int       AS rejected_qty,
  -- Accepted = incoming-QC accepted (0071), not merely returned.
  COALESCE(r.accepted_qty, 0)::int       AS accepted_qty,
  -- Still physically at the vendor: sent minus everything returned.
  GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(r.returned_qty, 0))::int AS at_vendor_qty,
  -- Ordered but not yet even sent to the vendor (unstarted balance).
  GREATEST(0, jc.order_qty - COALESCE(o.outsource_sent_qty, 0))::int AS not_sent_qty,
  -- Returned but incoming-QC still pending (0071, appended last).
  GREATEST(0, COALESCE(r.returned_qty, 0) - COALESCE(r.accepted_qty, 0) - COALESCE(r.rejected_qty, 0))::int AS in_qc_qty
FROM public.jc_ops o
JOIN public.job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
LEFT JOIN public.vendors v ON v.id = o.outsource_vendor_id AND v.deleted_at IS NULL
LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
LEFT JOIN receipts r ON r.jc_op_id = o.id
WHERE o.op_type = 'outsource' AND o.deleted_at IS NULL;
