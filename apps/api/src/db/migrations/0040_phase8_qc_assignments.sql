-- ============================================================
-- 0040_phase8_qc_assignments
-- QC Command Center Pick-Up / Assign (legacy db.qcAssignments,
-- _qccPickUp / _qccAssign HTML L18719-18755). One ACTIVE assignment per
-- jc_op (unique partial index). Pick-Up = assign to self (any QC writer);
-- assigning to another inspector is admin-only (enforced in the service).
-- inspector_name is a display snapshot beside the FK. See
-- docs/PARITY/qc-command-center.md. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS "qc_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "jc_op_id" uuid NOT NULL REFERENCES "jc_ops"("id") ON DELETE CASCADE,
  "inspector_user_id" uuid REFERENCES "users"("id"),
  "inspector_name" text NOT NULL,
  "note" text,
  "assigned_by_text" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

-- One active assignment per op (pick-up / re-assign upserts onto this).
CREATE UNIQUE INDEX IF NOT EXISTS "qc_assignments_company_op_uq"
  ON "qc_assignments" ("company_id", "jc_op_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Workload lookups (current load per inspector).
CREATE INDEX IF NOT EXISTS "qc_assignments_company_inspector_idx"
  ON "qc_assignments" ("company_id", "inspector_user_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "qc_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "qc_assignments_company_read" ON "qc_assignments"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "qc_assignments_qc_write" ON "qc_assignments"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
