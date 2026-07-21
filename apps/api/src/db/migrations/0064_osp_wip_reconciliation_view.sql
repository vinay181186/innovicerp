-- 0064 — OSP WIP / At-Vendor reconciliation view (read-only).
--
-- Surfaces the "how much is at the vendor / in process" quantity that must NOT
-- live inside the finished-stock ledger (that conflation is what drove on-hand
-- negative — see the SO-517 / CONNECTING ROD trace). One row per outsource
-- jc_op, reconciling every ordered unit into a bucket:
--
--   order_qty = at_vendor + not_yet_sent + returned_accepted(+rejected)
--
-- All numbers are derived from documents already created (JC op counters +
-- delivery_challan receipt lines) — nothing new to key in. Additive/read-only:
-- creating this view changes no existing behaviour.
--
-- Idempotent (CREATE OR REPLACE); applied via src/db/apply-sql.ts.

CREATE OR REPLACE VIEW public.v_osp_wip AS
WITH receipts AS (
  -- Total returned + rejected from the vendor, per outsource op, via the op's
  -- PO line → outward DC lines → receipt lines. Mirrors the rollup already used
  -- by v_jc_op_status so the two stay consistent.
  SELECT
    o.id AS jc_op_id,
    COALESCE(SUM(drl.received_qty), 0)::numeric AS returned_qty,
    COALESCE(SUM(drl.rejected_qty), 0)::numeric AS rejected_qty
  FROM public.jc_ops o
  LEFT JOIN public.delivery_challan_lines dcl
    ON dcl.purchase_order_line_id = o.outsource_po_line_id AND dcl.deleted_at IS NULL
  LEFT JOIN public.delivery_challans dc
    ON dc.id = dcl.delivery_challan_id AND dc.deleted_at IS NULL AND dc.status <> 'cancelled'
  LEFT JOIN public.delivery_challan_receipt_lines drl
    ON drl.delivery_challan_line_id = dcl.id AND drl.deleted_at IS NULL
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
  GREATEST(0, COALESCE(r.returned_qty, 0) - COALESCE(r.rejected_qty, 0))::int AS accepted_qty,
  -- Still physically at the vendor: sent minus everything that came back.
  GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(r.returned_qty, 0))::int AS at_vendor_qty,
  -- Ordered but not yet even sent to the vendor (unstarted balance).
  GREATEST(0, jc.order_qty - COALESCE(o.outsource_sent_qty, 0))::int AS not_sent_qty
FROM public.jc_ops o
JOIN public.job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
LEFT JOIN public.vendors v ON v.id = o.outsource_vendor_id AND v.deleted_at IS NULL
LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
LEFT JOIN receipts r ON r.jc_op_id = o.id
WHERE o.op_type = 'outsource' AND o.deleted_at IS NULL;
