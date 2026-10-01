-- ============================================================
-- 0188_stock_balance_update_first.sql
--
-- HOTFIX for 0181. 0181 added CHECK (on_hand_qty >= 0) on item_stock_balances.
-- The balance trigger (0153) wrote every move as
--   INSERT … VALUES (company, item, v_delta) ON CONFLICT DO UPDATE …
-- and Postgres tests a CHECK against the PROPOSED insert row (v_delta, e.g. -10)
-- before it switches to the UPDATE — so every stock-OUT was refused with 23514
-- ("Stock cannot go below zero") whatever the real stock was (Case 3 E2E run,
-- 01-Oct-2026, JW Return on IN-JW-00003).
--
-- Fix: UPDATE the existing balance first; INSERT only when the item has no
-- balance row yet (a first move). A concurrent first insert is retried as an
-- UPDATE. The CHECK stays: a real move below zero is still refused.
-- Additive (function body only); idempotent. Rollback = re-run 0153's function.
-- ============================================================

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

  UPDATE public.item_stock_balances
     SET on_hand_qty = on_hand_qty + v_delta,
         updated_at = now()
   WHERE company_id = NEW.company_id
     AND item_id = NEW.item_id;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.item_stock_balances (company_id, item_id, on_hand_qty, updated_at)
      VALUES (NEW.company_id, NEW.item_id, v_delta, now());
    EXCEPTION WHEN unique_violation THEN
      -- Another transaction created the row first: apply the move to it.
      UPDATE public.item_stock_balances
         SET on_hand_qty = on_hand_qty + v_delta,
             updated_at = now()
       WHERE company_id = NEW.company_id
         AND item_id = NEW.item_id;
    END;
  END IF;

  RETURN NEW;
END;
$$;
