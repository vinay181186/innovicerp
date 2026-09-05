-- ============================================================
-- 0110_osp_wip_ready_to_send
--
-- Adds `ready_to_send_qty` to v_osp_wip — the OSP At-Vendor Register's answer
-- to "how many pieces can actually go to the vendor RIGHT NOW?".
--
-- Why the register needed it. Every quantity on this view is anchored to
-- `job_cards.order_qty`, so `not_sent_qty` = order − sent. That is an ORDER-level
-- number and it over-states what can be shipped:
--
--   IN-JC-26-00008 op 8 "Coating" — order 100, sent 30. `not_sent_qty` reads 70,
--   inviting the buyer to send 70 more. But op 7 (DIR) has only cleared 30, all
--   30 are already at the vendor, and the remaining 70 are still un-machined at
--   op 5. The true answer is 0.
--
-- `not_sent_qty` is left EXACTLY as it was — it correctly answers "how much of
-- this order still has to be coated eventually", which is what a buyer plans
-- the vendor's week from. The new column answers the different question the
-- same buyer asks on the day, and the two sit side by side.
--
-- The formula mirrors the server-side guard in
-- delivery-challans/cascades.ts (applyOutwardToJcOp), line for line:
--
--     sendable = input_avail − in-house completed − already sent
--
-- so the number the register shows is the number the challan will accept.
-- `input_avail` comes from v_jc_op_status — the previous operation's cleared
-- output (or the JC order qty at op 1) — which is the whole point: it follows
-- the shop floor, not the order.
--
-- One deliberate difference from the guard: the client-material gate
-- (loadMaterialCap — a JWSO job card whose first op waits on the client's
-- material) is NOT subtracted here. It needs per-op party-material lookups that
-- do not belong in a register view, and it only ever LOWERS the cap — so the
-- challan can still refuse a qty this column offered. The column is a planning
-- indicator; the write path stays the authority.
--
-- CREATE OR REPLACE: the existing 22 columns keep their names, types and
-- positions, and the new one is appended at the end (Postgres requires this).
-- Idempotent — re-running simply redefines the view identically.
-- ============================================================

CREATE OR REPLACE VIEW public.v_osp_wip AS
WITH receipts AS (
  SELECT o_1.id AS jc_op_id,
         COALESCE(sum(grl.received_qty), 0::bigint)::numeric    AS returned_qty,
         COALESCE(sum(grl.qc_accepted_qty), 0::bigint)::numeric AS accepted_qty,
         COALESCE(sum(grl.qc_rejected_qty), 0::bigint)::numeric AS rejected_qty
  FROM jc_ops o_1
    LEFT JOIN goods_receipt_note_lines grl
      ON grl.purchase_order_line_id = o_1.outsource_po_line_id AND grl.deleted_at IS NULL
    LEFT JOIN goods_receipt_notes grn
      ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
  WHERE o_1.op_type = 'outsource'::op_type AND o_1.deleted_at IS NULL
  GROUP BY o_1.id
), returned_to_vendor AS (
  SELECT nc.jc_op_id,
         GREATEST(0::numeric, sum(nc.rejected_qty)) AS qty
  FROM nc_register nc
    JOIN jc_ops o_1 ON o_1.id = nc.jc_op_id AND o_1.deleted_at IS NULL
      AND (o_1.op_type = 'outsource'::op_type OR o_1.outsource_po_line_id IS NOT NULL)
  WHERE nc.disposition = 'return_to_vendor'::nc_disposition
    AND nc.status <> 'closed'::nc_status
    AND nc.jc_op_id IS NOT NULL
    AND nc.deleted_at IS NULL
  GROUP BY nc.jc_op_id
), in_house AS (
  -- Pieces finished on the machine for this same op. Zero for a whole
  -- outsource op; non-zero only on the ADR-081 dual lane, where part of an
  -- op runs in-house and the balance goes out. Subtracted so the two lanes
  -- can never together promise more than the op was given.
  SELECT ol.jc_op_id,
         COALESCE(sum(ol.qty), 0)::integer AS done_qty
  FROM op_log ol
  WHERE ol.log_type = 'complete'::op_log_type
  GROUP BY ol.jc_op_id
)
SELECT o.id AS jc_op_id,
  o.company_id,
  o.op_seq,
  o.operation,
  o.outsource_status,
  jc.id AS job_card_id,
  jc.code AS jc_code,
  jc.order_qty,
  i.id AS item_id,
  i.code AS item_code,
  i.name AS item_name,
  so.code AS so_code,
  COALESCE(v.name, o.outsource_vendor_text) AS vendor_name,
  v.code AS vendor_code,
  COALESCE(o.outsource_sent_qty, 0) AS sent_qty,
  COALESCE(r.returned_qty, 0::numeric)::integer AS returned_qty,
  COALESCE(r.rejected_qty, 0::numeric)::integer AS rejected_qty,
  COALESCE(r.accepted_qty, 0::numeric)::integer AS accepted_qty,
  (GREATEST(0::numeric, COALESCE(o.outsource_sent_qty, 0)::numeric - COALESCE(r.returned_qty, 0::numeric))
    + COALESCE(rtv.qty, 0::numeric))::integer AS at_vendor_qty,
  GREATEST(0, jc.order_qty - COALESCE(o.outsource_sent_qty, 0)) AS not_sent_qty,
  GREATEST(0::numeric, COALESCE(r.returned_qty, 0::numeric) - COALESCE(r.accepted_qty, 0::numeric)
    - COALESCE(r.rejected_qty, 0::numeric))::integer AS in_qc_qty,
  COALESCE(rtv.qty, 0::numeric)::integer AS returned_to_vendor_qty,
  -- NEW: what the shop floor has actually cleared into this op, less anything
  -- already done in-house on it and anything already gone to the vendor.
  GREATEST(0,
    COALESCE(s.input_avail, 0)
      - COALESCE(ih.done_qty, 0)
      - COALESCE(o.outsource_sent_qty, 0)
  )::integer AS ready_to_send_qty
FROM jc_ops o
  JOIN job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
  LEFT JOIN items i ON i.id = jc.item_id AND i.deleted_at IS NULL
  LEFT JOIN vendors v ON v.id = o.outsource_vendor_id AND v.deleted_at IS NULL
  LEFT JOIN sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
  LEFT JOIN sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
  LEFT JOIN receipts r ON r.jc_op_id = o.id
  LEFT JOIN returned_to_vendor rtv ON rtv.jc_op_id = o.id
  LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = o.id
  LEFT JOIN in_house ih ON ih.jc_op_id = o.id
WHERE o.op_type = 'outsource'::op_type AND o.deleted_at IS NULL;
