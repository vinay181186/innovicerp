-- 0068 — OSP op quantity columns reflect accepted-back qty (display consistency).
--
-- Follow-up to 0065. 0065 made an outsource op's *status* qty-driven, but left
-- the numeric columns (`completed_qty`, `available`) deriving from op_log
-- 'complete' rows — which outsource ops never have. So the Job Card op detail
-- showed "Order 60 / Input 60 / Done 0 / Avail 60" for IN-JC-26-00020, even
-- though 30 are sent, returned and accepted (register: accepted 30, not-sent 30).
--
-- Fix: for OUTSOURCE ops only, both columns use the accepted qty
-- (received − rejected) as the "done" quantity, exactly like the OSP At-Vendor
-- register and the prev_op_output LAG already do:
--   completed_qty = accepted            (was 0)
--   available     = input − accepted    (was input, i.e. order)
-- Non-outsource ops are byte-for-byte unchanged. The status CASE below is
-- untouched (outsource completion is already governed by the qty-driven branch
-- from 0065). Verified safe against every consumer of these columns:
--   - so-costing machine cost excludes op_type IN ('outsource','qc') → no money
--     impact; outsource cost is PO qty×rate, independent of this view.
--   - op-entry gates + OSP send/PR/PO path short-circuit outsource before any
--     numeric gate (PR/PO qty is order_qty-driven), so send is unaffected.
--   - dispatch + so_progress widget already special-case outsource.
--   - last-op "production credit" (prod-jw/prod-so, jc lastOpCompletedQty) now
--     credits the accepted qty for an outsource-last JC — more correct, not less.
--
-- Idempotent (CREATE OR REPLACE); applied via src/db/apply-sql.ts.

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
    -- must meet the op's required input qty. Replaces the old flag
    -- short-circuit (outsource_status='received') that completed a partially
    -- returned op regardless of qty (SO-517: 30 of 60 back → wrongly closed).
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
    -- In Progress: some process completion OR some QC inspected (accepted or
    -- rejected) OR some outsource qty already returned (0065 — a partially
    -- returned outsource op reads in_progress, not the bare 'received'
    -- sub-state). QC/outsource work does not land in completed_qty.
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
  END AS computed_status
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
WHERE o.deleted_at IS NULL;
