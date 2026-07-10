-- ============================================================
-- 0060_plans_jw_line
-- JW full plan parity in SO/JW Planning.
--
-- Adds a Job-Work source link to the plans table so a plan can be
-- raised against a job_work_order_lines row, exactly like the existing
-- so_line_id link raises one against a sales_order_lines row.
--
-- No CHECK-constraint changes needed: plans_type_status_check and
-- plans_status_fk_check reference only jc_id / dp_pr_id / fo_pr_id —
-- never the source line — and so_line_id was already nullable
-- (standalone plans). jw_line_id is likewise nullable; a plan carries
-- at most one of (so_line_id, jw_line_id), enforced at the service layer.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "jw_line_id" uuid
  REFERENCES "job_work_order_lines"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_jw_line_idx"
  ON "plans" ("jw_line_id")
  WHERE "jw_line_id" IS NOT NULL;
