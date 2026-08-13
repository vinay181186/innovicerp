-- 0093 — A piece returned to the vendor sits on the VENDOR's account, not ours.
--
-- User request traced on IN-JC-26-00093 / IN-JWPR-00052 / PLN-0072 (2026-08-12):
-- 5 PLUNGERs went to VND-001 for paint, 5 came back on IN-GRN-00045, incoming QC
-- passed 4 and rejected 1, and the 1 was dispositioned `return_to_vendor`.
--
-- What that did: nc-register/cascades.ts closed the NC and stopped — the module
-- header said so outright, "return_to_vendor → status=closed; no other cascade".
-- The consequences, all confirmed against live data before this change:
--
--   • v_jc_op_status Op5 read pending_qty = 1 (input 5 − osp_accepted 4). The op
--     owed a piece that was never coming back to our bench, so the op could not
--     complete, so the Job Card could not close, so its SO line could not close.
--     Same failure shape as the rework bug 0089 fixed.
--   • at_vendor_qty read 0 — sent 5 − received 5 — even though a piece had just
--     been sent back. Nothing anywhere said the vendor owed a replacement.
--   • The register's own reconciliation, documented in 0071 as
--     `order = accepted + in_qc + at_vendor + not_sent`, came to 49 against an
--     order of 50. Every rejected piece silently fell out of the arithmetic.
--
-- Fix: an open `return_to_vendor` NC puts its rejected qty back into at_vendor
-- and takes it out of pending. The piece is out of the building and owed to us —
-- that is exactly what "at vendor" already means for the qty in transit.
--
-- Derived live from nc_register, like rework in 0088 — no counter to drift, no
-- backfill needed, and the same practical rule the shop already knows from
-- rework: **it stays outstanding until the NC is CLOSED.** The companion change
-- in nc-register/cascades.ts leaves the NC at `disposed` rather than closing it
-- on the spot, and NC Register → Close is what clears it when the replacement
-- lands (or when it is written off).
--
-- Scoped to ops that actually have an OSP lane (op_type='outsource' OR an
-- outsource_po_line_id, matching 0081's dual-lane rule). An in-house QC reject
-- dispositioned return_to_vendor has no vendor to sit with, so it must not move
-- that op's pending — the qty stays where it is and the NC is the record.
--
-- Granularity is the whole NC, not a running balance: a return_to_vendor NC is
-- outstanding in full until closed. Rework carries rework_done_qty for partials;
-- there is no equivalent column here and overloading that one would be a lie
-- about what it holds. Partial replacements are handled by closing the NC and
-- raising the shortfall as its own record.
--
-- CREATE OR REPLACE on both views with the new column APPENDED last — existing
-- columns keep name, type and position, which is what Postgres requires and what
-- the dependent v_jc_status needs. Idempotent; applied via src/db/apply-sql.ts.
-- Ordering: must land AFTER 0090, which is the current definition of
-- v_jc_op_status, and after 0071 for v_osp_wip.

-- ─── v_jc_op_status ────────────────────────────────────────────────────────

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
-- 0093 — pieces sent BACK to the vendor and not yet replaced. Keyed on the op
-- the NC was raised against (nc.jc_op_id), which for an incoming-QC reject is
-- the outsource op itself. Only ops with an OSP lane qualify: a piece can only
-- be "at vendor" if there is a vendor holding it.
returned_to_vendor AS (
  SELECT
    nc.jc_op_id,
    GREATEST(0, SUM(nc.rejected_qty))::numeric AS qty
  FROM public.nc_register nc
  JOIN public.jc_ops o
    ON o.id = nc.jc_op_id
    AND o.deleted_at IS NULL
    AND (o.op_type = 'outsource' OR o.outsource_po_line_id IS NOT NULL)
  WHERE nc.disposition = 'return_to_vendor'
    AND nc.status <> 'closed'
    AND nc.jc_op_id IS NOT NULL
    AND nc.deleted_at IS NULL
  GROUP BY nc.jc_op_id
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
  (COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0))::integer AS completed_qty,
  COALESCE(r.qc_accepted_qty, 0)::integer AS qc_accepted_qty,
  COALESCE(r.qc_rejected_qty, 0)::integer AS qc_rejected_qty,
  CASE
    WHEN o.op_seq = 1 THEN p.jc_order_qty
    ELSE COALESCE(p.prev_output, 0)
  END::integer AS input_avail,
  -- available: as 0090, less anything now sitting with the vendor awaiting a
  -- replacement (0093) — that qty is not work this op can pick up.
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - (CASE
           WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0)
           ELSE COALESCE(r.completed_qty, 0) + COALESCE(o.outsource_sent_qty, 0)
         END)
      - COALESCE(rtv.qty, 0)
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
    -- Complete: output >= order_qty, qc resolved, no rework owed (0089) and
    -- nothing owed back by the vendor (0093). An op waiting on a replacement is
    -- not finished — the same reason rework blocks completion, and the same
    -- consequence if it did not: the JC and its SO line would auto-close with
    -- pieces still outstanding.
    WHEN COALESCE(rw.qty, 0) = 0
      AND COALESCE(rtv.qty, 0) = 0
      AND p.jc_order_qty > 0
      AND (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END) >= p.jc_order_qty
      AND (
        NOT (o.qc_required OR o.op_type = 'qc')
        OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0)
           >= (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END)
      )
      THEN 'complete'
    WHEN COALESCE(rw.qty, 0) = 0
      AND COALESCE(rtv.qty, 0) = 0
      AND o.op_type = 'outsource'
      AND (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      AND COALESCE(orr.osp_accepted_qty, 0)
          >= (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      THEN 'complete'
    WHEN (o.qc_required OR o.op_type = 'qc')
      AND GREATEST(
        0,
        (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      ) > 0
      THEN 'qc_pending'
    WHEN rc.jc_op_id IS NOT NULL THEN 'running'
    WHEN COALESCE(r.completed_qty, 0) > 0
      OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0) > 0
      OR COALESCE(orr.osp_accepted_qty, 0) > 0
      THEN 'in_progress'
    WHEN o.op_type = 'outsource'
      AND (COALESCE(orr.osp_received_qty, 0) - COALESCE(orr.osp_accepted_qty, 0) - COALESCE(orr.osp_rejected_qty, 0)) > 0
      THEN 'received'
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
    WHEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      THEN 'available'
    ELSE 'waiting'
  END AS computed_status,
  -- at_vendor_qty: pieces physically out = still-unreturned (sent − received)
  -- PLUS anything sent back on an open return_to_vendor NC (0093). Both are the
  -- same fact from the shop's point of view: the vendor is holding it.
  (GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(orr.osp_received_qty, 0))
    + COALESCE(rtv.qty, 0))::integer AS at_vendor_qty,
  GREATEST(
    0,
    COALESCE(orr.osp_received_qty, 0) - COALESCE(orr.osp_accepted_qty, 0) - COALESCE(orr.osp_rejected_qty, 0)
  )::integer AS in_qc_qty,
  -- pending_qty (0087) — same expressions as `available` / `qc_pending` above,
  -- selected by op type, so the three can never disagree.
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
          - COALESCE(rtv.qty, 0)
      ) + COALESCE(rw.qty, 0)
  END)::integer AS pending_qty,
  COALESCE(rw.qty, 0)::integer AS rework_pending_qty,
  COALESCE(rr.qty, 0)::integer AS rework_raised_qty,
  rr.to_ops AS rework_raised_to_ops,
  -- 0093, appended last: how much of at_vendor_qty is a rejected piece awaiting
  -- a replacement, as opposed to qty that simply has not come back yet. Lets a
  -- screen say "1 at vendor (replacement owed)" instead of just "1 at vendor".
  COALESCE(rtv.qty, 0)::integer AS returned_to_vendor_qty
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
LEFT JOIN rework_outstanding rw
  ON rw.job_card_id = o.job_card_id AND rw.rework_op_seq = o.op_seq
LEFT JOIN rework_raised rr
  ON rr.job_card_id = o.job_card_id AND rr.op_seq = o.op_seq
LEFT JOIN returned_to_vendor rtv ON rtv.jc_op_id = o.id
WHERE o.deleted_at IS NULL;

--> statement-breakpoint

-- ─── v_osp_wip ─────────────────────────────────────────────────────────────
-- The OSP register has to tell the same story as the op table above, or the two
-- screens disagree about the same vendor. Same rtv term, same source rows.
-- Restores the reconciliation documented in 0071:
--   order = accepted + in_qc + at_vendor + not_sent
-- which was short by exactly the rejected qty before this change.

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
  WHERE o.op_type = 'outsource' AND o.deleted_at IS NULL
  GROUP BY o.id
),
returned_to_vendor AS (
  SELECT
    nc.jc_op_id,
    GREATEST(0, SUM(nc.rejected_qty))::numeric AS qty
  FROM public.nc_register nc
  JOIN public.jc_ops o
    ON o.id = nc.jc_op_id
    AND o.deleted_at IS NULL
    AND (o.op_type = 'outsource' OR o.outsource_po_line_id IS NOT NULL)
  WHERE nc.disposition = 'return_to_vendor'
    AND nc.status <> 'closed'
    AND nc.jc_op_id IS NOT NULL
    AND nc.deleted_at IS NULL
  GROUP BY nc.jc_op_id
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
  -- At vendor = never came back, PLUS sent back on an open return_to_vendor NC.
  (GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(r.returned_qty, 0))
    + COALESCE(rtv.qty, 0))::int         AS at_vendor_qty,
  GREATEST(0, jc.order_qty - COALESCE(o.outsource_sent_qty, 0))::int AS not_sent_qty,
  GREATEST(0, COALESCE(r.returned_qty, 0) - COALESCE(r.accepted_qty, 0) - COALESCE(r.rejected_qty, 0))::int AS in_qc_qty,
  -- 0093, appended last — the replacement-owed slice of at_vendor_qty.
  COALESCE(rtv.qty, 0)::int              AS returned_to_vendor_qty
FROM public.jc_ops o
JOIN public.job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
LEFT JOIN public.vendors v ON v.id = o.outsource_vendor_id AND v.deleted_at IS NULL
LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
LEFT JOIN receipts r ON r.jc_op_id = o.id
LEFT JOIN returned_to_vendor rtv ON rtv.jc_op_id = o.id
WHERE o.op_type = 'outsource' AND o.deleted_at IS NULL;
