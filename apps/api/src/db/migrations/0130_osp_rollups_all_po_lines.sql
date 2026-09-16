-- ============================================================
-- 0130_osp_rollups_all_po_lines — gap G9 (second bullet)
-- (docs/audits/2026-09-16-osp-chain-gap-report.md)
--
-- An outsourced op can follow MORE THAN ONE purchase-order line (0118,
-- jc_op_po_lines; ADR-152 phase 4). The DC-out and receive-back guards already
-- read every link, but the GRN rollups inside v_jc_op_status and v_osp_wip
-- still joined goods_receipt_note_lines on jc_ops.outsource_po_line_id — the
-- FIRST line only. An op split over two POs therefore rolled up only the first
-- PO's receipts: the second PO's pieces never showed as received / in QC /
-- accepted, the op never read `complete`, and the OSP register under-stated.
--
-- Re-emits BOTH views (last full text: 0128) with CREATE OR REPLACE and the
-- identical column list, order and type. ONE change in each, in the receipts
-- rollup only:
--   before: LEFT JOIN goods_receipt_note_lines grl
--             ON grl.purchase_order_line_id = o.outsource_po_line_id
--   after:  LEFT JOIN op_po_lines opl ON opl.jc_op_id = o.id
--           LEFT JOIN goods_receipt_note_lines grl
--             ON grl.purchase_order_line_id = opl.purchase_order_line_id
--   where op_po_lines = (jc_ops.outsource_po_line_id) UNION (live
--   jc_op_po_lines rows). UNION is set-distinct, so an op whose legacy column
--   also has a link row yields ONE (op, PO line) pair and no GRN line is ever
--   summed twice. Legacy ops (pre-0118, no link rows) keep working via the
--   first arm. Every downstream expression is unchanged.
--
-- ROLLBACK: re-run 0128 (same column lists, CREATE OR REPLACE).
-- Idempotent. Apply to BOTH the production and the test database.
-- ============================================================

BEGIN;
--> statement-breakpoint

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
-- 0130 — every PO line the op follows (jc_op_po_lines, 0118) UNIONed with the
-- legacy single column (ops that pre-date 0118 have no link rows). UNION is
-- set-distinct, so one (op, PO line) pair appears once and a GRN line can
-- never be summed twice even when it matches both sources.
op_po_lines AS (
  SELECT o.id AS jc_op_id, o.outsource_po_line_id AS purchase_order_line_id
  FROM public.jc_ops o
  WHERE o.deleted_at IS NULL AND o.outsource_po_line_id IS NOT NULL
  UNION
  SELECT l.jc_op_id, l.purchase_order_line_id
  FROM public.jc_op_po_lines l
  WHERE l.deleted_at IS NULL
),
-- 0128 — osp_received_qty stays ALL GRNs (feeds in_qc_qty: a replacement
-- awaiting QC is in QC). osp_ordinary_received_qty counts only GRNs whose
-- header has no nc_id — receipts against the PO itself, never a replacement —
-- and is the only thing at_vendor_qty nets against outsource_sent_qty.
-- 0130 — GRN lines are matched through op_po_lines (all the op's PO lines),
-- not jc_ops.outsource_po_line_id alone.
outsource_receipts_rollup AS (
  SELECT
    o.id AS jc_op_id,
    COALESCE(SUM(grl.received_qty), 0)::numeric AS osp_received_qty,
    COALESCE(SUM(grl.received_qty) FILTER (WHERE grn.nc_id IS NULL), 0)::numeric AS osp_ordinary_received_qty,
    COALESCE(SUM(grl.qc_accepted_qty), 0)::numeric AS osp_accepted_qty,
    COALESCE(SUM(grl.qc_rejected_qty), 0)::numeric AS osp_rejected_qty
  FROM public.jc_ops o
  LEFT JOIN op_po_lines opl
    ON opl.jc_op_id = o.id
  LEFT JOIN public.goods_receipt_note_lines grl
    ON grl.purchase_order_line_id = opl.purchase_order_line_id
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
-- 0124 — OPEN rework/repair CHILD JC reworks, keyed on the op the reject was
-- raised on (nc.op_seq). Unlike rework_outstanding this does NOT require
-- rework_op_seq (child-JC reworks leave it NULL); it keys off child_job_card_id
-- instead. Feeds the `complete` gate ONLY — never `available` / `pending_qty`.
rework_child_open AS (
  SELECT
    nc.job_card_id,
    nc.op_seq,
    GREATEST(0, SUM(nc.rejected_qty - nc.cleared_qty - nc.failed_qty))::numeric AS qty
  FROM public.nc_register nc
  WHERE nc.disposition IN ('rework', 'repair')
    AND nc.status <> 'closed'
    AND nc.child_job_card_id IS NOT NULL
    AND nc.op_seq IS NOT NULL
    AND nc.deleted_at IS NULL
  GROUP BY nc.job_card_id, nc.op_seq
),
-- 0093 / 0128 — open return_to_vendor NCs keyed on the op the NC was raised
-- against (nc.jc_op_id), which for an incoming-QC reject is the outsource op
-- itself. Only ops with an OSP lane qualify. Two numbers (0128):
--   at_vendor_qty — Σ(rtv_sent − rtv_received) over NCs that have a challan:
--                   pieces physically with the vendor right now. Zero while
--                   the NC is merely disposed and zero again once the
--                   replacement has been received.
--   open_qty      — Σ(rejected − cleared − failed): pieces not yet recovered,
--                   wherever they are. Subtracted from `available` and gates
--                   the `complete` branches so a rejected piece is never
--                   offered as work and never lets the op finish early.
returned_to_vendor AS (
  SELECT
    nc.jc_op_id,
    GREATEST(0, COALESCE(SUM(nc.rtv_sent_qty - nc.rtv_received_qty)
      FILTER (WHERE nc.delivery_challan_id IS NOT NULL), 0))::numeric AS at_vendor_qty,
    GREATEST(0, SUM(nc.rejected_qty - nc.cleared_qty - nc.failed_qty))::numeric AS open_qty
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
          THEN COALESCE(orr.osp_accepted_qty, 0) + COALESCE(r.qc_accepted_qty, 0)
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
  (COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0)
    + CASE WHEN o.op_type = 'outsource' THEN COALESCE(r.qc_accepted_qty, 0) ELSE 0 END)::integer AS completed_qty,
  COALESCE(r.qc_accepted_qty, 0)::integer AS qc_accepted_qty,
  COALESCE(r.qc_rejected_qty, 0)::integer AS qc_rejected_qty,
  CASE
    WHEN o.op_seq = 1 THEN p.jc_order_qty
    ELSE COALESCE(p.prev_output, 0)
  END::integer AS input_avail,
  -- available: as 0090, less every return_to_vendor piece not yet recovered
  -- (0093, 0128: open_qty, not the raw rejected qty) — that qty is not work
  -- this op can pick up.
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - (CASE
           WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0) + COALESCE(r.qc_accepted_qty, 0)
           ELSE COALESCE(r.completed_qty, 0) + COALESCE(o.outsource_sent_qty, 0)
         END)
      - COALESCE(rtv.open_qty, 0)
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
    -- Complete: output >= order_qty, qc resolved, no rework owed (0089), nothing
    -- owed back by the vendor (0093 — 0128: the OPEN qty, so a replacement that
    -- is back but not yet inspected still blocks), AND no OPEN rework/repair
    -- CHILD JC on this op (0124 — the mandatory rule). An op waiting on any of
    -- these is not finished; letting it read `complete` would auto-close the JC
    -- and its SO line with pieces still outstanding.
    WHEN COALESCE(rw.qty, 0) = 0
      AND COALESCE(rtv.open_qty, 0) = 0
      AND COALESCE(rwc.qty, 0) = 0
      AND p.jc_order_qty > 0
      AND (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END) >= p.jc_order_qty
      AND (
        NOT (o.qc_required OR o.op_type = 'qc')
        -- 0125 — ACCEPTED, not merely inspected. `+ qc_rejected_qty` was here and
        -- let an all-rejected op read complete. Recovered rework pieces re-enter
        -- as qc-accepted op_logs, so qc_accepted rises to the bar on recovery.
        OR COALESCE(r.qc_accepted_qty, 0)
           >= (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) + COALESCE(orr.osp_accepted_qty, 0) END)
      )
      THEN 'complete'
    WHEN COALESCE(rw.qty, 0) = 0
      AND COALESCE(rtv.open_qty, 0) = 0
      AND COALESCE(rwc.qty, 0) = 0
      AND o.op_type = 'outsource'
      AND (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      AND COALESCE(orr.osp_accepted_qty, 0) + COALESCE(r.qc_accepted_qty, 0)
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
  -- at_vendor_qty (0128): pieces physically with the vendor = ordinary sent
  -- not yet ordinarily received (replacement GRNs excluded, so this can never
  -- be driven to 0 by a replacement) PLUS return_to_vendor pieces shipped on a
  -- challan and not yet received back. Each physical piece appears in exactly
  -- one of at_vendor_qty / in_qc_qty.
  (GREATEST(0, COALESCE(o.outsource_sent_qty, 0) - COALESCE(orr.osp_ordinary_received_qty, 0))
    + COALESCE(rtv.at_vendor_qty, 0))::integer AS at_vendor_qty,
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
               WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0) + COALESCE(r.qc_accepted_qty, 0)
               ELSE COALESCE(r.completed_qty, 0) + COALESCE(o.outsource_sent_qty, 0)
             END)
          - COALESCE(rtv.open_qty, 0)
      ) + COALESCE(rw.qty, 0)
  END)::integer AS pending_qty,
  COALESCE(rw.qty, 0)::integer AS rework_pending_qty,
  COALESCE(rr.qty, 0)::integer AS rework_raised_qty,
  rr.to_ops AS rework_raised_to_ops,
  -- 0093, appended last. 0128: same column name, value is now the OPEN
  -- return_to_vendor qty (rejected − cleared − failed) — pieces still owed a
  -- good replacement, wherever they physically are — rather than the raw
  -- rejected qty. Drops as each replacement piece is inspected.
  COALESCE(rtv.open_qty, 0)::integer AS returned_to_vendor_qty
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
LEFT JOIN rework_outstanding rw
  ON rw.job_card_id = o.job_card_id AND rw.rework_op_seq = o.op_seq
LEFT JOIN rework_raised rr
  ON rr.job_card_id = o.job_card_id AND rr.op_seq = o.op_seq
LEFT JOIN rework_child_open rwc
  ON rwc.job_card_id = o.job_card_id AND rwc.op_seq = o.op_seq
LEFT JOIN returned_to_vendor rtv ON rtv.jc_op_id = o.id
WHERE o.deleted_at IS NULL;
--> statement-breakpoint

-- v_osp_wip — 0128 body, 23 columns, names / types / positions exactly as
-- 0110. 0130: the receipts rollup matches GRN lines through ALL the op's PO
-- lines (op_po_lines, same UNION as above), not the first line only.
CREATE OR REPLACE VIEW public.v_osp_wip AS
WITH op_po_lines AS (
  SELECT o_0.id AS jc_op_id, o_0.outsource_po_line_id AS purchase_order_line_id
  FROM jc_ops o_0
  WHERE o_0.deleted_at IS NULL AND o_0.outsource_po_line_id IS NOT NULL
  UNION
  SELECT l.jc_op_id, l.purchase_order_line_id
  FROM jc_op_po_lines l
  WHERE l.deleted_at IS NULL
), receipts AS (
  SELECT o_1.id AS jc_op_id,
         COALESCE(sum(grl.received_qty), 0::bigint)::numeric    AS returned_qty,
         COALESCE(sum(grl.received_qty) FILTER (WHERE grn.nc_id IS NULL), 0::bigint)::numeric AS ordinary_returned_qty,
         COALESCE(sum(grl.qc_accepted_qty), 0::bigint)::numeric AS accepted_qty,
         COALESCE(sum(grl.qc_rejected_qty), 0::bigint)::numeric AS rejected_qty
  FROM jc_ops o_1
    LEFT JOIN op_po_lines opl
      ON opl.jc_op_id = o_1.id
    LEFT JOIN goods_receipt_note_lines grl
      ON grl.purchase_order_line_id = opl.purchase_order_line_id AND grl.deleted_at IS NULL
    LEFT JOIN goods_receipt_notes grn
      ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
  WHERE o_1.op_type = 'outsource'::op_type AND o_1.deleted_at IS NULL
  GROUP BY o_1.id
), returned_to_vendor AS (
  -- 0128: at_vendor_qty = pieces shipped back on a challan and not yet
  -- received; open_qty = pieces not yet recovered (rejected − cleared − failed).
  SELECT nc.jc_op_id,
         GREATEST(0::numeric, COALESCE(sum(nc.rtv_sent_qty - nc.rtv_received_qty)
           FILTER (WHERE nc.delivery_challan_id IS NOT NULL), 0::numeric)) AS at_vendor_qty,
         GREATEST(0::numeric, sum(nc.rejected_qty - nc.cleared_qty - nc.failed_qty)) AS open_qty
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
  -- 0128: ordinary receipts only — can never exceed sent_qty.
  COALESCE(r.ordinary_returned_qty, 0::numeric)::integer AS returned_qty,
  COALESCE(r.rejected_qty, 0::numeric)::integer AS rejected_qty,
  COALESCE(r.accepted_qty, 0::numeric)::integer AS accepted_qty,
  -- 0128: sent − ORDINARY received, plus RTV pieces shipped and not yet back.
  (GREATEST(0::numeric, COALESCE(o.outsource_sent_qty, 0)::numeric - COALESCE(r.ordinary_returned_qty, 0::numeric))
    + COALESCE(rtv.at_vendor_qty, 0::numeric))::integer AS at_vendor_qty,
  GREATEST(0, jc.order_qty - COALESCE(o.outsource_sent_qty, 0)) AS not_sent_qty,
  -- in_qc: ALL GRNs (a replacement awaiting Incoming QC is in QC).
  GREATEST(0::numeric, COALESCE(r.returned_qty, 0::numeric) - COALESCE(r.accepted_qty, 0::numeric)
    - COALESCE(r.rejected_qty, 0::numeric))::integer AS in_qc_qty,
  -- 0128: same name, value is the OPEN (not yet recovered) RTV qty.
  COALESCE(rtv.open_qty, 0::numeric)::integer AS returned_to_vendor_qty,
  -- 0110: what the shop floor has actually cleared into this op, less anything
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
--> statement-breakpoint

COMMIT;
