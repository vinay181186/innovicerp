-- ============================================================
-- 0020_phase7_item_stock_table
-- T-042 — materialize v_item_stock as an incrementally-maintained
-- table backed by a trigger on store_transactions. Read becomes
-- a single-row lookup; write cost is O(1) per txn (upsert one row).
--
-- Convention (matches the old SUM view):
--   - txn_type='in'     → +qty
--   - txn_type='out'    → -qty
--   - txn_type='adjust' → +qty  (legacy convention; signed adjustments are
--                                  modelled as paired in/out rows)
--
-- store_transactions is append-only per ADR-011 #4 (no UPDATE/DELETE
-- policies), so only an AFTER INSERT trigger is needed. If the project
-- ever permits txn corrections, add corresponding UPDATE/DELETE triggers
-- that reverse the prior delta + apply the new one.
--
-- RLS: the balance table has a company-isolation read policy. Writes
-- happen exclusively via the SECURITY DEFINER trigger function, so
-- there's no manager_write policy — the trigger bypasses RLS by virtue
-- of running as the function owner (postgres). This is intentional:
-- nothing outside the trigger should write to this table.
--
-- Idempotent — safe to re-run via _apply_0020 applier.
-- ============================================================

-- ─── item_stock_balances table ────────────────────────────────
CREATE TABLE IF NOT EXISTS "item_stock_balances" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "on_hand_qty" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("company_id", "item_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "item_stock_balances_company_idx"
  ON "item_stock_balances" ("company_id");
--> statement-breakpoint

ALTER TABLE "item_stock_balances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "item_stock_balances_company_read" ON "item_stock_balances"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- No write policy — the trigger function writes with SECURITY DEFINER,
-- which bypasses RLS. Direct app-level writes are deliberately blocked.
--> statement-breakpoint

-- ─── Backfill from existing store_transactions ────────────────
-- Re-runnable: ON CONFLICT updates the cached value to match the live
-- ledger sum, so this also acts as a reconcile if the trigger ever drifts.
INSERT INTO "item_stock_balances" ("company_id", "item_id", "on_hand_qty", "updated_at")
SELECT
  st.company_id,
  st.item_id,
  SUM(CASE
        WHEN st.txn_type = 'in'  THEN  st.qty
        WHEN st.txn_type = 'out' THEN -st.qty
        ELSE st.qty
      END)::integer AS on_hand_qty,
  now()
FROM public.store_transactions st
WHERE st.item_id IS NOT NULL
GROUP BY st.company_id, st.item_id
ON CONFLICT ("company_id", "item_id") DO UPDATE
  SET "on_hand_qty" = EXCLUDED."on_hand_qty",
      "updated_at" = EXCLUDED."updated_at";
--> statement-breakpoint

-- ─── Trigger function ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_store_txn_to_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_delta integer;
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

DROP TRIGGER IF EXISTS apply_store_txn_to_balance ON public.store_transactions;
--> statement-breakpoint

CREATE TRIGGER apply_store_txn_to_balance
AFTER INSERT ON public.store_transactions
FOR EACH ROW EXECUTE FUNCTION public.apply_store_txn_to_balance();
--> statement-breakpoint

-- ─── Rewrite v_item_stock to read from the table ──────────────
-- View contract preserved (same columns + types). Callers don't change.
DROP VIEW IF EXISTS public.v_item_stock;
--> statement-breakpoint

CREATE VIEW public.v_item_stock AS
SELECT
  company_id,
  item_id,
  on_hand_qty
FROM public.item_stock_balances;
