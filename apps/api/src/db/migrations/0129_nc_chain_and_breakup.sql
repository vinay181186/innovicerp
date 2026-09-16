-- ============================================================
-- 0129_nc_chain_and_breakup — gaps G8 + G7
-- (docs/audits/2026-09-16-osp-chain-gap-report.md)
--
-- A. G8 — nc_register.parent_nc_id: the NC whose return-to-vendor REPLACEMENT
--    this NC was raised on (Incoming QC rejects a replacement GRN line → the new
--    NC carries the piece forward). Backfilled from the replacement GRN header's
--    nc_id for existing rows. Mirrored in schema.ts next to split_from_nc_id.
--
-- B. G7 — v_nc_op_breakup (last full text: 0122 §6; nothing later re-emitted
--    it). Same 12 columns, same order and types, plus ONE appended column:
--      rtv_awaiting_challan_qty = Σ(rejected − cleared − failed) where
--        disposition = return_to_vendor AND status = disposed
--        (RTV chosen, challan not yet raised — had no bucket, strip was blank).
--    nc_closed_qty changes from Σ rejected_qty to Σ cleared_qty of closed
--    non-scrap NCs: a piece that FAILED the replacement inspection is alive as
--    the follow-on NC and must not be counted again under its parent.
--    scrap_qty unchanged (Σ rejected_qty of closed scrap NCs).
--
-- Walk-through (0128 timeline, 3 physical rejects, op qty 10). Columns:
-- raised / awaiting_challan / sent / recv_qc_pending / closed  = Σ  (old closed)
--  S3  QC 7/3 → NC-A pending                 3 / 0 / 0 / 0 / 0 = 3   (0)
--  S4  NC-A disposed RTV, no challan         0 / 3 / 0 / 0 / 0 = 3   (0)  <- was blank
--  S5  RTV challan out, rtv_sent 3           0 / 0 / 3 / 0 / 0 = 3   (0)
--  S6  GRN-A 3 back, awaiting QC             0 / 0 / 0 / 3 / 0 = 3   (0)
--  S6b partial QC 1 acc → cleared 1          0 / 0 / 0 / 2 / 0 = 2   (0)
--  S7  QC 1/2 → NC-A closed(c1,f2); NC-B(2)  2 / 0 / 0 / 0 / 1 = 3   (3 → Σ5)
--  S8  NC-B disposed + challan out           0 / 0 / 2 / 0 / 1 = 3   (3)
--  S9  GRN-B 2 back                          0 / 0 / 0 / 2 / 1 = 3   (3)
--  S10 QC 0/2 → NC-B closed(c0,f2); NC-C(2)  2 / 0 / 0 / 0 / 1 = 3   (5 → Σ7)
--  S11 NC-C disposed + challan out           0 / 0 / 2 / 0 / 1 = 3   (5)
--  S12 GRN-C 2 back                          0 / 0 / 0 / 2 / 1 = 3   (5)
--  S13 QC 2/0 → NC-C closed(c2)              0 / 0 / 0 / 0 / 3 = 3   (7)
-- Σ of the strip never exceeds the 3 physical rejected pieces (2 at S6b: one
-- piece recovered and gone). Old closed read 7 at S13 for 3 rejects.
--
-- ROLLBACK: re-run the 0122 §6 body (column drop is a separate decision).
-- Idempotent. Apply to BOTH the production and the test database.
-- ============================================================

BEGIN;
--> statement-breakpoint

-- ─── A. G8 — parent_nc_id ─────────────────────────────────────────────────
ALTER TABLE public.nc_register
  ADD COLUMN IF NOT EXISTS parent_nc_id uuid REFERENCES public.nc_register(id) ON DELETE SET NULL;
--> statement-breakpoint

COMMENT ON COLUMN public.nc_register.parent_nc_id IS
  'The NC whose return-to-vendor REPLACEMENT this NC was raised on (Incoming QC reject of a replacement GRN line carries the piece into a new NC). 0129 / G8.';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS nc_register_parent_nc_idx
  ON public.nc_register (parent_nc_id)
  WHERE parent_nc_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint

-- Backfill: an NC raised on a GRN line whose header carries nc_id is the
-- follow-on of that NC. Idempotent (only rows still NULL; never self-links).
UPDATE public.nc_register n
SET parent_nc_id = g.nc_id
FROM public.goods_receipt_note_lines l
JOIN public.goods_receipt_notes g ON g.id = l.goods_receipt_note_id
WHERE n.grn_line_id = l.id
  AND g.nc_id IS NOT NULL
  AND n.parent_nc_id IS NULL
  AND n.id <> g.nc_id;
--> statement-breakpoint

-- ─── B. G7 — v_nc_op_breakup ──────────────────────────────────────────────
-- 0122 columns 1-12 byte-for-byte in name/order/type; column 13 appended.
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
  -- 0129 (G7): cleared_qty, not rejected_qty — a failed replacement piece
  -- lives on as the follow-on NC (parent_nc_id) and is counted there.
  COALESCE(SUM(CASE WHEN nc.status = 'closed' AND nc.disposition IS DISTINCT FROM 'scrap' THEN nc.cleared_qty ELSE 0 END), 0)::integer AS nc_closed_qty,
  COALESCE(SUM(CASE WHEN nc.status <> 'closed' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS nc_open_qty,
  COUNT(*) FILTER (WHERE nc.status <> 'closed')::integer AS open_nc_count,
  -- 0129 (G7), appended: return_to_vendor chosen, challan not yet raised.
  COALESCE(SUM(CASE WHEN nc.disposition = 'return_to_vendor' AND nc.status = 'disposed' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS rtv_awaiting_challan_qty
FROM public.nc_register nc
WHERE nc.deleted_at IS NULL AND nc.jc_op_id IS NOT NULL
GROUP BY nc.jc_op_id, nc.job_card_id, nc.company_id;
--> statement-breakpoint

COMMIT;
