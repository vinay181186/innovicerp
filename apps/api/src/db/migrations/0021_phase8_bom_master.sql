-- ============================================================
-- 0021_phase8_bom_master
-- BOM-1 (Phase A item 1 of LEGACY_AUDIT.md build plan).
-- Ports legacy renderBOMMaster (legacy/InnovicERP_v82_12_3.html L8438)
-- to first-class Postgres schema.
--
-- Three tables + two enums + one ALTER on sales_order_lines:
--
--   bom_masters             — header (bom_no, bom_name, revision, status)
--   bom_master_lines        — child items + qty_per_set + bom_type
--   bom_master_revisions    — append-only audit of revision history
--                              (items_snapshot stored as jsonb)
--   sales_order_lines.source_bom_master_id  — FK so SO lines can reference
--                                              a BOM (cascade in BOM-8)
--
-- Legacy notes:
--   - revision is an integer auto-bumped on edit; the previous lines[] is
--     snapshotted into bom_master_revisions.items_snapshot before the
--     bom_master_lines rows are replaced.
--   - status: draft (WIP) → active (linkable from SOs) → obsolete (archived).
--   - bom_type per line drives downstream cascade behaviour (BOM-8):
--       manufacture → spawn child JC
--       purchase    → spawn PR
--       outsource   → spawn outsource PR
--
-- Idempotent — safe to re-run via _apply_0021 applier.
-- ============================================================

-- ─── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE bom_status AS ENUM ('draft', 'active', 'obsolete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE bom_line_type AS ENUM ('manufacture', 'purchase', 'outsource');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── bom_masters (header) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bom_masters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "bom_no" text NOT NULL,
  "bom_name" text NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "status" bom_status NOT NULL DEFAULT 'draft',
  "revision_date" date NOT NULL DEFAULT current_date,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "bom_masters_company_no_uniq"
  ON "bom_masters" ("company_id", "bom_no")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bom_masters_company_status_idx"
  ON "bom_masters" ("company_id", "status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "bom_masters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "bom_masters_company_read" ON "bom_masters"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "bom_masters_manager_write" ON "bom_masters"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── bom_master_lines ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bom_master_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "bom_master_id" uuid NOT NULL REFERENCES "bom_masters"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "child_item_id" uuid NOT NULL REFERENCES "items"("id"),
  "qty_per_set" numeric(12,2) NOT NULL,
  "bom_type" bom_line_type NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  CONSTRAINT "bom_master_lines_qty_positive" CHECK ("qty_per_set" > 0)
);
--> statement-breakpoint

-- Duplicate-child guard: same item cannot appear twice on one BOM.
-- Legacy validates this in JS (_validateBOMMaster line 8586); DB enforces.
CREATE UNIQUE INDEX IF NOT EXISTS "bom_master_lines_bom_item_uniq"
  ON "bom_master_lines" ("bom_master_id", "child_item_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bom_master_lines_bom_idx"
  ON "bom_master_lines" ("bom_master_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bom_master_lines_item_idx"
  ON "bom_master_lines" ("child_item_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "bom_master_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "bom_master_lines_company_read" ON "bom_master_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "bom_master_lines_manager_write" ON "bom_master_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── bom_master_revisions (append-only audit) ─────────────────
-- Snapshot of the lines AS THEY WERE at this revision. JSON form
-- avoids a second-level table while preserving exact field set
-- (child_item_id, qty_per_set, bom_type). Stored in chronological
-- order — read with ORDER BY revision DESC for "most recent first".
CREATE TABLE IF NOT EXISTS "bom_master_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "bom_master_id" uuid NOT NULL REFERENCES "bom_masters"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "changed_by_text" text NOT NULL,
  "notes" text,
  "items_snapshot" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id")
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "bom_master_revisions_bom_rev_uniq"
  ON "bom_master_revisions" ("bom_master_id", "revision");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bom_master_revisions_bom_idx"
  ON "bom_master_revisions" ("bom_master_id");
--> statement-breakpoint

ALTER TABLE "bom_master_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "bom_master_revisions_company_read" ON "bom_master_revisions"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Append-only: only INSERT, no UPDATE/DELETE policies.
DO $$ BEGIN
  CREATE POLICY "bom_master_revisions_manager_insert" ON "bom_master_revisions"
    FOR INSERT TO authenticated
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── sales_order_lines: FK to BOM master ──────────────────────
-- Cascade in BOM-8: when an SO line is created with this set, walk
-- the BOM lines and spawn child JCs / PRs based on bom_type.
ALTER TABLE "sales_order_lines"
  ADD COLUMN IF NOT EXISTS "source_bom_master_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_source_bom_fk"
    FOREIGN KEY ("source_bom_master_id")
    REFERENCES "public"."bom_masters"("id")
    ON DELETE SET NULL
    ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_order_lines_source_bom_idx"
  ON "sales_order_lines" ("source_bom_master_id")
  WHERE "source_bom_master_id" IS NOT NULL;
