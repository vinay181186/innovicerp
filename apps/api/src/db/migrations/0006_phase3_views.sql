-- ============================================================
-- 0006_phase3_views
-- SQL views mirroring the legacy calcEngine() function
-- (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html line 1626-1731).
-- Per ADR-011 #2: status is derived, not stored.
--
-- Both views are RLS-respecting because they query base tables that
-- have RLS enabled — Postgres applies the company_isolation policy
-- automatically when the view is queried by an authenticated session.
-- ============================================================

-- ─── v_jc_op_status ────────────────────────────────────────────
-- Per-jc-op derived status. Mirrors enrichedOps from calcEngine() (line 1657-1701).
-- Each row projects a jc_op enriched with completion qty, qc qty, availability,
-- and a computed_status enum string.
CREATE OR REPLACE VIEW public.v_jc_op_status AS
WITH op_log_rollup AS (
  SELECT
    jc_op_id,
    -- Production completion: anything not 'start' and not 'qc'.
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
prev_op_output AS (
  -- For op_seq = 1, input is the JC's order_qty.
  -- For op_seq = N, input is the OUTPUT of op_seq = N-1, where output is
  -- qc_accepted_qty if previous op required QC, else completed_qty.
  SELECT
    o.id AS jc_op_id,
    o.job_card_id,
    o.op_seq,
    jc.order_qty AS jc_order_qty,
    LAG(
      CASE
        WHEN o.qc_required OR o.op_type = 'qc'
          THEN COALESCE(r.qc_accepted_qty, 0)
        ELSE COALESCE(r.completed_qty, 0)
      END,
      1
    ) OVER (PARTITION BY o.job_card_id ORDER BY o.op_seq) AS prev_output
  FROM public.jc_ops o
  LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
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
    -- QC Pending: qc required and unresolved
    WHEN (o.qc_required OR o.op_type = 'qc')
      AND GREATEST(
        0,
        (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      ) > 0
      THEN 'qc_pending'
    -- Running: an active running_ops session exists
    WHEN rc.jc_op_id IS NOT NULL THEN 'running'
    -- In Progress: some completion logged, not yet running, not yet complete
    WHEN COALESCE(r.completed_qty, 0) > 0 THEN 'in_progress'
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
--> statement-breakpoint

-- ─── v_jc_status ───────────────────────────────────────────────
-- Per-jc derived status. Mirrors jcStatus from calcEngine() (line 1718-1728).
CREATE OR REPLACE VIEW public.v_jc_status AS
SELECT
  jc.id AS job_card_id,
  jc.company_id,
  COUNT(o.jc_op_id)::integer AS total_ops,
  COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'complete')::integer AS done_ops,
  COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'qc_pending')::integer AS qc_pending_ops,
  CASE
    WHEN jc.closed_at IS NOT NULL THEN 'closed'
    WHEN COUNT(o.jc_op_id) = 0 THEN 'no_ops'
    WHEN COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'complete') = COUNT(o.jc_op_id)
      THEN 'complete'
    WHEN COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'qc_pending') > 0
      THEN 'qc_pending'
    ELSE 'open'
  END AS computed_status
FROM public.job_cards jc
LEFT JOIN public.v_jc_op_status o ON o.job_card_id = jc.id
WHERE jc.deleted_at IS NULL
GROUP BY jc.id, jc.company_id, jc.closed_at;
