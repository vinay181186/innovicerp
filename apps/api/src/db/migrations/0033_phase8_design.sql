-- ============================================================
-- 0033_phase8_design
-- Design Section — 8 tables in one migration covering both legacy
-- subsystems:
--
--   A) Design Tracker (older, single-table per-SO design assignment)
--      - design_tracker (DSN-NNNN)
--      - design_time_log
--
--   B) Design Engineering (newer, multi-table, v82.0+)
--      - design_projects (DP-NNNN)
--      - design_tasks
--      - design_issues
--      - design_work_log
--      - design_dcrs (DCR-NNNN)
--      - design_dcns (DCN-NNNN)
--
-- Mirrors legacy:
--   renderDesignTracker     HTML L7259  + helpers L7338–7489
--   renderDesignProjects    HTML L7570  + _dpRenderDetail L7623
--   renderDesignIssuesPage  HTML L7890
--   renderDesignWorkLog     HTML L7935  (5-tab page)
--
-- See docs/PARITY/design-section.md for the full design.
-- Idempotent — safe to re-run via _apply_0033.
-- ============================================================

-- ─── design_tracker ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_tracker" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- DSN-NNNN
  "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "so_code_text" text,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name_text" text,
  "designer" text NOT NULL,                               -- text — engineer name (legacy text)
  "estimated_hours" numeric(8,2) NOT NULL DEFAULT 0,
  "start_date" date NOT NULL,
  "target_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'In Progress',           -- Pending | In Progress | Review | Approved | Revision
  "revision" integer NOT NULL DEFAULT 0,
  "remarks" text,
  "approved_at" timestamptz,
  "approved_by_text" text,
  "review_submitted_at" timestamptz,
  "revision_history" jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{rev,date,reason,by}]

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_tracker_status_valid
    CHECK ("status" IN ('Pending','In Progress','Review','Approved','Revision'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "design_tracker_company_code_uniq"
  ON "design_tracker" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_tracker_company_so_idx"
  ON "design_tracker" ("company_id", "sales_order_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_tracker_company_status_idx"
  ON "design_tracker" ("company_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_tracker" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_tracker_company_read" ON "design_tracker"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_tracker_manager_write" ON "design_tracker"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── design_time_log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_time_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "design_tracker_id" uuid NOT NULL REFERENCES "design_tracker"("id") ON DELETE CASCADE,
  "log_date" date NOT NULL,
  "hours" numeric(6,2) NOT NULL,
  "worker_text" text NOT NULL,
  "description" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_time_log_hours_positive CHECK ("hours" > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_time_log_tracker_idx"
  ON "design_time_log" ("design_tracker_id", "log_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_time_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_time_log_company_read" ON "design_time_log"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_time_log_manager_write" ON "design_time_log"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── design_projects ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- DP-NNNN
  "project_name" text NOT NULL,
  "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "so_code_text" text,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "client_text" text,
  "lead_text" text,                                       -- engineer name (text)
  "engineers" jsonb NOT NULL DEFAULT '[]'::jsonb,         -- ["name1","name2"]
  "status" text NOT NULL DEFAULT 'Design Active',         -- Design Active | In Review | Released | On Hold
  "start_date" date NOT NULL,
  "target_date" date NOT NULL,
  "description" text,
  "checklist" jsonb NOT NULL DEFAULT '{}'::jsonb,         -- { "allTasksDone": true, ... }
  "released_date" date,
  "released_by_text" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_projects_status_valid
    CHECK ("status" IN ('Design Active','In Review','Released','On Hold'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "design_projects_company_code_uniq"
  ON "design_projects" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_projects_company_status_idx"
  ON "design_projects" ("company_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_projects_company_read" ON "design_projects"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_projects_manager_write" ON "design_projects"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── design_tasks ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "design_project_id" uuid NOT NULL REFERENCES "design_projects"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "part_text" text,
  "assignee_text" text,
  "priority" text NOT NULL DEFAULT 'Medium',              -- Critical | High | Medium | Low
  "status" text NOT NULL DEFAULT 'Not Started',           -- Not Started | In Progress | In Review | Completed
  "due_date" date,
  "description" text,
  "completed_at" timestamptz,
  "discussions" jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{author,text,date}]

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_tasks_priority_valid
    CHECK ("priority" IN ('Critical','High','Medium','Low')),
  CONSTRAINT design_tasks_status_valid
    CHECK ("status" IN ('Not Started','In Progress','In Review','Completed'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_tasks_project_idx"
  ON "design_tasks" ("design_project_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_tasks_company_read" ON "design_tasks"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_tasks_manager_write" ON "design_tasks"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── design_issues ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "design_project_id" uuid NOT NULL REFERENCES "design_projects"("id") ON DELETE CASCADE,
  "design_task_id" uuid REFERENCES "design_tasks"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "part_text" text,
  "severity" text NOT NULL DEFAULT 'Major',               -- Critical | Major | Minor
  "status" text NOT NULL DEFAULT 'Open',                  -- Open | In Progress | Resolved | Closed
  "raised_by_text" text,
  "assigned_to_text" text,
  "raised_date" date NOT NULL,
  "resolved_date" date,
  "description" text,
  "discussions" jsonb NOT NULL DEFAULT '[]'::jsonb,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_issues_severity_valid
    CHECK ("severity" IN ('Critical','Major','Minor')),
  CONSTRAINT design_issues_status_valid
    CHECK ("status" IN ('Open','In Progress','Resolved','Closed'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_issues_project_idx"
  ON "design_issues" ("design_project_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_issues_company_status_idx"
  ON "design_issues" ("company_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_issues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_issues_company_read" ON "design_issues"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_issues_manager_write" ON "design_issues"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── design_work_log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_work_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "log_date" date NOT NULL,
  "engineer_text" text NOT NULL,
  "design_project_id" uuid REFERENCES "design_projects"("id") ON DELETE SET NULL,
  "task_text" text,                                       -- task title (text — flexible)
  "category" text NOT NULL DEFAULT 'Design',              -- 9 categories from _dpWorkCategories
  "hours" numeric(6,2) NOT NULL,
  "description" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_work_log_hours_positive CHECK ("hours" > 0),
  CONSTRAINT design_work_log_category_valid
    CHECK ("category" IN (
      'Design','Review','Rework','Issue Resolution','Client Support',
      'Meeting','Documentation','Testing/FEA','Other'
    ))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_work_log_company_date_idx"
  ON "design_work_log" ("company_id", "log_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_work_log_engineer_date_idx"
  ON "design_work_log" ("company_id", "engineer_text", "log_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_work_log_project_idx"
  ON "design_work_log" ("design_project_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_work_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_work_log_company_read" ON "design_work_log"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_work_log_manager_write" ON "design_work_log"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── design_dcrs ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_dcrs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "design_project_id" uuid NOT NULL REFERENCES "design_projects"("id") ON DELETE CASCADE,
  "code" text NOT NULL,                                   -- DCR-NNNN
  "title" text NOT NULL,
  "change_type" text NOT NULL DEFAULT 'Other',            -- Client Request | Manufacturing Issue | QC Finding | Cost Optimization | Safety | Material Change | Other
  "part_affected" text,
  "priority" text NOT NULL DEFAULT 'Normal',              -- Urgent | Normal | Low
  "status" text NOT NULL DEFAULT 'Submitted',             -- Submitted | Under Review | Accepted | Rejected
  "requested_by_text" text,
  "request_date" date NOT NULL,
  "description" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_dcrs_priority_valid
    CHECK ("priority" IN ('Urgent','Normal','Low')),
  CONSTRAINT design_dcrs_status_valid
    CHECK ("status" IN ('Submitted','Under Review','Accepted','Rejected'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "design_dcrs_company_code_uniq"
  ON "design_dcrs" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_dcrs_project_idx"
  ON "design_dcrs" ("design_project_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_dcrs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_dcrs_company_read" ON "design_dcrs"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_dcrs_manager_write" ON "design_dcrs"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── design_dcns ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "design_dcns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "design_project_id" uuid NOT NULL REFERENCES "design_projects"("id") ON DELETE CASCADE,
  "linked_dcr_id" uuid REFERENCES "design_dcrs"("id") ON DELETE SET NULL,
  "code" text NOT NULL,                                   -- DCN-NNNN
  "title" text NOT NULL,
  "status" text NOT NULL DEFAULT 'Draft',                 -- Draft | In Progress | Review | Approved | Released
  "description" text,
  "released_date" date,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT design_dcns_status_valid
    CHECK ("status" IN ('Draft','In Progress','Review','Approved','Released'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "design_dcns_company_code_uniq"
  ON "design_dcns" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_dcns_project_idx"
  ON "design_dcns" ("design_project_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_dcns_dcr_idx"
  ON "design_dcns" ("linked_dcr_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "design_dcns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_dcns_company_read" ON "design_dcns"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "design_dcns_manager_write" ON "design_dcns"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
