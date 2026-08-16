-- ============================================================
-- 0096_assembly_wip_status
-- Assembly Start / Stop (WIP). Until now assembling was atomic: one click
-- built N units, debited components, and the row was "done". The user asked
-- for a two-step floor flow — START a batch (parts go to the bench, nothing
-- leaves stock yet) then STOP it, entering how many actually came out good;
-- the good qty is completed and the remainder stays "in assembly".
--
-- Model (see ADR-129): a START inserts an `in_progress` assembly_units row of
-- the started qty (no stock movement). Each STOP spawns a normal `completed`
-- row for the good qty — which debits components through the existing ADR-115
-- cascade, exactly like a one-shot assemble — and shrinks the in_progress row
-- by that amount. When the in_progress row reaches 0 it is soft-deleted.
--
-- One new column carries this:
--   • status text NOT NULL DEFAULT 'completed'
--       - existing/one-shot rows are 'completed' (the DEFAULT backfills them),
--         so every SUM(qty) rollup that now filters status='completed' still
--         counts them and no data migration is needed.
--       - CHECK status IN ('in_progress','completed').
--
-- assembledQty  = SUM(qty) FILTER (status='completed')
-- inProgressQty = SUM(qty) FILTER (status='in_progress')   ← the "In Assembly" count
--
-- Idempotent; applied via src/db/apply-sql.ts.
-- ============================================================

ALTER TABLE "assembly_units"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed';
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assembly_units_status_check'
  ) THEN
    ALTER TABLE "assembly_units"
      ADD CONSTRAINT "assembly_units_status_check"
      CHECK ("status" IN ('in_progress', 'completed'));
  END IF;
END $$;
--> statement-breakpoint

-- Fast lookup of the open WIP batches for an SO (Start/Stop screen).
CREATE INDEX IF NOT EXISTS "assembly_units_so_status_idx"
  ON "assembly_units" ("sales_order_id", "status")
  WHERE "deleted_at" IS NULL;
