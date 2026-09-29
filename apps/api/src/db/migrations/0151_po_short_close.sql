-- ============================================================
-- 0151_po_short_close.sql  (ADR-189) — also: bought-material NCs
--
-- A Purchase Order can now be stopped once issued (ERPNext: Close / Cancel).
-- purchase_orders gains who / when / why of the stop. A PO stopped with
-- nothing received or sent is set 'cancelled' (its PRs and job-card ops are
-- released, as a rejected draft's are); one stopped part-way is set 'closed'
-- and each PR it drew on counts only what was actually received from it, so
-- the un-received qty goes back to the PR's Pending.
--
-- All three columns are set together or not at all (CHECK).
--
-- Also (ADR-189): nc_register.job_card_id becomes nullable. Incoming QC now
-- raises an NC for a BOUGHT-MATERIAL reject — a GRN line no job card stands
-- behind — so the rejected pieces are on record until scrapped or returned to
-- the vendor. Every NC must still name one of the two (CHECK).
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback (NC part first, only while no NC has a NULL job_card_id):
--   ALTER TABLE public.nc_register DROP CONSTRAINT nc_register_job_card_or_grn_line,
--     ALTER COLUMN job_card_id SET NOT NULL;
-- Rollback: ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_short_close_all_or_none,
--           DROP COLUMN short_closed_at, DROP COLUMN short_closed_by, DROP COLUMN short_close_reason;
-- ============================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS short_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS short_closed_by uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS short_close_reason text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.purchase_orders'::regclass
      AND conname = 'purchase_orders_short_close_all_or_none'
  ) THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_short_close_all_or_none CHECK (
        (short_closed_at IS NULL AND short_closed_by IS NULL AND short_close_reason IS NULL)
        OR (short_closed_at IS NOT NULL AND short_closed_by IS NOT NULL
            AND length(btrim(short_close_reason)) > 0)
      );
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE public.nc_register ALTER COLUMN job_card_id DROP NOT NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.nc_register'::regclass
      AND conname = 'nc_register_job_card_or_grn_line'
  ) THEN
    ALTER TABLE public.nc_register
      ADD CONSTRAINT nc_register_job_card_or_grn_line CHECK (
        job_card_id IS NOT NULL OR grn_line_id IS NOT NULL
      );
  END IF;
END $$;
