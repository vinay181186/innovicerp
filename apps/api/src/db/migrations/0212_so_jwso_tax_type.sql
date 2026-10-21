-- ============================================================
-- 0212_so_jwso_tax_type  (ADR-241)
--
-- A Sales Order / Job Work Sales Order showed one GST line and no
-- round-off. They now split GST into SGST + CGST (customer in our own
-- State) or IGST (another State / SEZ / Overseas), the same rule the Tax
-- Invoice uses (0171 / 0186), and round the Grand Total to the rupee.
--
-- The server decides the split from the customer master on every save;
-- the browser never sends it.
--   sales_orders.tax_type           text NULL  'sgst_cgst' | 'igst'
--   sales_orders.place_of_supply    char(2) NULL  GST State Code
--   job_work_orders.tax_type        text NULL  'sgst_cgst' | 'igst'
--   job_work_orders.place_of_supply char(2) NULL  GST State Code
-- NULL = the customer's State is unknown (warn only, never refused), or
-- the order has not been saved since this migration: the detail read then
-- works the split out live. No data backfill.
--
-- ROLLBACK:
--   ALTER TABLE public.sales_orders DROP CONSTRAINT sales_orders_tax_type_check;
--   ALTER TABLE public.sales_orders DROP COLUMN tax_type, DROP COLUMN place_of_supply;
--   ALTER TABLE public.job_work_orders DROP CONSTRAINT job_work_orders_tax_type_check;
--   ALTER TABLE public.job_work_orders DROP COLUMN tax_type, DROP COLUMN place_of_supply;
-- Idempotent. Additive only. Apply to BOTH the test and the production database.
-- ============================================================

ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS tax_type text;
--> statement-breakpoint

ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS place_of_supply char(2);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales_orders'::regclass
      AND conname = 'sales_orders_tax_type_check'
  ) THEN
    ALTER TABLE public.sales_orders
      ADD CONSTRAINT sales_orders_tax_type_check
      CHECK (tax_type IS NULL OR tax_type IN ('sgst_cgst', 'igst'));
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE public.job_work_orders ADD COLUMN IF NOT EXISTS tax_type text;
--> statement-breakpoint

ALTER TABLE public.job_work_orders ADD COLUMN IF NOT EXISTS place_of_supply char(2);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.job_work_orders'::regclass
      AND conname = 'job_work_orders_tax_type_check'
  ) THEN
    ALTER TABLE public.job_work_orders
      ADD CONSTRAINT job_work_orders_tax_type_check
      CHECK (tax_type IS NULL OR tax_type IN ('sgst_cgst', 'igst'));
  END IF;
END $$;
