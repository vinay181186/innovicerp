-- 0087 — One canonical `pending_qty` per operation.
--
-- Problem this closes (audit of IN-JC-26-00085, 2026-08-10): three screens each
-- computed "pending" for themselves and disagreed on the SAME op.
--   • JC detail card   `inputAvail − qcAccepted`  → Op2 read 5
--   • Op Entry table   `available`                 → Op2 read 50
--   • QC dashboards    `qc_pending` (this view)    → Op2 read 0  ← the truth
-- The JC card's formula subtracts what QC ACCEPTED but not what it REJECTED, so
-- every rejected piece stayed on that screen as "still to inspect" forever —
-- even after its NC was dispositioned. On JC-85 the 5 rejected pins were shown
-- twice over: as rework owed at Op1 AND as pending inspection at Op2.
--
-- Worse, it grew: once the 5 are re-cut and logged at Op1, Op1's completed goes
-- 50 → 55, so the card would have printed 55 − 45 = 10 pending at a QC op that
-- has 5 pieces left to see.
--
-- Fix: the view publishes the number, React prints it. Per CLAUDE.md §6 rule 1
-- the pending calculation is business logic and does not belong in a component.
--
-- `pending_qty` is deliberately NOT new maths — it selects between the two
-- correct columns this view already computes:
--   QC op    → qc_pending  (input − accepted − rejected; a reject IS resolved)
--   any other→ available   (input − done − sent + rework; work still to do here)
-- so it cannot drift from `available` / `qc_pending`, and every existing
-- consumer of those two columns keeps its current value.
--
-- CREATE OR REPLACE with the new column APPENDED — existing columns keep their
-- name, type and order, which is what Postgres requires (and what the dependent
-- v_jc_status needs). Idempotent; applied via src/db/apply-sql.ts.

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
-- OSP receipts per op, via the op's PO line. For ANY op that has an
-- outsource_po_line_id (0081) — not just op_type='outsource' — so a dual-lane
-- process op picks up its incoming-QC-accepted balance.
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
  )::integer AS in_qc_qty,
  -- pending_qty (0087) — THE number every screen shows as "Pending". A QC op
  -- resolves a piece by accepting OR rejecting it, so its pending is
  -- qc_pending; every other op's pending is the work still on its bench, which
  -- is `available`. Same expressions as the two columns above, selected by op
  -- type — no independent maths, so the three can never disagree again.
  (CASE
    WHEN o.op_type = 'qc' THEN
      GREATEST(
        0,
        (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
          - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      )
    ELSE
      GREATEST(
        0,
        (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
          - (CASE
               WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0)
               ELSE COALESCE(r.completed_qty, 0) + COALESCE(o.outsource_sent_qty, 0)
             END)
      ) + COALESCE(o.rework_qty, 0)
  END)::integer AS pending_qty
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
WHERE o.deleted_at IS NULL;
