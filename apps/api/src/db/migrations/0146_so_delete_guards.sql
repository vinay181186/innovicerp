-- ============================================================
-- 0146_so_delete_guards  (ADR-184)
--
-- An invoice is a submitted financial document; it must never disappear
-- because the Sales Order it was raised against was permanently deleted from
-- Trash. invoices.sales_order_id was ON DELETE CASCADE, so a hard delete of
-- the SO silently took every invoice (and, through their own cascades, the
-- invoice lines and payments) with it.
--
-- Change, and nothing else:
--   invoices.sales_order_id → sales_orders.id   CASCADE  →  RESTRICT
--
-- invoice_lines → invoices and invoice_payments → invoices keep CASCADE: they
-- are parts of the invoice itself, not documents downstream of the SO.
--
-- The existing constraint is found BY DEFINITION (invoices → sales_orders),
-- not by name, so it is replaced whatever it was called. Re-adding validates
-- existing rows, which already satisfy it (it was an FK before).
--
-- The app enforces the same rule first (trash service refuses / skips an SO
-- with invoices, dispatches, plans or production orders); this is the backstop.
--
-- ROLLBACK: drop invoices_sales_order_id_sales_orders_id_fk and re-add it with
--           ON DELETE CASCADE.
-- Idempotent. Apply to BOTH the test and the production database.
-- ============================================================

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND confrelid = 'public.sales_orders'::regclass
      AND contype = 'f'
      AND NOT (conname = 'invoices_sales_order_id_sales_orders_id_fk' AND confdeltype = 'r')
  LOOP
    EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_sales_order_id_sales_orders_id_fk'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_sales_order_id_sales_orders_id_fk
      FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders (id)
      ON DELETE RESTRICT;
  END IF;
END $$;
