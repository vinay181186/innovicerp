-- 0122 — QC–NC handling per Innovic_ERP_QC_NC_Handling_Procedure_R2-1.pdf.
-- Design: docs/QC-NC-HANDLING-DESIGN.md. Every change here is additive: no
-- column is dropped or renamed, no enum value removed, no view column reordered.
--
-- 1. nc_disposition gains 'repair'; nc_status gains the four locations an NC
--    qty can be in while a recovery is under way.
-- 2. nc_register gains the quantity ledger (sent / received / cleared / failed),
--    the links the spec's traceability chain needs (inspection row, GRN line,
--    child JC, DC, sibling on a partial disposition) and closure audit.
-- 3. job_cards gains the parent link for a rework/repair child.
-- 4. delivery_challans / goods_receipt_notes gain the NC reference so a
--    return-to-vendor challan and its replacement receipt are traceable.
-- 5. v_jc_op_status is re-emitted with ONE additive term so pieces recovered
--    after an outsource-op reject can re-enter that op (op_log qc rows on an
--    outsource op did not exist before this change, so today's numbers are
--    unchanged).
-- 6. v_nc_op_breakup (new) — the §6 quantity breakup per op.

-- ─── 1. enums ─────────────────────────────────────────────────────────────
ALTER TYPE public.nc_disposition ADD VALUE IF NOT EXISTS 'repair';
--> statement-breakpoint
ALTER TYPE public.nc_status ADD VALUE IF NOT EXISTS 'under_rework';
--> statement-breakpoint
ALTER TYPE public.nc_status ADD VALUE IF NOT EXISTS 'under_repair';
--> statement-breakpoint
ALTER TYPE public.nc_status ADD VALUE IF NOT EXISTS 'sent_to_vendor';
--> statement-breakpoint
ALTER TYPE public.nc_status ADD VALUE IF NOT EXISTS 'received_qc_pending';
--> statement-breakpoint

-- ─── 2. nc_register quantity ledger + links ───────────────────────────────
ALTER TABLE public.nc_register
  ADD COLUMN IF NOT EXISTS qc_log_id            uuid REFERENCES public.op_log(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grn_line_id          uuid REFERENCES public.goods_receipt_note_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS split_from_nc_id     uuid REFERENCES public.nc_register(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS child_job_card_id    uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_challan_id  uuid REFERENCES public.delivery_challans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rtv_sent_qty         numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rtv_received_qty     numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleared_qty          numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_qty           numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by            uuid REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE public.nc_register
  DROP CONSTRAINT IF EXISTS nc_register_recovery_qty_check;
--> statement-breakpoint
ALTER TABLE public.nc_register
  ADD CONSTRAINT nc_register_recovery_qty_check
    CHECK (cleared_qty >= 0 AND failed_qty >= 0 AND cleared_qty + failed_qty <= rejected_qty),
  ADD CONSTRAINT nc_register_rtv_qty_check
    CHECK (rtv_sent_qty >= 0 AND rtv_received_qty >= 0 AND rtv_received_qty <= rtv_sent_qty);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nc_register_child_jc_idx ON public.nc_register (child_job_card_id) WHERE child_job_card_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nc_register_dc_idx ON public.nc_register (delivery_challan_id) WHERE delivery_challan_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nc_register_split_idx ON public.nc_register (split_from_nc_id) WHERE split_from_nc_id IS NOT NULL;
--> statement-breakpoint

-- ─── 3. job_cards: rework / repair child link ─────────────────────────────
ALTER TABLE public.job_cards
  ADD COLUMN IF NOT EXISTS parent_job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_op_seq      integer,
  ADD COLUMN IF NOT EXISTS recovery_kind      text;
--> statement-breakpoint
ALTER TABLE public.job_cards
  DROP CONSTRAINT IF EXISTS job_cards_recovery_kind_check;
--> statement-breakpoint
ALTER TABLE public.job_cards
  ADD CONSTRAINT job_cards_recovery_kind_check
    CHECK (recovery_kind IS NULL OR recovery_kind IN ('rework', 'repair'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_cards_parent_jc_idx ON public.job_cards (parent_job_card_id) WHERE parent_job_card_id IS NOT NULL;
--> statement-breakpoint

-- ─── 4. DC and GRN carry the NC they serve ────────────────────────────────
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS nc_id       uuid REFERENCES public.nc_register(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason      text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_challans_nc_idx ON public.delivery_challans (nc_id) WHERE nc_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.goods_receipt_notes
  ADD COLUMN IF NOT EXISTS nc_id uuid REFERENCES public.nc_register(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS goods_receipt_notes_nc_idx ON public.goods_receipt_notes (nc_id) WHERE nc_id IS NOT NULL;
--> statement-breakpoint

-- ─── 5. v_jc_op_status — re-emitted from 0093 with the outsource re-entry term
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
  -- available: as 0090, less anything now sitting with the vendor awaiting a
  -- replacement (0093) — that qty is not work this op can pick up.
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - (CASE
           WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0) + COALESCE(r.qc_accepted_qty, 0)
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
               WHEN o.op_type = 'outsource' THEN COALESCE(orr.osp_accepted_qty, 0) + COALESCE(r.qc_accepted_qty, 0)
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

-- ─── 6. v_nc_op_breakup — the §6 quantity breakup, per op ─────────────────
-- One row per jc_op that has ever had an NC. Every figure is "pieces currently
-- in that state", so the eight columns partition the op's total NC qty:
--   raised + under_rework + under_repair + sent + received_qc_pending + scrap + closed
-- Legacy in-route rework rows (rework_op_seq set, status disposed/rework_done)
-- are counted under under_rework so the card reads the same for old and new.
CREATE OR REPLACE VIEW public.v_nc_op_breakup AS
SELECT
  nc.jc_op_id,
  nc.job_card_id,
  nc.company_id,
  COALESCE(SUM(CASE WHEN nc.status = 'pending' THEN nc.rejected_qty ELSE 0 END), 0)::integer AS nc_raised_qty,
  COALESCE(SUM(CASE
      WHEN nc.status = 'under_rework' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty
      WHEN nc.disposition = 'rework' AND nc.status IN ('disposed', 'rework_done')
        THEN GREATEST(0, nc.rejected_qty - COALESCE(nc.rework_done_qty, 0))
      ELSE 0 END), 0)::integer AS under_rework_qty,
  COALESCE(SUM(CASE WHEN nc.status = 'under_repair' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS under_repair_qty,
  COALESCE(SUM(CASE WHEN nc.status IN ('sent_to_vendor', 'received_qc_pending') THEN nc.rtv_sent_qty - nc.rtv_received_qty ELSE 0 END), 0)::integer AS sent_to_vendor_qty,
  COALESCE(SUM(CASE WHEN nc.status = 'received_qc_pending' THEN nc.rtv_received_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS received_qc_pending_qty,
  COALESCE(SUM(CASE WHEN nc.disposition = 'scrap' AND nc.status = 'closed' THEN nc.rejected_qty ELSE 0 END), 0)::integer AS scrap_qty,
  COALESCE(SUM(CASE WHEN nc.status = 'closed' AND nc.disposition IS DISTINCT FROM 'scrap' THEN nc.rejected_qty ELSE 0 END), 0)::integer AS nc_closed_qty,
  COALESCE(SUM(CASE WHEN nc.status <> 'closed' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS nc_open_qty,
  COUNT(*) FILTER (WHERE nc.status <> 'closed')::integer AS open_nc_count
FROM public.nc_register nc
WHERE nc.deleted_at IS NULL AND nc.jc_op_id IS NOT NULL
GROUP BY nc.jc_op_id, nc.job_card_id, nc.company_id;
