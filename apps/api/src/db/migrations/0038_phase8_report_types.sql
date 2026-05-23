-- ============================================================
-- 0038_phase8_report_types
-- Report / Document Master — report/document types used as QC document
-- requirement options in SO/JW Planning. Mirrors legacy renderReportMaster
-- HTML L23677. See docs/PARITY/qc-report-master.md. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS "report_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "name" text NOT NULL,
  "description" text,
  "default_mandatory" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'Active',                 -- Active | Inactive

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT report_types_status_valid CHECK ("status" IN ('Active','Inactive'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "report_types_company_status_idx"
  ON "report_types" ("company_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "report_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "report_types_company_read" ON "report_types"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "report_types_qc_write" ON "report_types"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
