-- ============================================================
-- 0229_day_log_entry_revisions
-- ADR-256 (owner 2026-10-30): a Day Log entry's Start / Stop / SO-JWSO edit
-- is saved DIRECTLY (no approval), and the owner wants ONE common history
-- that covers every edit — not a Working On-only one. So 0228's
-- daily_report_line_text_revisions becomes daily_report_line_revisions:
-- each row (Entry Rev 0 = first save, +1 per changed save of ANY field) now
-- keeps the whole entry as it was then — Working On, Start, Stop, SO / JWSO.
--
-- Old rows (written before this, Working On only) keep Start / Stop / SO
-- NULL: what they were at that moment was never kept, so nothing is made
-- up. The screen shows them as "Times / SO not recorded".
--
-- Deploy window: the API that is live while this runs (ADR-255) still
-- writes and reads daily_report_line_text_revisions.text_rev_no, so a view
-- under that old name keeps it working until the new API is up. A later
-- migration drops the view.
--
-- An earlier draft of this file (applied on TEST only) made a separate
-- daily_report_line_changes table; it is dropped here (empty, never on PROD).
--
-- Idempotent. Rollback: rename back (table, column, index, policy) and drop
-- the four new columns. Apply to BOTH test and production (release script).
-- ============================================================

DROP TABLE IF EXISTS "daily_report_line_changes";

DO $$ BEGIN
  IF to_regclass('public.daily_report_line_text_revisions') IS NOT NULL
     AND to_regclass('public.daily_report_line_revisions') IS NULL THEN
    ALTER TABLE "daily_report_line_text_revisions" RENAME TO "daily_report_line_revisions";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'daily_report_line_revisions'
               AND column_name = 'text_rev_no') THEN
    ALTER TABLE "daily_report_line_revisions" RENAME COLUMN "text_rev_no" TO "entry_rev_no";
  END IF;
END $$;

ALTER INDEX IF EXISTS "dl_text_revisions_line_rev_uq" RENAME TO "dl_revisions_line_rev_uq";
ALTER INDEX IF EXISTS "dl_text_revisions_company_line_idx" RENAME TO "dl_revisions_company_line_idx";
DO $$ BEGIN
  ALTER TABLE "daily_report_line_revisions" RENAME CONSTRAINT "dl_text_revisions_rev_chk" TO "dl_revisions_rev_chk";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER POLICY "dl_text_revisions_no_client_read" ON "daily_report_line_revisions"
    RENAME TO "dl_revisions_no_client_read";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL; END $$;

ALTER TABLE "daily_report_line_revisions"
  ADD COLUMN IF NOT EXISTS "from_time" time,
  ADD COLUMN IF NOT EXISTS "to_time" time,
  ADD COLUMN IF NOT EXISTS "sales_order_id" uuid,
  ADD COLUMN IF NOT EXISTS "job_work_order_id" uuid;

-- Same link rules as daily_report_lines (0223): an order going away clears
-- the link; never both an SO and a JWSO. (An earlier TEST-only draft added
-- the links without ON DELETE — those unnamed constraints are replaced.)
ALTER TABLE "daily_report_line_revisions"
  DROP CONSTRAINT IF EXISTS "daily_report_line_revisions_sales_order_id_fkey",
  DROP CONSTRAINT IF EXISTS "daily_report_line_revisions_job_work_order_id_fkey";
DO $$ BEGIN
  ALTER TABLE "daily_report_line_revisions" ADD CONSTRAINT "dl_revisions_so_fk"
    FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "daily_report_line_revisions" ADD CONSTRAINT "dl_revisions_jw_fk"
    FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "daily_report_line_revisions" ADD CONSTRAINT "dl_revisions_one_order_chk"
    CHECK ("sales_order_id" IS NULL OR "job_work_order_id" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "dl_revisions_so_idx"
  ON "daily_report_line_revisions" ("sales_order_id") WHERE "sales_order_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "dl_revisions_jw_idx"
  ON "daily_report_line_revisions" ("job_work_order_id") WHERE "job_work_order_id" IS NOT NULL;

-- Deploy window (see header): the old name, as the ADR-255 API uses it.
CREATE OR REPLACE VIEW "daily_report_line_text_revisions"
  WITH (security_invoker = true) AS
  SELECT "id", "company_id", "line_id", "entry_rev_no" AS "text_rev_no", "description",
         "saved_at", "created_at", "created_by", "updated_at", "updated_by",
         "deleted_at", "deleted_by"
  FROM "daily_report_line_revisions";
