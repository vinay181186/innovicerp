-- ============================================================
-- Apply pending prod migrations: 0058 + 0059 + 0060
-- All idempotent (safe to re-run). Run in the Supabase SQL Editor.
--
-- IMPORTANT: run in TWO steps.
--   STEP 1 = the "STEP 1" block below (0058 + 0060) — plain DDL, transaction-safe.
--   STEP 2 = the single ALTER TYPE line (0059) — must run on its OWN, because
--            ALTER TYPE ... ADD VALUE cannot execute inside a transaction block.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- STEP 1  — paste + Run this whole block first
-- ─────────────────────────────────────────────────────────────

-- 0058: JWSO Documents — file_registry gains a Job-Work-Order dimension
ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "job_work_order_id" uuid REFERENCES "job_work_orders"("id") ON DELETE SET NULL;
ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "jw_code_text" text;
ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "jw_line_id" uuid REFERENCES "job_work_order_lines"("id") ON DELETE SET NULL;
ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "jw_line_no" integer;
CREATE INDEX IF NOT EXISTS "file_registry_company_jw_idx"
  ON "file_registry" ("company_id", "job_work_order_id") WHERE "deleted_at" IS NULL;

-- 0060: JW full plan parity — plans gains a Job-Work source line link
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "jw_line_id" uuid REFERENCES "job_work_order_lines"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "plans_jw_line_idx"
  ON "plans" ("jw_line_id") WHERE "jw_line_id" IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- STEP 2  — run this single line BY ITSELF (new query), after Step 1
-- ─────────────────────────────────────────────────────────────

-- 0059: Save-as-draft — add 'draft' to the shared so_status enum
ALTER TYPE "so_status" ADD VALUE IF NOT EXISTS 'draft' BEFORE 'open';


-- ─────────────────────────────────────────────────────────────
-- VERIFY (optional) — run after both steps; expect all three rows
-- ─────────────────────────────────────────────────────────────
-- SELECT 'file_registry.job_work_order_id' AS check, count(*) FROM information_schema.columns
--   WHERE table_name='file_registry' AND column_name='job_work_order_id'
-- UNION ALL
-- SELECT 'plans.jw_line_id', count(*) FROM information_schema.columns
--   WHERE table_name='plans' AND column_name='jw_line_id'
-- UNION ALL
-- SELECT 'so_status has draft', count(*) FROM pg_enum e
--   JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='so_status' AND e.enumlabel='draft';
