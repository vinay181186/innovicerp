-- 0070 — outsource op qty is QC-driven: received ≠ accepted (incoming-QC gate).
--
-- Bug: 0065/0068/0069 derived an outsource op's "accepted/done" from the DC
-- receipt (delivery_challan_receipt_lines.received_qty − rejected_qty) = pieces
-- PHYSICALLY back from the vendor. But an OSP return also auto-creates a GRN
-- with a separate INCOMING-QC step (goods_receipt_note_lines.qc_accepted_qty),
-- and stock only credits (grn_qc) at QC-accept. So a line received but pending
-- QC wrongly showed completed_qty = received (JC 23: received 10, QC pending →
-- "Completed 10"), and could even auto-complete/close the JC before QC ran.
--
-- Fix: source outsource quantities from the GRN QC columns instead:
--   received  = SUM(goods_receipt_note_lines.received_qty)
--   accepted  = SUM(goods_receipt_note_lines.qc_accepted_qty)   ← the real "done"
--   rejected  = SUM(goods_receipt_note_lines.qc_rejected_qty)
-- joined via goods_receipt_note_lines.purchase_order_line_id = jc_ops.outsource_po_line_id.
-- Then for outsource ops:
--   completed_qty = accepted            (was received − rejected)
--   available     = input − accepted
--   at_vendor_qty = sent − received     (still physically out)
--   in_qc_qty     = received − accepted − rejected   (NEW, appended last —
--                   returned but incoming-QC still pending)
--   complete only when accepted >= input; a received-pending-QC op reads
--   'received' (relabelled "Incoming QC" in the UI), not complete/in_progress.
-- Verified: SO-517 (QC done) stays accepted 30 / in_qc 0; JC 23 (QC pending)
-- becomes accepted 0 / in_qc 10.
--
-- CREATE OR REPLACE: completed_qty/available change expression (same name/type/
-- position); at_vendor_qty unchanged; in_qc_qty appended as the new last column.
-- Idempotent; applied via src/db/apply-sql.ts.

CREATE OR REPLACE VIEW public.v_jc_op_status AS
WITH op_log_rollup AS (
  SELECT
    jc_op_id,
    SUM(CASE WHEN log_type = 'complete' THEN qty ELSE 0 END) AS completed_qty,
    SUM(CASE WHEN log_type = 'qc' THEN qty ELSE 0 END) AS qc_accepted_qty,
    SUM(CASE WHEN log_type = 'qc' THEN reject_qty ELSE 0 END) AS qc_rejected_qty
  FROM public.op_log
  GROUP BY jc_op_id
),
running_check AS (
  SELECT DISTINCT jc_op_id
  FROM public.running_ops
  WHERE status = 'running'
),
-- Outsource returns are QC'd on their auto-created GRN. Source received /
-- accepted / rejected from goods_receipt_note_lines (not the DC receipt), so
-- "accepted" means incoming-QC passed, not merely physically returned.
outsource_receipts_rollup AS (
  SELECT
    o.id AS jc_op_id,
    COALESCE(SUM(grl.received_qty), 0)::numeric AS osp_received_qty,
    COALESCE(SUM(grl.qc_accepted_qty), 0)::numeric AS osp_accepted_qty,
    COALESCE(SUM(grl.qc_rejected_qty), 0)::numeric AS osp_rejected_qty
  FROM public.jc_ops o
  LEFT JOIN public.goods_receipt_note_lines grl
    ON grl.purchase_order_line_id = o.outsource_po_line_id
    AND grl.deleted_at IS NULL
  LEFT JOIN public.goods_receipt_notes grn
    ON grn.id = grl.goods_receipt_note_id
    AND grn.deleted_at IS NULL
  WHERE o.op_type = 'outsource'
    AND o.deleted_at IS NULL
  GROUP BY o.id
),
prev_op_output AS (
  SELECT
    o.id AS jc_op_id,
    o.job_card_id,
    o.op_seq,
    jc.order_qty AS jc_order_qty,
    LAG(
      CASE
        WHEN o.qc_required OR o.op_type = 'qc'
          THEN COALESCE(r.qc_accepted_qty, 0)
        WHEN o.op_type = 'outsource'
          THEN COALESCE(orr.osp_accepted_qty, 0)
        ELSE COALESCE(r.completed_qty, 0)
      END,
      1
    ) OVER (PARTITION BY o.job_card_id ORDER BY o.op_seq) AS prev_output
  FROM public.jc_ops o
  LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
  LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
  LEFT JOIN public.job_cards jc ON jc.id = o.job_card_id
  WHERE o.deleted_at IS NULL AND jc.deleted_at IS NULL
)
SELECT
  o.id AS jc_op_id,
  o.company_id,
  o.job_card_id,
  o.op_seq,
  o.op_type,
  o.qc_required,
  o.outsource_status,
  -- completed_qty: for outsource ops, "done" = incoming-QC accepted (0070);
  -- other ops keep their op_log completed count.
  CASE
    WHEN o.op_type = 'outsource'
      THEN COALESCE(orr.osp_accepted_qty, 0)::integer
    ELSE COALESCE(r.completed_qty, 0)::integer
  END AS completed_qty,
  COALESCE(r.qc_accepted_qty, 0)::integer AS qc_accepted_qty,
  COALESCE(r.qc_rejected_qty, 0)::integer AS qc_rejected_qty,
  CASE
    WHEN o.op_seq = 1 THEN p.jc_order_qty
    ELSE COALESCE(p.prev_output, 0)
  END::integer AS input_avail,
  -- available: remaining = input − done, where outsource "done" is QC-accepted.
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - (CASE
           WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0)
           ELSE COALESCE(r.completed_qty, 0)
         END)
  ) + COALESCE(o.rework_qty, 0) AS available,
  CASE
    WHEN (o.qc_required OR o.op_type = 'qc') THEN
      GREATEST(
        0,
        (CASE
          WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
          ELSE COALESCE(r.completed_qty, 0)
        END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      )
    ELSE 0
  END AS qc_pending,
  CASE
    -- Complete: output >= order_qty AND (no qc OR qc fully resolved)
    WHEN p.jc_order_qty > 0
      AND (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END) >= p.jc_order_qty
      AND (
        NOT (o.qc_required OR o.op_type = 'qc')
        OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0)
           >= (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END)
      )
      THEN 'complete'
    -- Outsource complete — incoming-QC accepted must meet the op's input qty
    -- (0070). Replaces the received-based test that completed before QC ran.
    WHEN o.op_type = 'outsource'
      AND (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      AND COALESCE(orr.osp_accepted_qty, 0)
          >= (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      THEN 'complete'
    -- QC Pending: qc required and unresolved (in-house QC ops)
    WHEN (o.qc_required OR o.op_type = 'qc')
      AND GREATEST(
        0,
        (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      ) > 0
      THEN 'qc_pending'
    -- Running: an active running_ops session exists
    WHEN rc.jc_op_id IS NOT NULL THEN 'running'
    -- In Progress: some process completion, some in-house QC, or some outsource
    -- qty already QC-ACCEPTED (partial) — not merely received.
    WHEN COALESCE(r.completed_qty, 0) > 0
      OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0) > 0
      OR (o.op_type = 'outsource' AND COALESCE(orr.osp_accepted_qty, 0) > 0)
      THEN 'in_progress'
    -- Incoming QC: outsource qty returned but not yet QC-resolved (0070). Reuses
    -- the 'received' value — relabelled "Incoming QC" in the UI.
    WHEN o.op_type = 'outsource'
      AND (COALESCE(orr.osp_received_qty, 0) - COALESCE(orr.osp_accepted_qty, 0) - COALESCE(orr.osp_rejected_qty, 0)) > 0
      THEN 'received'
    -- Outsource sub-states (mirrors legacy line 1687-1696)
    WHEN o.op_type = 'outsource' THEN
      CASE COALESCE(o.outsource_status::text, 'pending')
        WHEN 'pr_raised'  THEN 'pr_raised'
        WHEN 'po_created' THEN 'po_created'
        WHEN 'sent'       THEN 'at_vendor'
        WHEN 'received'   THEN 'received'
        ELSE
          CASE
            WHEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
              THEN 'ready_for_pr'
            ELSE 'outsource'
          END
      END
    -- Available: input exists, not yet started
    WHEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      THEN 'available'
    -- Default: waiting on prior op
    ELSE 'waiting'
  END AS computed_status,
  -- at_vendor_qty: pieces physically out = sent − received. Kept in its 0069
  -- position (after computed_status) so CREATE OR REPLACE accepts the change.
  GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(orr.osp_received_qty, 0))::integer AS at_vendor_qty,
  -- in_qc_qty (0070): returned from vendor but incoming-QC still pending =
  -- received − accepted − rejected. 0 for non-outsource. MUST be the last column
  -- (CREATE OR REPLACE VIEW only allows appended columns).
  GREATEST(
    0,
    COALESCE(orr.osp_received_qty, 0) - COALESCE(orr.osp_accepted_qty, 0) - COALESCE(orr.osp_rejected_qty, 0)
  )::integer AS in_qc_qty
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
WHERE o.deleted_at IS NULL;
