-- ============================================================
-- 0024_phase8_plans
-- PL-3 of Phase B (Planning module). Per ADR-030.
--
-- Two new tables:
--   plans     — one row per (SO line × BOM child). Wide nullable
--               shape — type-specific columns coexist; service-layer
--               + DB CHECK constraints enforce which columns are
--               required per plan_type. Status machine:
--                 in_planning → planned → (jc_created | pr_created)
--                            → in_production → complete
--                          + cancelled (soft terminal)
--   plan_ops  — child table; operations per manufacture/assembly
--               plan. Avoids the legacy JSONB-blob anti-pattern.
--
-- Two new enums: plan_status, plan_type.
--
-- CHECK constraints:
--   1. (plan_type, plan_status) legal combinations:
--        - jc_created only with manufacture or assembly
--        - pr_created only with direct_purchase or full_outsource
--   2. Status → required FK links:
--        - jc_created requires jc_id
--        - pr_created direct_purchase requires dp_pr_id
--        - pr_created full_outsource  requires fo_pr_id
--
-- RLS: company_read + manager_write (admin/manager only). Status-
-- guarded updates are enforced at the service layer (mutations
-- only allowed when status ∈ in_planning | planned for non-admin).
--
-- Idempotent — safe to re-run via _apply_0024.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plan_status AS ENUM (
    'in_planning',
    'planned',
    'jc_created',
    'pr_created',
    'in_production',
    'complete',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE plan_type AS ENUM (
    'manufacture',
    'direct_purchase',
    'full_outsource',
    'assembly'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,
  "plan_date" date NOT NULL,
  "plan_status" plan_status NOT NULL DEFAULT 'in_planning',
  "plan_type" plan_type NOT NULL,

  -- Source SO/JW link (per SO LINE; null for standalone manufacture plans)
  "so_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE SET NULL,
  "so_code_text" text,
  "line_no" integer,

  -- Item under plan
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name_text" text,

  -- Quantities
  "order_qty" integer NOT NULL,
  "plan_qty" integer NOT NULL,

  -- Schedule
  "planned_start_date" date,
  "planned_end_date" date,

  -- BOM child link (set for Equipment SO sub-plans)
  "bom_master_id" uuid REFERENCES "bom_masters"("id") ON DELETE SET NULL,
  "bom_parent_code" text,
  "bom_child_code" text,

  -- Manufacture / assembly fields
  "jc_id" uuid REFERENCES "job_cards"("id") ON DELETE SET NULL,

  -- Direct-purchase fields
  "dp_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "dp_vendor_code_text" text,
  "dp_cost" numeric(12,2),
  "dp_remarks" text,
  "dp_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,

  -- Full-outsource fields
  "fo_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "fo_vendor_code_text" text,
  "fo_process" text,
  "fo_rate" numeric(12,2),
  "fo_material_src" text,
  "fo_delivery_date" date,
  "fo_cost_center" text,
  "fo_remarks" text,
  "fo_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,
  "fo_mat_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,

  -- Material PR for assembly
  "material_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,

  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT plans_order_qty_positive CHECK ("order_qty" > 0),
  CONSTRAINT plans_plan_qty_positive  CHECK ("plan_qty" > 0),

  -- (type, status) legal combinations
  CONSTRAINT plans_type_status_check CHECK (
    ("plan_status" != 'jc_created' OR "plan_type" IN ('manufacture', 'assembly'))
    AND
    ("plan_status" != 'pr_created' OR "plan_type" IN ('direct_purchase', 'full_outsource'))
  ),

  -- Status → required FK link present
  CONSTRAINT plans_status_fk_check CHECK (
    ("plan_status" != 'jc_created' OR "jc_id" IS NOT NULL)
    AND
    (NOT ("plan_status" = 'pr_created' AND "plan_type" = 'direct_purchase') OR "dp_pr_id" IS NOT NULL)
    AND
    (NOT ("plan_status" = 'pr_created' AND "plan_type" = 'full_outsource') OR "fo_pr_id" IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "plans_company_code_uniq"
  ON "plans" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_company_status_idx"
  ON "plans" ("company_id", "plan_status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_so_line_idx"
  ON "plans" ("so_line_id")
  WHERE "so_line_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_jc_id_idx"
  ON "plans" ("jc_id")
  WHERE "jc_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_item_idx"
  ON "plans" ("item_id")
  WHERE "item_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_company_date_idx"
  ON "plans" ("company_id", "plan_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "plans_company_read" ON "plans"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "plans_manager_write" ON "plans"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── plan_ops ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "plan_ops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE,
  "op_seq" integer NOT NULL,
  "machine_id" uuid REFERENCES "machines"("id"),
  "machine_code_text" text,
  "operation" text NOT NULL,
  "op_type" op_type NOT NULL DEFAULT 'process',
  "cycle_time_min" numeric(10,2) NOT NULL DEFAULT '0',
  "program" text,
  "tool_details" text,
  "qc_required" boolean NOT NULL DEFAULT false,

  -- Outsource fields (mirror jc_ops shape so PL-4 can copy ops 1:1 on Execute)
  "outsource_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "outsource_vendor_text" text,
  "outsource_cost" numeric(12,2) NOT NULL DEFAULT '0',
  "outsource_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,
  "outsource_lead_days" integer,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "plan_ops_plan_seq_uniq"
  ON "plan_ops" ("plan_id", "op_seq")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plan_ops_machine_idx"
  ON "plan_ops" ("machine_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plan_ops_outsource_pr_idx"
  ON "plan_ops" ("outsource_pr_id")
  WHERE "outsource_pr_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "plan_ops" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "plan_ops_company_read" ON "plan_ops"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "plan_ops_manager_write" ON "plan_ops"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
