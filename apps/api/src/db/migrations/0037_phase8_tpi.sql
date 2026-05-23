-- ============================================================
-- 0037_phase8_tpi
-- TPI (Third Party Inspection) — op_log metadata, NOT a new table.
-- A TPI op is a QC op whose operation name contains "TPI"; the TPI submit
-- writes a normal op_log qc entry flagged is_tpi with inspector/org/cert.
-- Mirrors legacy renderTPI HTML L21381 / _tpiSubmit L21510.
-- See docs/PARITY/qc-tpi.md. Idempotent.
-- ============================================================

ALTER TABLE "op_log" ADD COLUMN IF NOT EXISTS "is_tpi" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "op_log" ADD COLUMN IF NOT EXISTS "tpi_inspector" text;
--> statement-breakpoint
ALTER TABLE "op_log" ADD COLUMN IF NOT EXISTS "tpi_organization" text;
--> statement-breakpoint
ALTER TABLE "op_log" ADD COLUMN IF NOT EXISTS "tpi_cert_no" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "op_log_company_tpi_idx"
  ON "op_log" ("company_id", "log_date")
  WHERE "is_tpi" = true;
