-- ============================================================
-- 0160_reorder_qty.sql  (ADR-193 phase 5 — spec §15)
--
-- Reorder Level + Reorder Qty per item.
--   items.min_stock_qty  integer → numeric(14,3)  (screen name "Reorder Level";
--                        the column keeps its name; default 0, NOT NULL kept).
--                        Decimals are allowed for KGS / MTR items; NOS / SET
--                        are held to whole numbers by the API, not here.
--                        + CHECK items_min_stock_qty_nonneg (>= 0).
--   items.reorder_qty    NEW numeric(14,3) NOT NULL DEFAULT 0, >= 0
--                        ("Reorder Qty" — how much one reorder buys; 0 = buy
--                        the shortfall).
--
-- No view reads items.min_stock_qty (checked: no CREATE VIEW in any migration
-- file in this folder names it or selects items.*). If one ever does, the
-- ALTER TYPE below fails loudly and the whole file rolls back — nothing
-- half-applied.
--
-- Idempotent: the retype runs only while the column is still integer; the new
-- column and both checks are added only when missing (safe to re-run on a
-- database that already has the first version of this file). Apply to BOTH the test and the
-- production database.
--
-- Rollback (only while every Reorder Level is whole):
--   ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_min_stock_qty_nonneg;
--   ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_reorder_qty_nonneg;
--   ALTER TABLE public.items DROP COLUMN IF EXISTS reorder_qty;
--   ALTER TABLE public.items ALTER COLUMN min_stock_qty TYPE integer
--     USING round(min_stock_qty)::integer;
-- ============================================================

BEGIN;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items'
      AND column_name = 'min_stock_qty' AND data_type = 'integer'
  ) THEN
    ALTER TABLE public.items ALTER COLUMN min_stock_qty DROP DEFAULT;
    ALTER TABLE public.items
      ALTER COLUMN min_stock_qty TYPE numeric(14,3) USING min_stock_qty::numeric;
    ALTER TABLE public.items ALTER COLUMN min_stock_qty SET DEFAULT 0;
    ALTER TABLE public.items ALTER COLUMN min_stock_qty SET NOT NULL;
  END IF;
END
$$;
--> statement-breakpoint

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS reorder_qty numeric(14,3) NOT NULL DEFAULT 0;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'items_reorder_qty_nonneg' AND conrelid = 'public.items'::regclass
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_reorder_qty_nonneg CHECK (reorder_qty >= 0);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'items_min_stock_qty_nonneg' AND conrelid = 'public.items'::regclass
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_min_stock_qty_nonneg CHECK (min_stock_qty >= 0);
  END IF;
END
$$;
--> statement-breakpoint

COMMIT;
