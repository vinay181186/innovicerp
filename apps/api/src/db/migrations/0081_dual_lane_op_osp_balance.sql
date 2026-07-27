-- 0081 — Dual-lane operation: a single in-house (process) op can carry an OSP
-- balance (ADR-081). Enables "outsource the remaining qty of an operation" in the
-- SAME Job Card, for total and partial splits.
--
-- Model: every jc_op already has the outsource_* fields; today they are only
-- populated when op_type='outsource'. This makes a process op able to ALSO carry
-- an OSP sub-order via its own outsource_po_line_id — so its "done" (output) =
-- in-house op_log complete + incoming-QC-accepted OSP return, and the two lanes
-- rejoin so the next op / dispatch see the full qty.
--
-- Changes (all provably a NO-OP for existing rows — osp_accepted_qty is 0 for
-- every op that has no outsource_po_line_id, which is every current non-outsource
-- op, so every "+ osp_accepted" term below adds 0 to current data):
--   1. outsource_receipts_rollup: drop the op_type='outsource' filter so a
--      process op with an outsource_po_line_id also gets its GRN-accepted summed.
--   2. completed_qty / prev_output / complete-test / in_progress: use
--      op_log_completed + osp_accepted (the recombine).
--   3. available: op-type-conditional — OUTSOURCE ops keep input - accepted
--      (unchanged); PROCESS/other ops become input - op_log_completed -
--      outsource_sent_qty (subtracts qty already sent to a vendor, so you can't
--      double-work the in-transit balance; no-op when sent_qty = 0, i.e. all
--      current process ops).
--   4. v_osp_wip: include process ops that carry OSP activity so the At-Vendor
--      register shows the split (order = accepted + in_qc + at_vendor + not_sent,
--      where not_sent = the in-house-kept portion).
--
-- CREATE OR REPLACE: same output columns/order/types (only expressions + WHERE/
-- CTE change), so replace is accepted. Idempotent; applied via src/db/apply-sql.ts.

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
-- OSP receipts per op, via the op's PO line. NOW for ANY op that has an
-- outsource_po_line_id (0081) — not just op_type='outsource' — so a dual-lane
-- process op picks up its incoming-QC-accepted balance. Ops with no PO line get
-- 0 (LEFT JOIN on a NULL po_line_id matches nothing).
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
  WHERE o.deleted_at IS NULL
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
        -- dual-lane: an op's output = in-house completed + OSP-accepted (0081)
        ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0)
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
  -- completed_qty (done/output): in-house op_log complete + OSP incoming-QC
  -- accepted. For a pure outsource op op_log=0 → = accepted; pure process
  -- accepted=0 → = op_log; dual = both (0081).
  (COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0))::integer AS completed_qty,
  COALESCE(r.qc_accepted_qty, 0)::integer AS qc_accepted_qty,
  COALESCE(r.qc_rejected_qty, 0)::integer AS qc_rejected_qty,
  CASE
    WHEN o.op_seq = 1 THEN p.jc_order_qty
    ELSE COALESCE(p.prev_output, 0)
  END::integer AS input_avail,
  -- available (remaining capacity to work/send): OUTSOURCE ops keep input −
  -- accepted (unchanged). Other ops = input − op_log_completed − sent, so a qty
  -- already sent to a vendor can't be re-worked in-house (no-op when sent=0).
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - (CASE
           WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0)
           ELSE COALESCE(r.completed_qty, 0) + COALESCE(o.outsource_sent_qty, 0)
         END)
  ) + COALESCE(o.rework_qty, 0) AS available,
  CASE
    WHEN (o.qc_required OR o.op_type = 'qc') THEN
      GREATEST(
        0,
        (CASE
          WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
          ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0)
        END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      )
    ELSE 0
  END AS qc_pending,
  CASE
    -- Complete: output (in-house + OSP-accepted) >= order_qty AND qc resolved.
    WHEN p.jc_order_qty > 0
      AND (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END) >= p.jc_order_qty
      AND (
        NOT (o.qc_required OR o.op_type = 'qc')
        OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0)
           >= (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END)
      )
      THEN 'complete'
    -- Whole outsource op complete — incoming-QC accepted meets its input qty.
    WHEN o.op_type = 'outsource'
      AND (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      AND COALESCE(orr.osp_accepted_qty, 0)
          >= (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      THEN 'complete'
    -- QC Pending: qc required and unresolved (in-house QC ops)
    WHEN (o.qc_required OR o.op_type = 'qc')
      AND GREATEST(
        0,
        (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      ) > 0
      THEN 'qc_pending'
    -- Running: an active running_ops session exists
    WHEN rc.jc_op_id IS NOT NULL THEN 'running'
    -- In Progress: some in-house completion, some in-house QC, or some OSP qty
    -- already QC-accepted (partial) — covers a dual-lane op mid-flight.
    WHEN COALESCE(r.completed_qty, 0) > 0
      OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0) > 0
      OR COALESCE(orr.osp_accepted_qty, 0) > 0
      THEN 'in_progress'
    -- Incoming QC: outsource qty returned but not yet QC-resolved.
    WHEN o.op_type = 'outsource'
      AND (COALESCE(orr.osp_received_qty, 0) - COALESCE(orr.osp_accepted_qty, 0) - COALESCE(orr.osp_rejected_qty, 0)) > 0
      THEN 'received'
    -- Outsource sub-states (whole outsource ops only)
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
    ELSE 'waiting'
  END AS computed_status,
  -- at_vendor_qty: pieces physically out = sent − received (any op with sent qty).
  GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(orr.osp_received_qty, 0))::integer AS at_vendor_qty,
  -- in_qc_qty: returned from vendor but incoming-QC still pending.
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
--> statement-breakpoint

-- OSP At-Vendor register: include dual-lane process ops that carry OSP activity
-- so the split is visible. Reconciliation identity unchanged: order = accepted +
-- in_qc + at_vendor + not_sent (not_sent = the in-house-kept portion).
CREATE OR REPLACE VIEW public.v_osp_wip AS
WITH receipts AS (
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
  WHERE o.deleted_at IS NULL
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
  COALESCE(r.accepted_qty, 0)::int       AS accepted_qty,
  GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(r.returned_qty, 0))::int AS at_vendor_qty,
  GREATEST(0, jc.order_qty - COALESCE(o.outsource_sent_qty, 0))::int AS not_sent_qty,
  GREATEST(0, COALESCE(r.returned_qty, 0) - COALESCE(r.accepted_qty, 0) - COALESCE(r.rejected_qty, 0))::int AS in_qc_qty
FROM public.jc_ops o
JOIN public.job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
LEFT JOIN public.vendors v ON v.id = o.outsource_vendor_id AND v.deleted_at IS NULL
LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
LEFT JOIN receipts r ON r.jc_op_id = o.id
WHERE (o.op_type = 'outsource' OR o.outsource_po_line_id IS NOT NULL OR COALESCE(o.outsource_sent_qty, 0) > 0)
  AND o.deleted_at IS NULL;
