-- ============================================================
-- 0043_phase8_qc_parity
-- QC module legacy-parity schema additions (all ADDITIVE columns; idempotent).
-- Driven by the QC re-audit vs legacy InnovicERP HTML. See docs/PARITY/qc-*.md.
--
--  1. nc_register.operator_text          — legacy Report-NC captured operator.
--  2. op_log.qc_report_path / _name      — per-QC-entry attached report file
--     (Supabase Storage path in the qc-docs bucket). Drives the "Report"
--     column on QC History / QC Call Register / TPI + SO QC Status.
--  3. goods_receipt_note_lines.qc_report_path / _name — per-GRN-line QC report
--     (Incoming QC "Report" column / _viewQCReport).
--  4. qc_documents.jc_op_id / qc_op_name / sr_from / sr_to — link a QC doc to a
--     specific JC QC op + the piece serial-range it certifies. Drives the
--     legacy SO-pivoted QC-completion matrix (renderQCDocuments L23039).
--
-- No new RLS — existing per-company table policies cover the new columns.
-- ============================================================

-- 1. NC operator ------------------------------------------------------------
ALTER TABLE "nc_register" ADD COLUMN IF NOT EXISTS "operator_text" text;
--> statement-breakpoint

-- 2. op_log QC report attachment -------------------------------------------
ALTER TABLE "op_log" ADD COLUMN IF NOT EXISTS "qc_report_path" text;
--> statement-breakpoint
ALTER TABLE "op_log" ADD COLUMN IF NOT EXISTS "qc_report_name" text;
--> statement-breakpoint

-- 3. GRN-line QC report attachment -----------------------------------------
ALTER TABLE "goods_receipt_note_lines" ADD COLUMN IF NOT EXISTS "qc_report_path" text;
--> statement-breakpoint
ALTER TABLE "goods_receipt_note_lines" ADD COLUMN IF NOT EXISTS "qc_report_name" text;
--> statement-breakpoint

-- 4. qc_documents → JC QC-op link + serial range ---------------------------
ALTER TABLE "qc_documents" ADD COLUMN IF NOT EXISTS "jc_op_id" uuid REFERENCES "jc_ops"("id");
--> statement-breakpoint
ALTER TABLE "qc_documents" ADD COLUMN IF NOT EXISTS "qc_op_name" text;
--> statement-breakpoint
ALTER TABLE "qc_documents" ADD COLUMN IF NOT EXISTS "sr_from" integer;
--> statement-breakpoint
ALTER TABLE "qc_documents" ADD COLUMN IF NOT EXISTS "sr_to" integer;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "qc_documents_jc_op_idx"
  ON "qc_documents" ("jc_op_id") WHERE "deleted_at" IS NULL;
