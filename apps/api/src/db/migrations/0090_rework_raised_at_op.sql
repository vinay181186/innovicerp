-- 0090 — The op that REJECTED shows what became of the rejects.
--
-- User request against IN-JC-26-00085 (2026-08-10): "5 reject show in jc screen.
-- when 5 reject take action as rework, status must update in jc screen op-2 —
-- 5 rework."
--
-- 0088 gave us `rework_pending_qty`, grouped on the op the NC sent work back TO
-- (rework_op_seq). That lights Op1 — correct, the re-cutting happens there — but
-- leaves Op2, the QC op that actually found the fault, saying only "✗5 rej" with
-- no sign of what was decided. The QC engineer looking at their own operation
-- cannot tell a reject awaiting a disposition from one already sent for rework.
--
-- `rework_raised_qty` is the mirror image: the same open-NC balance grouped on
-- nc.op_seq — the op where the NC was RAISED — plus `rework_raised_to_ops`, a
-- comma-separated list of the target op seqs, so the card can render "♻5 → Op1".
-- Same source rows and same open-NC filter as rework_pending_qty, so the two
-- always tell the same story from the two ends, and both clear together when the
-- NC is closed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Carried from 0089 — an operation that owes rework is NOT complete
-- (ADR-111 §Open item 1, ADR-113).
-- The `complete` branch below fires on output >= order_qty and never asked
-- whether the op still owes rework, so Op1 of JC-85 read `complete` while 5
-- pins sat waiting to be re-cut.
--
-- That is not cosmetic. v_jc_status (0006_phase3_views.sql:145) calls a Job Card
-- complete when EVERY op reads complete, and op-entry/sales-cascade.ts:106
-- then stamps job_cards.closed_at and closes the source SO/JW line. So a Job
-- Card whose only outstanding work was rework could auto-close and close its
-- sales-order line with pieces still owed.
--
-- Fix: both `complete` branches gain `AND COALESCE(rw.qty, 0) = 0`. A fully
-- produced op with rework owed falls through to `in_progress` — which is what
-- it is — and the JC stays open until the NC is closed.
--
-- ORDERING: this had to land AFTER 0088. Against the old never-decrementing
-- jc_ops.rework_qty counter, an op that ever had rework could never complete
-- again, so its Job Card would never close and its SO line would never close.
-- 0088 made the balance clearable; only then is blocking on it safe.
--
-- Already-closed Job Cards are unaffected — v_jc_status returns 'closed' from
-- closed_at before it counts ops, and the sales cascade is one-way.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Carried from 0088 — rework counts DOWN, derived from the NC that ordered it
-- rather than from a counter that only ever goes up (ADR-112):
-- `nc-register/cascades.ts:130` ADDS the rejected qty to jc_ops.rework_qty when
-- an NC is dispositioned `rework`. Nothing ever subtracts it:
-- `closeNcReworkCascade` (:369-409) records nc_register.rework_done_qty and
-- flips the NC to `closed`, but leaves the counter alone. So once the 5 pins on
-- JC-85 are re-cut and logged, Op1 reads
--   available = GREATEST(0, 50 − 55) + 5 = 5
-- forever — a permanent phantom 5 pieces of work on a finished operation, and
-- (since 0087) a permanent 5 in the Pending column too.
--
-- Fix: `rework_pending_qty` is SUMmed live from nc_register —
--   rejected_qty − COALESCE(rework_done_qty, 0), over rework NCs not yet closed,
--   grouped onto the op the NC sent the work back to (job_card_id + rework_op_seq)
-- and `available` / `pending_qty` use THAT instead of jc_ops.rework_qty. One
-- source of truth, self-healing, and no backfill: the NC rows already carry
-- every fact needed. jc_ops.rework_qty stays untouched as the audit trail of
-- what was ever raised against the op.
--
-- Practical rule this creates: **rework stays outstanding until the NC is
-- closed.** NC Register → the NC → Close Rework is what clears it. Closing
-- without entering a done-qty still clears it in full (the row leaves the
-- `status <> 'closed'` set), so the qty field stays optional, as it is today.
--
-- Nothing here changes an op's STATUS — an op still reads `complete` while it
-- owes rework, which is ADR-111 §Open item 1 and a separate change. This one
-- has to land first: fixing completion against a counter that never came down
-- would mean an op that ever had rework could never complete, so its Job Card
-- would never close and its SO line would never close.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Carried from 0087 — one canonical `pending_qty` per operation:
--   QC op    → qc_pending  (input − accepted − rejected; a reject IS resolved)
--   any other→ available   (input − done − sent + rework; work still to do here)
-- so it cannot drift from `available` / `qc_pending`.
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
-- Rework still owed, per (job card, op it was sent back to). Live from the NC
-- register (0088): a rework NC counts until it is CLOSED, less whatever
-- rework_done_qty was already recorded against it. `pending` NCs carry no
-- disposition yet, and scrap / use-as-is dispositions never appear here.
-- GREATEST guards a done-qty entered larger than the rejected qty.
rework_outstanding AS (
  SELECT
    nc.job_card_id,
    nc.rework_op_seq,
    GREATEST(0, SUM(nc.rejected_qty - COALESCE(nc.rework_done_qty, 0)))::numeric AS qty
  FROM public.nc_register nc
  WHERE nc.disposition = 'rework'
    AND nc.status <> 'closed'
    AND nc.rework_op_seq IS NOT NULL
    AND nc.deleted_at IS NULL
  GROUP BY nc.job_card_id, nc.rework_op_seq
),
-- The mirror of rework_outstanding (0090): the same open-NC balance grouped on
-- the op that RAISED the NC, so the QC op that rejected can say what became of
-- its rejects. `to_ops` lists the target op seq(s) for the "♻5 → Op1" label.
rework_raised AS (
  SELECT
    nc.job_card_id,
    nc.op_seq,
    GREATEST(0, SUM(nc.rejected_qty - COALESCE(nc.rework_done_qty, 0)))::numeric AS qty,
    string_agg(DISTINCT nc.rework_op_seq::text, ', ') AS to_ops
  FROM public.nc_register nc
  WHERE nc.disposition = 'rework'
    AND nc.status <> 'closed'
    AND nc.op_seq IS NOT NULL
    AND nc.rework_op_seq IS NOT NULL
    AND nc.deleted_at IS NULL
  GROUP BY nc.job_card_id, nc.op_seq
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
  -- + rework STILL OWED (0088), from the NC register — not jc_ops.rework_qty,
  -- which only ever increments and so never let a reworked op finish.
  ) + COALESCE(rw.qty, 0) AS available,
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
    -- Complete: output (in-house + OSP-accepted) >= order_qty, qc resolved,
    -- AND no rework owed (0089 — an op with pieces waiting to be re-worked is
    -- not finished, and letting it read `complete` let the JC and its SO line
    -- auto-close with work outstanding).
    WHEN COALESCE(rw.qty, 0) = 0
      AND p.jc_order_qty > 0
      AND (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END) >= p.jc_order_qty
      AND (
        NOT (o.qc_required OR o.op_type = 'qc')
        OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0)
           >= (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END)
      )
      THEN 'complete'
    -- Whole outsource op complete — incoming-QC accepted meets its input qty.
    -- Same rework guard (0089): an NC can send work back to an outsource op.
    WHEN COALESCE(rw.qty, 0) = 0
      AND o.op_type = 'outsource'
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
      ) + COALESCE(rw.qty, 0)
  END)::integer AS pending_qty,
  -- rework_pending_qty (0088) — pieces this op still owes rework on. What the
  -- ♻ marker on the JC card and the Op Entry table shows. Distinct from
  -- jc_ops.rework_qty, which is the running total ever RAISED against the op
  -- and is now audit trail only.
  COALESCE(rw.qty, 0)::integer AS rework_pending_qty,
  -- rework_raised_qty (0090) — pieces THIS op rejected that are currently out
  -- for rework somewhere. Lights the QC op that found the fault, where
  -- rework_pending_qty lights the op that has to redo the work. Both clear
  -- together when the NC is closed.
  COALESCE(rr.qty, 0)::integer AS rework_raised_qty,
  -- Which op(s) those pieces went back to, e.g. '1' or '1, 3' — for the label.
  rr.to_ops AS rework_raised_to_ops
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
LEFT JOIN rework_outstanding rw
  ON rw.job_card_id = o.job_card_id AND rw.rework_op_seq = o.op_seq
LEFT JOIN rework_raised rr
  ON rr.job_card_id = o.job_card_id AND rr.op_seq = o.op_seq
WHERE o.deleted_at IS NULL;
