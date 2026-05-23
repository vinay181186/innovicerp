-- ============================================================
-- 0036_phase8_capa
-- CAPA — Corrective & Preventive Action register.
-- Mirrors legacy renderCAPA HTML L22779 + _capaNew L22831 / _capaEdit L22860
-- (5-step process: Problem -> Root Cause -> Corrective -> Verification ->
-- Preventive/Effectiveness). See docs/PARITY/qc-capa.md.
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS "capa_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                    -- CAPA-NNNN
  "type" text NOT NULL DEFAULT 'Corrective',               -- Corrective | Preventive
  "capa_date" date NOT NULL,
  "nc_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,            -- [ncNo, ...]
  "jc_no" text,
  "so_no" text,
  "item_code" text,
  "operation" text,
  "problem" text NOT NULL,
  "root_cause_method" text,                                -- 5-Why | Fishbone | Other
  "root_cause" text,
  "corrective_action" text,
  "responsible" text,
  "target_date" date,
  "verification" text,
  "verified_by" text,
  "verified_date" date,
  "preventive_action" text,
  "effectiveness" text,                                    -- Effective | Not Effective | ''
  "review_date" date,
  "status" text NOT NULL DEFAULT 'Open',                   -- Open | In Progress | Verified | Closed
  "department" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT capa_records_type_valid CHECK ("type" IN ('Corrective','Preventive')),
  CONSTRAINT capa_records_status_valid
    CHECK ("status" IN ('Open','In Progress','Verified','Closed'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "capa_records_company_code_uniq"
  ON "capa_records" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "capa_records_company_status_idx"
  ON "capa_records" ("company_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "capa_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "capa_records_company_read" ON "capa_records"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "capa_records_qc_write" ON "capa_records"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
