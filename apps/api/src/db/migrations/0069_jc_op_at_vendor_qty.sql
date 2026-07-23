-- 0069 — expose at-vendor qty on v_jc_op_status (Job Card op detail column).
--
-- Adds one column `at_vendor_qty` = pieces physically out for processing at the
-- vendor = outsource_sent_qty − received (floored at 0). 0 for non-outsource
-- ops. Lets the JC op table show the in-process portion of an outsource op's
-- Pending (Pending = At-Vendor + Not-Sent). Mirrors v_osp_wip.at_vendor_qty.
--
-- Full recreate of 0068 + the new column; everything else byte-for-byte
-- identical. Idempotent (CREATE OR REPLACE); applied via src/db/apply-sql.ts.

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
outsource_receipts_rollup AS (
  SELECT
    o.id AS jc_op_id,
    COALESCE(SUM(drl.received_qty), 0)::numeric AS outsource_received_qty,
    COALESCE(SUM(drl.rejected_qty), 0)::numeric AS outsource_rejected_qty
  FROM public.jc_ops o
  LEFT JOIN public.delivery_challan_lines dcl
    ON dcl.purchase_order_line_id = o.outsource_po_line_id
    AND dcl.deleted_at IS NULL
  LEFT JOIN public.delivery_challans dc
    ON dc.id = dcl.delivery_challan_id
    AND dc.deleted_at IS NULL
    AND dc.status <> 'cancelled'
  LEFT JOIN public.delivery_challan_receipt_lines drl
    ON drl.delivery_challan_line_id = dcl.id
    AND drl.deleted_at IS NULL
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
          THEN GREATEST(
            0,
            COALESCE(orr.outsource_received_qty, 0) - COALESCE(orr.outsource_rejected_qty, 0)
          )
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
  -- completed_qty: for outsource ops, the "done" qty is accepted (received −
  -- rejected); other ops keep their op_log completed count (0068).
  CASE
    WHEN o.op_type = 'outsource'
      THEN GREATEST(0, COALESCE(orr.outsource_received_qty, 0) - COALESCE(orr.outsource_rejected_qty, 0))::integer
    ELSE COALESCE(r.completed_qty, 0)::integer
  END AS completed_qty,
  COALESCE(r.qc_accepted_qty, 0)::integer AS qc_accepted_qty,
  COALESCE(r.qc_rejected_qty, 0)::integer AS qc_rejected_qty,
  CASE
    WHEN o.op_seq = 1 THEN p.jc_order_qty
    ELSE COALESCE(p.prev_output, 0)
  END::integer AS input_avail,
  -- available: remaining to complete = input − done, where "done" for an
  -- outsource op is the accepted qty (0068); other ops use op_log completed.
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - (CASE
           WHEN o.op_type = 'outsource'
             THEN GREATEST(0, COALESCE(orr.outsource_received_qty, 0) - COALESCE(orr.outsource_rejected_qty, 0))
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
    -- Outsource complete — QTY-DRIVEN (0065). Accepted (received − rejected)
    -- must meet the op's required input qty.
    WHEN o.op_type = 'outsource'
      AND (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      AND GREATEST(0, COALESCE(orr.outsource_received_qty, 0) - COALESCE(orr.outsource_rejected_qty, 0))
          >= (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      THEN 'complete'
    -- QC Pending: qc required and unresolved
    WHEN (o.qc_required OR o.op_type = 'qc')
      AND GREATEST(
        0,
        (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      ) > 0
      THEN 'qc_pending'
    -- Running: an active running_ops session exists
    WHEN rc.jc_op_id IS NOT NULL THEN 'running'
    -- In Progress: some process completion OR some QC inspected OR some
    -- outsource qty already returned (0065).
    WHEN COALESCE(r.completed_qty, 0) > 0
      OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0) > 0
      OR (o.op_type = 'outsource'
          AND GREATEST(0, COALESCE(orr.outsource_received_qty, 0) - COALESCE(orr.outsource_rejected_qty, 0)) > 0)
      THEN 'in_progress'
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
  -- at_vendor_qty (0069): pieces physically out at the vendor = sent − received,
  -- floored at 0. 0 for non-outsource ops. Mirrors v_osp_wip.at_vendor_qty.
  -- MUST be the last column — CREATE OR REPLACE VIEW only allows appended columns.
  GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(orr.outsource_received_qty, 0))::integer AS at_vendor_qty
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
WHERE o.deleted_at IS NULL;
