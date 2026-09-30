-- ============================================================
-- 0181_status_locks_and_qty_guards.sql  (fix wave 1, area B2 — S3 / S6 / S12)
--
-- Database backstops for the lock-then-check service changes of the same
-- wave (NC decisions, OSP challans, stock). The services now lock the row and
-- refuse a second save with a plain 409; these rules make sure that, even if a
-- future code path forgets, the database itself refuses the bad row.
--
--   1. delivery_challans_nc_active_uq — at most ONE live return-to-vendor DC
--      per NC (not cancelled, not deleted). Replaces nothing: the plain 0122
--      index delivery_challans_nc_idx stays for look-ups.            (S3)
--   2. jc_ops_osp_returned_le_sent — on a job-card operation, the OSP
--      counters are never negative and Returned (QC-accepted back from the
--      vendor) never passes Sent.                                     (S6)
--   3. item_stock_balances_on_hand_nonneg — stock never below zero.   (S12)
--
-- Every CHECK is added NOT VALID (instant, no table scan, enforced for every
-- NEW write), then VALIDATED inside a DO block ONLY when no existing row
-- breaks it — so this file never fails on a database with old bad rows; it
-- RAISEs a NOTICE instead and the constraint stays NOT VALID until the data
-- is fixed. The unique index is built the same way (skipped + NOTICE when a
-- duplicate already exists).
--
-- TEST (uitsrhyulidubnddzcex) checked read-only 2026-09-30: 0 NCs with two
-- live DCs, 0 ops with returned > sent or a negative counter, 0 negative
-- stock balances → all three VALIDATE there. PROD must be checked on its own
-- (the same DO blocks do it at apply time and say so in the NOTICEs).
--
-- Additive + idempotent. Apply to BOTH the test and the production database.
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.delivery_challans_nc_active_uq;
--   ALTER TABLE public.jc_ops DROP CONSTRAINT IF EXISTS jc_ops_osp_returned_le_sent;
--   ALTER TABLE public.item_stock_balances DROP CONSTRAINT IF EXISTS item_stock_balances_on_hand_nonneg;
-- ============================================================

-- 1. One live return-to-vendor DC per NC -----------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.delivery_challans
    WHERE nc_id IS NOT NULL AND deleted_at IS NULL AND status <> 'cancelled'::dc_status
    GROUP BY nc_id HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE '0181: delivery_challans_nc_active_uq NOT created — an NC already has two live return-to-vendor DCs. Cancel the extra one, then re-run this file.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS delivery_challans_nc_active_uq
      ON public.delivery_challans (nc_id)
      WHERE nc_id IS NOT NULL AND deleted_at IS NULL AND status <> 'cancelled'::dc_status;
  END IF;
END $$;
--> statement-breakpoint

-- 2. OSP counters on an operation: 0 <= returned <= sent -------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jc_ops_osp_returned_le_sent' AND conrelid = 'public.jc_ops'::regclass
  ) THEN
    ALTER TABLE public.jc_ops
      ADD CONSTRAINT jc_ops_osp_returned_le_sent CHECK (
        outsource_sent_qty >= 0
        AND outsource_returned_qty >= 0
        AND outsource_returned_qty <= outsource_sent_qty
      ) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.jc_ops
    WHERE NOT (
      outsource_sent_qty >= 0
      AND outsource_returned_qty >= 0
      AND outsource_returned_qty <= outsource_sent_qty
    )
  ) THEN
    RAISE NOTICE '0181: jc_ops_osp_returned_le_sent left NOT VALID — existing ops break it (new writes are still checked).';
  ELSE
    ALTER TABLE public.jc_ops VALIDATE CONSTRAINT jc_ops_osp_returned_le_sent;
  END IF;
END $$;
--> statement-breakpoint

-- 3. Stock never below zero -------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'item_stock_balances_on_hand_nonneg'
      AND conrelid = 'public.item_stock_balances'::regclass
  ) THEN
    ALTER TABLE public.item_stock_balances
      ADD CONSTRAINT item_stock_balances_on_hand_nonneg CHECK (on_hand_qty >= 0) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.item_stock_balances WHERE on_hand_qty < 0) THEN
    RAISE NOTICE '0181: item_stock_balances_on_hand_nonneg left NOT VALID — negative balances exist (new writes are still checked).';
  ELSE
    ALTER TABLE public.item_stock_balances VALIDATE CONSTRAINT item_stock_balances_on_hand_nonneg;
  END IF;
END $$;
