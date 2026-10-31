-- ============================================================
-- 0235_report_type_last_stage_only
-- Owner rule (approved 2026-10-31): in a Job Card an intermediate (middle)
-- DIR QC stage report is OPTIONAL; the report on the LAST QC stage is
-- COMPULSORY. "Last stage" = the op with the card's highest live op_seq (the
-- same last-op rule stock credit and QC history already use).
--
--   1. report_types.last_stage_only — a Mandatory report type with this flag
--      is compulsory only on the card's last op (Submit QC blocks there);
--      on a middle op it may be submitted without the report and still shows
--      as "to upload" / "not uploaded (optional)".
--   2. DIR and Final Inspection become Mandatory + Last Stage Only.
--      TPI / MIR / MCR are untouched (stay mandatory on every stage).
-- Idempotent (IF NOT EXISTS; the UPDATE sets fixed values).
-- Apply: DB_TARGET=TEST|PROD … apply-sql.ts.
-- ============================================================

ALTER TABLE public.report_types
  ADD COLUMN IF NOT EXISTS last_stage_only boolean NOT NULL DEFAULT false;
--> statement-breakpoint

UPDATE public.report_types
   SET default_mandatory = true,
       last_stage_only = true,
       updated_at = now()
 WHERE deleted_at IS NULL
   AND lower(btrim(name)) IN ('dir', 'final inspection');
