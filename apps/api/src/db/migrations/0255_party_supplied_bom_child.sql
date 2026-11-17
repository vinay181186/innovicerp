-- ADR-307: customer-supplied BOM parts of an Equipment SO.
--
--   bom_line_type                    + 'party_supplied' (the customer sends this BOM child).
--                                    Not used anywhere in this file (a new enum value
--                                    cannot be used in the transaction that adds it).
--   party_grn.sales_order_id         a Party GRN is against a JWSO OR an Equipment SO —
--                                    exactly one (CHECK).
--   party_stock_ledger.sales_order_id      the SO a party-store movement belongs to.
--   party_material_issues.sales_order_id   issue of a customer part to the SO's assembly.
--   customer_material_returns        job_work_order_id becomes nullable; + sales_order_id;
--                                    exactly one of the two (CHECK).
--   customer_material_return_lines.jw_line_id   nullable (null on an SO return line).
--
-- No new table (no RLS change). No backfill: every existing row is JWSO and passes
-- the CHECKs. The runner bypasses RLS. Safe to re-run.
--
-- ROLLBACK (only after the code reading it is gone, and only when no SO rows exist):
--   ALTER TABLE public.customer_material_returns DROP CONSTRAINT customer_material_returns_one_order_check;
--   ALTER TABLE public.party_grn DROP CONSTRAINT party_grn_one_order_check;
--   ALTER TABLE public.<each table> DROP COLUMN sales_order_id;
--   (the enum value and the dropped NOT NULLs stay — harmless)

ALTER TYPE public.bom_line_type ADD VALUE IF NOT EXISTS 'party_supplied';
--> statement-breakpoint
ALTER TABLE public.party_grn
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_grn_so_idx
  ON public.party_grn (company_id, sales_order_id)
  WHERE sales_order_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_grn_one_order_check') THEN
    ALTER TABLE public.party_grn
      ADD CONSTRAINT party_grn_one_order_check
      CHECK (num_nonnulls(job_work_order_id, sales_order_id) = 1);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.party_stock_ledger
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_stock_ledger_so_idx
  ON public.party_stock_ledger (company_id, sales_order_id)
  WHERE sales_order_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.party_material_issues
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_material_issues_so_idx
  ON public.party_material_issues (company_id, sales_order_id)
  WHERE sales_order_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.customer_material_returns
  ALTER COLUMN job_work_order_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.customer_material_returns
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_material_returns_so_idx
  ON public.customer_material_returns (company_id, sales_order_id)
  WHERE sales_order_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_material_returns_one_order_check') THEN
    ALTER TABLE public.customer_material_returns
      ADD CONSTRAINT customer_material_returns_one_order_check
      CHECK (num_nonnulls(job_work_order_id, sales_order_id) = 1);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.customer_material_return_lines
  ALTER COLUMN jw_line_id DROP NOT NULL;
