-- ============================================================
-- 0034_phase8_jc_op_scheduling
-- Adds 3 nullable columns to jc_ops powering:
--   - queue_position : Job Queue (Production slice F) — manual reorder per
--                      machine. NULL = unranked (sorted to end by op_seq).
--   - planned_start  : Production Schedule Gantt (Production slice G).
--   - planned_end    : Production Schedule Gantt.
--
-- All nullable, additive, no FK changes. Safe to backfill later.
-- Idempotent — safe to re-run via _apply_0034.
-- ============================================================

ALTER TABLE "jc_ops"
  ADD COLUMN IF NOT EXISTS "queue_position" integer;
--> statement-breakpoint

ALTER TABLE "jc_ops"
  ADD COLUMN IF NOT EXISTS "planned_start" date;
--> statement-breakpoint

ALTER TABLE "jc_ops"
  ADD COLUMN IF NOT EXISTS "planned_end" date;
--> statement-breakpoint

-- Index to make per-machine queue ordering fast.
CREATE INDEX IF NOT EXISTS "jc_ops_machine_queue_idx"
  ON "jc_ops" ("machine_id", "queue_position", "op_seq")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Index for Gantt range queries (planned_start window).
CREATE INDEX IF NOT EXISTS "jc_ops_planned_start_idx"
  ON "jc_ops" ("company_id", "planned_start")
  WHERE "deleted_at" IS NULL AND "planned_start" IS NOT NULL;
