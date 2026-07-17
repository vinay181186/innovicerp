-- Bug #7: a partially-QC'd operation showed 'available' instead of 'in_progress'.
-- QC work accrues to qc_accepted_qty / qc_rejected_qty (never completed_qty), but
-- the computed_status 'in_progress' rung only tested completed_qty > 0, so a QC op
-- that inspected all currently-available input (nothing pending) but whose input
-- was below order_qty fell through to 'available'. Fix: the in_progress rung also
-- treats any QC inspection (accepted or rejected) as progress.
--
-- Only the computed_status CASE value changes; the view's column set is identical,
-- so CREATE OR REPLACE is safe and v_jc_status (which depends on this view) is
-- unaffected. Recreated verbatim from 0019_phase6_dc_receipts.sql except the one
-- marked rung.
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
  COALESCE(r.completed_qty, 0)::integer AS completed_qty,
  COALESCE(r.qc_accepted_qty, 0)::integer AS qc_accepted_qty,
  COALESCE(r.qc_rejected_qty, 0)::integer AS qc_rejected_qty,
  CASE
    WHEN o.op_seq = 1 THEN p.jc_order_qty
    ELSE COALESCE(p.prev_output, 0)
  END::integer AS input_avail,
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - COALESCE(r.completed_qty, 0)
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
    -- Outsource fully received — short-circuits the sub-state CASE below
    WHEN o.op_type = 'outsource' AND o.outsource_status = 'received' THEN 'complete'
    -- QC Pending: qc required and unresolved
    WHEN (o.qc_required OR o.op_type = 'qc')
      AND GREATEST(
        0,
        (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      ) > 0
      THEN 'qc_pending'
    -- Running: an active running_ops session exists
    WHEN rc.jc_op_id IS NOT NULL THEN 'running'
    -- In Progress: some process completion OR some QC inspected (accepted or
    -- rejected). QC work lands in qc_accepted_qty/qc_rejected_qty, not
    -- completed_qty, so the QC term is required or a partially-QC'd op falls
    -- through to 'available' (bug #7).
    WHEN COALESCE(r.completed_qty, 0) > 0
      OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0) > 0
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
  END AS computed_status
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
WHERE o.deleted_at IS NULL;
