-- ============================================================
-- 0079_drop_jwso_material_received
-- Drops the now-dead client-material "received" header fields from
-- job_work_orders. The JWSO "material received" badge reads the actual
-- Party GRN receipts (Σ party_grn_lines.received_qty, surfaced as
-- partyReceivedQty), so the manually-typed header fields
-- material_received_date / material_received_qty only ever fed the old
-- badge and can drift from reality. KEEP client_material /
-- client_material_qty — those are the expected-material intent, still shown.
--
-- Idempotent (IF EXISTS). No backfill: the data was advisory only.
-- ============================================================

ALTER TABLE public.job_work_orders DROP COLUMN IF EXISTS material_received_date;
--> statement-breakpoint
ALTER TABLE public.job_work_orders DROP COLUMN IF EXISTS material_received_qty;
