-- ============================================================
-- 0056_so_milestones
-- SO Delivery Schedule / Milestones (ISSUE-015). Legacy soHeaderForm
-- "📅 Delivery Schedule / Milestones" stored repeatable delivery lots
-- {lot#, qty, dueDate, remarks} on an SO (`_soMilestones`). SO-level child
-- rows, merged like sales_order_lines. Additive — new table only.
-- ============================================================

CREATE TABLE IF NOT EXISTS "so_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "lot_no" integer NOT NULL,
  "qty" integer NOT NULL DEFAULT 0,
  "due_date" date,
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "so_milestones_so_idx"
  ON "so_milestones" ("sales_order_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "so_milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "so_milestones_company_read" ON "so_milestones"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "so_milestones_manager_write" ON "so_milestones"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
