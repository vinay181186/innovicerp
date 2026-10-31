-- ============================================================
-- 0233_item_revision_stock
-- Drawing Rev register Phase C — stock counted per Item + Drawing Rev for MAKE
-- items, ALONGSIDE the existing item totals (which stay exactly as today:
-- item_stock_balances, v_item_stock, v_item_stock_availability and their ~39
-- readers are untouched).
--
--   1. store_txn_source_type gains 'rev_change' (stock moved between two Rev
--      buckets of one item). Runs first, outside the transaction (enum rule);
--      nothing below uses the new value.
--   2. item_revision_id (nullable FK) on store_transactions,
--      so_stock_reservations, assembly_part_reservations,
--      customer_dispatch_lines and stock_count_lines.
--      stock_count_lines: one line per item PER Rev bucket in a count (the
--      shared contract keys lines on item + Rev) — the unique index is widened.
--   3. item_rev_stock_balances — on hand per (company, item, Rev bucket);
--      rev_key = item_revision_id or the all-zero uuid for the blank bucket
--      (old stock / Buy items / RM). Written only by the trigger.
--   4. apply_store_txn_to_balance() also moves the row's Rev bucket (same sign
--      logic, same update-first pattern as 0188).
--   5. Backfill: one blank-bucket row per item_stock_balances row (old stock
--      has no Rev — the owner sets it by hand later), so per item
--      SUM(bucket) = item total. so_stock_reservations copy the Rev of their
--      SO / JWSO line (same item only); old dispatch lines stay null.
--   6. v_item_rev_stock_availability — on hand / reserved / free per bucket.
-- No CHECK (>= 0) on the bucket table on purpose: until every writer names
-- the Rev, an un-named 'out' of Rev stock lands in the blank bucket; the item
-- total keeps its CHECK (0181) — services guard the bucket.
-- Idempotent. Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts.
-- ============================================================

ALTER TYPE public.store_txn_source_type ADD VALUE IF NOT EXISTS 'rev_change';
--> statement-breakpoint

BEGIN;
--> statement-breakpoint
-- Hold every stock move until the new trigger body and the backfill commit
-- together, so no move lands in the item total without its bucket.
LOCK TABLE public.store_transactions IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- ── 2. Rev link columns ──
ALTER TABLE public.store_transactions ADD COLUMN IF NOT EXISTS item_revision_id uuid REFERENCES public.item_revisions(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_transactions_item_revision_idx ON public.store_transactions (item_revision_id);
--> statement-breakpoint
ALTER TABLE public.so_stock_reservations ADD COLUMN IF NOT EXISTS item_revision_id uuid REFERENCES public.item_revisions(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS so_stock_reservations_item_revision_idx ON public.so_stock_reservations (item_revision_id);
--> statement-breakpoint
ALTER TABLE public.assembly_part_reservations ADD COLUMN IF NOT EXISTS item_revision_id uuid REFERENCES public.item_revisions(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assembly_part_reservations_item_revision_idx ON public.assembly_part_reservations (item_revision_id);
--> statement-breakpoint
ALTER TABLE public.customer_dispatch_lines ADD COLUMN IF NOT EXISTS item_revision_id uuid REFERENCES public.item_revisions(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_dispatch_lines_item_revision_idx ON public.customer_dispatch_lines (item_revision_id);
--> statement-breakpoint
ALTER TABLE public.stock_count_lines ADD COLUMN IF NOT EXISTS item_revision_id uuid REFERENCES public.item_revisions(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_count_lines_item_revision_idx ON public.stock_count_lines (item_revision_id);
--> statement-breakpoint
DROP INDEX IF EXISTS public.stock_count_lines_count_item_uniq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS stock_count_lines_count_item_rev_uniq
  ON public.stock_count_lines (stock_count_id, item_id, COALESCE(item_revision_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ── 3. item_rev_stock_balances ──
CREATE TABLE IF NOT EXISTS public.item_rev_stock_balances (
  company_id uuid NOT NULL REFERENCES public.companies(id),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  item_revision_id uuid REFERENCES public.item_revisions(id),
  rev_key uuid GENERATED ALWAYS AS (COALESCE(item_revision_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  on_hand_qty numeric(14,3) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, item_id, rev_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_rev_stock_balances_company_idx ON public.item_rev_stock_balances (company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_rev_stock_balances_item_revision_idx ON public.item_rev_stock_balances (item_revision_id);
--> statement-breakpoint
ALTER TABLE public.item_rev_stock_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Same as item_stock_balances: read inside the company; no write policy —
-- the SECURITY DEFINER trigger is the only writer.
DO $$ BEGIN
  CREATE POLICY "item_rev_stock_balances_company_read" ON public.item_rev_stock_balances
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── 4. Trigger: item total (unchanged) + the Rev bucket ──
CREATE OR REPLACE FUNCTION public.apply_store_txn_to_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_delta numeric(14,3);
  v_rev_key uuid;
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

  -- Item total — exactly as 0188.
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
      UPDATE public.item_stock_balances
         SET on_hand_qty = on_hand_qty + v_delta,
             updated_at = now()
       WHERE company_id = NEW.company_id
         AND item_id = NEW.item_id;
    END;
  END IF;

  -- Rev bucket (0233). Blank bucket = all-zero key.
  v_rev_key := COALESCE(NEW.item_revision_id, '00000000-0000-0000-0000-000000000000'::uuid);

  UPDATE public.item_rev_stock_balances
     SET on_hand_qty = on_hand_qty + v_delta,
         updated_at = now()
   WHERE company_id = NEW.company_id
     AND item_id = NEW.item_id
     AND rev_key = v_rev_key;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.item_rev_stock_balances (company_id, item_id, item_revision_id, on_hand_qty, updated_at)
      VALUES (NEW.company_id, NEW.item_id, NEW.item_revision_id, v_delta, now());
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.item_rev_stock_balances
         SET on_hand_qty = on_hand_qty + v_delta,
             updated_at = now()
       WHERE company_id = NEW.company_id
         AND item_id = NEW.item_id
         AND rev_key = v_rev_key;
    END;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ── 5. Backfill ──
-- Old stock has no Rev: one blank-bucket row per item, equal to its total.
INSERT INTO public.item_rev_stock_balances (company_id, item_id, item_revision_id, on_hand_qty, updated_at)
SELECT b.company_id, b.item_id, NULL, b.on_hand_qty, now()
FROM public.item_stock_balances b
WHERE NOT EXISTS (
  SELECT 1 FROM public.item_rev_stock_balances r
  WHERE r.company_id = b.company_id AND r.item_id = b.item_id
);
--> statement-breakpoint
-- so_stock_reservations.so_line_id names an SO line OR a JW line (mirrors plans).
UPDATE public.so_stock_reservations s
   SET item_revision_id = l.item_revision_id
  FROM public.sales_order_lines l
 WHERE s.item_revision_id IS NULL
   AND l.id = s.so_line_id AND l.item_revision_id IS NOT NULL
   AND l.item_id = s.item_id AND l.company_id = s.company_id;
--> statement-breakpoint
UPDATE public.so_stock_reservations s
   SET item_revision_id = l.item_revision_id
  FROM public.job_work_order_lines l
 WHERE s.item_revision_id IS NULL
   AND l.id = s.so_line_id AND l.item_revision_id IS NOT NULL
   AND l.item_id = s.item_id AND l.company_id = s.company_id;
--> statement-breakpoint

-- ── 6. Availability per Rev bucket (same reserved formula as v_item_stock_availability) ──
CREATE OR REPLACE VIEW public.v_item_rev_stock_availability
  WITH (security_invoker = true) AS
SELECT b.company_id,
       b.item_id,
       b.rev_key,
       b.item_revision_id,
       b.on_hand_qty AS on_hand_qty,
       COALESCE(r.reserved_qty, 0)::numeric(14,3) AS reserved_qty,
       (b.on_hand_qty - COALESCE(r.reserved_qty, 0))::numeric(14,3) AS free_qty
FROM public.item_rev_stock_balances b
LEFT JOIN (
  SELECT x.company_id, x.item_id, x.rev_key, SUM(x.held) AS reserved_qty
  FROM (
    SELECT company_id, item_id,
           COALESCE(item_revision_id, '00000000-0000-0000-0000-000000000000'::uuid) AS rev_key,
           (qty - consumed_qty - released_qty)::numeric AS held
    FROM public.so_stock_reservations
    WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed')
    UNION ALL
    SELECT company_id, item_id,
           COALESCE(item_revision_id, '00000000-0000-0000-0000-000000000000'::uuid),
           (qty - consumed_qty - released_qty)::numeric
    FROM public.assembly_part_reservations
    WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed')
  ) x
  GROUP BY x.company_id, x.item_id, x.rev_key
) r ON r.company_id = b.company_id AND r.item_id = b.item_id AND r.rev_key = b.rev_key;
--> statement-breakpoint
GRANT SELECT ON public.v_item_rev_stock_availability TO authenticated;
--> statement-breakpoint

COMMIT;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- 1. Re-run 0188's function body (item total only).
-- 2. DROP VIEW IF EXISTS public.v_item_rev_stock_availability;
--    DROP TABLE IF EXISTS public.item_rev_stock_balances;
-- 3. DROP INDEX IF EXISTS public.stock_count_lines_count_item_rev_uniq;
--    CREATE UNIQUE INDEX stock_count_lines_count_item_uniq ON public.stock_count_lines (stock_count_id, item_id) WHERE deleted_at IS NULL;
-- 4. ALTER TABLE … DROP COLUMN IF EXISTS item_revision_id on store_transactions,
--    so_stock_reservations, assembly_part_reservations, customer_dispatch_lines,
--    stock_count_lines.
-- The enum value 'rev_change' cannot be removed (Postgres) — harmless if unused.
-- ------------------------------------------------------------
