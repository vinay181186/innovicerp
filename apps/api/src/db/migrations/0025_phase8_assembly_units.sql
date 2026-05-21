-- ============================================================
-- 0025_phase8_assembly_units
-- PL-5 of Phase B (Planning module). Per ADR-030.
--
-- Two new tables:
--   assembly_units      — one row per assembled equipment unit instance.
--                         Tracks serial, date, assembledBy, dispatch flag.
--                         Includes `deductions` jsonb — snapshot of per-child
--                         stock deductions at assembly time (read-only
--                         metadata; store_transactions remains source of
--                         truth for actual stock movement).
--   assembly_tracking   — override table for manual component readiness per
--                         (so_id, child_item_code). Per-component, not per
--                         unit — represents the planner declaring "I have
--                         N of this part ready" even if stock disagrees.
--
-- Both tables: standard audit envelope + RLS company_read + manager_write.
-- Idempotent — safe to re-run via _apply_0025.
-- ============================================================

CREATE TABLE IF NOT EXISTS "assembly_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "so_code_text" text NOT NULL,
  "unit_no" integer NOT NULL,
  "serial_no" text,
  "assembly_date" date NOT NULL,
  "assembled_by" text,
  "remarks" text,
  "bom_master_id" uuid REFERENCES "bom_masters"("id") ON DELETE SET NULL,
  "part_no_text" text,
  "customer_text" text,
  "dispatched" boolean NOT NULL DEFAULT false,
  "dispatch_date" date,
  "dispatched_by" text,
  "dispatch_remarks" text,
  "deductions" jsonb,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT assembly_units_unit_no_positive CHECK ("unit_no" > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "assembly_units_so_unit_uniq"
  ON "assembly_units" ("sales_order_id", "unit_no")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "assembly_units_company_dispatch_idx"
  ON "assembly_units" ("company_id", "dispatched")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "assembly_units_serial_idx"
  ON "assembly_units" ("serial_no")
  WHERE "serial_no" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "assembly_units" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "assembly_units_company_read" ON "assembly_units"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "assembly_units_manager_write" ON "assembly_units"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── assembly_tracking ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "assembly_tracking" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "child_item_code" text NOT NULL,
  "child_item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "ready_qty_override" integer NOT NULL DEFAULT 0,
  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT assembly_tracking_override_nonneg CHECK ("ready_qty_override" >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "assembly_tracking_so_child_uniq"
  ON "assembly_tracking" ("sales_order_id", "child_item_code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "assembly_tracking_company_so_idx"
  ON "assembly_tracking" ("company_id", "sales_order_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "assembly_tracking" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "assembly_tracking_company_read" ON "assembly_tracking"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "assembly_tracking_manager_write" ON "assembly_tracking"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
