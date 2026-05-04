-- Phase 5 cleanup — drop legacy text columns on jc_ops that were superseded
-- by the FK columns added in Phase 5 storage (T-035b: outsource_pr_id,
-- outsource_po_line_id) and backfilled in T-035c (1 row migrated cleanly,
-- validate-phase5 PASS 2026-05-02). Per ADR-015 #5: keep the text columns
-- only as long as needed to backfill, then drop. T-035c shipped + soaked
-- 2 days; safe to drop.
--
-- Hand-written because drizzle-kit treats this as a destructive column
-- drop that needs explicit acknowledgment. Idempotent so re-runs via
-- apply-sql.ts are safe.

ALTER TABLE "jc_ops" DROP COLUMN IF EXISTS "outsource_pr_no";
--> statement-breakpoint
ALTER TABLE "jc_ops" DROP COLUMN IF EXISTS "outsource_po_no";
