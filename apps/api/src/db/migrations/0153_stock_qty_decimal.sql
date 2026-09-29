-- ============================================================
-- 0153_stock_qty_decimal.sql  (ADR-193 phase 1a)
--
-- Stock quantities become decimal (3 places) so KGS / MTR material (bar,
-- cable, oil) can be received, issued and counted as e.g. 12.5. Whole-number
-- units (NOS / SET) are still enforced — by the single stock writer
-- (apps/api/src/lib/stock-ledger.ts), not here.
--
--   store_transactions.qty / stock_before / stock_after   integer → numeric(14,3)
--   item_stock_balances.on_hand_qty                        integer → numeric(14,3)
--   trigger apply_store_txn_to_balance                     v_delta integer → numeric
--   v_item_stock / v_item_stock_availability               dropped + recreated (same
--                                                          columns, numeric, no ::integer)
--
-- Also: store_txn_source_type += store_issue, store_return, tool_issue,
-- tool_return, stock_count — so the ledger names the document that made each
-- line instead of 'other'. Existing rows keep their values.
--
-- Widening integer → numeric loses nothing. The ledger immutability trigger
-- (0149) is a ROW trigger and does not fire on ALTER COLUMN TYPE.
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback (only while every value is whole):
--   DROP VIEW v_item_stock_availability; DROP VIEW v_item_stock;
--   ALTER TABLE store_transactions ALTER qty TYPE integer, ALTER stock_before TYPE integer,
--     ALTER stock_after TYPE integer;
--   ALTER TABLE item_stock_balances ALTER on_hand_qty TYPE integer;
--   then re-run the view / trigger bodies from 0020 and 0141.
--   (Enum values cannot be removed; they are harmless when unused.)
-- ============================================================

ALTER TYPE public.store_txn_source_type ADD VALUE IF NOT EXISTS 'store_issue';
--> statement-breakpoint
ALTER TYPE public.store_txn_source_type ADD VALUE IF NOT EXISTS 'store_return';
--> statement-breakpoint
ALTER TYPE public.store_txn_source_type ADD VALUE IF NOT EXISTS 'tool_issue';
--> statement-breakpoint
ALTER TYPE public.store_txn_source_type ADD VALUE IF NOT EXISTS 'tool_return';
--> statement-breakpoint
ALTER TYPE public.store_txn_source_type ADD VALUE IF NOT EXISTS 'stock_count';
--> statement-breakpoint

-- Views dropped, columns widened, trigger and views recreated in ONE
-- transaction: a failure part-way can never leave the stock views missing.
BEGIN;
--> statement-breakpoint
DROP VIEW IF EXISTS public.v_item_stock_availability;
--> statement-breakpoint
DROP VIEW IF EXISTS public.v_item_stock;
--> statement-breakpoint

ALTER TABLE public.store_transactions
  ALTER COLUMN qty TYPE numeric(14,3),
  ALTER COLUMN stock_before TYPE numeric(14,3),
  ALTER COLUMN stock_after TYPE numeric(14,3);
--> statement-breakpoint

ALTER TABLE public.item_stock_balances
  ALTER COLUMN on_hand_qty TYPE numeric(14,3);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.apply_store_txn_to_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_delta numeric(14,3);
BEGIN
  -- Free-text items (item_id NULL) don't get stock-tracked.
  IF NEW.item_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_delta := CASE
    WHEN NEW.txn_type = 'in'  THEN  NEW.qty
    WHEN NEW.txn_type = 'out' THEN -NEW.qty
    ELSE NEW.qty
  END;

  INSERT INTO public.item_stock_balances (company_id, item_id, on_hand_qty, updated_at)
  VALUES (NEW.company_id, NEW.item_id, v_delta, now())
  ON CONFLICT (company_id, item_id) DO UPDATE
    SET on_hand_qty = item_stock_balances.on_hand_qty + EXCLUDED.on_hand_qty,
        updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE VIEW public.v_item_stock AS
SELECT company_id, item_id, on_hand_qty
FROM public.item_stock_balances;
--> statement-breakpoint

CREATE VIEW public.v_item_stock_availability AS
SELECT
  b.company_id,
  b.item_id,
  b.on_hand_qty                                 AS physical_qty,
  COALESCE(r.reserved_qty, 0)::numeric(14,3)    AS reserved_qty,
  (b.on_hand_qty - COALESCE(r.reserved_qty, 0))::numeric(14,3) AS available_qty
FROM public.item_stock_balances b
LEFT JOIN (
  SELECT company_id, item_id,
         SUM(qty - consumed_qty - released_qty) AS reserved_qty
  FROM public.so_stock_reservations
  WHERE deleted_at IS NULL
    AND status IN ('active', 'partially_consumed')
  GROUP BY company_id, item_id
) r ON r.company_id = b.company_id AND r.item_id = b.item_id;
--> statement-breakpoint

GRANT SELECT ON public.v_item_stock TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.v_item_stock_availability TO authenticated;
--> statement-breakpoint
COMMIT;
