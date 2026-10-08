-- ============================================================
-- 0202_ml_boms.sql  (ADR-225 Phase 1 — Multi-Level BOM master)
--
-- A NEW document, separate from BOM Master. bom_masters / bom_master_lines /
-- bom_master_revisions are NOT touched by this file.
--
--   ml_boms           — header: IN-MLB-##### code, the item it makes,
--                       revision, is_default (one Default per item)
--   ml_bom_lines      — child item + Qty per Set + BOM type; a manufacture
--                       line may link the child item's own Multi-Level BOM
--                       (child_ml_bom_id, server-resolved), so one BOM nests
--                       to any depth (the service caps it at 10 levels and
--                       refuses loops)
--   ml_bom_revisions  — append-only: the lines as they were at each revision
--                       (carries the full audit column set, rule 3)
--
-- Guards in the database:
--   - composite FK (child_ml_bom_id, child_item_id) → ml_boms(id, item_id):
--     a sub-assembly link can only point at THAT child item's own BOM
--   - a link exists only on a manufacture line (CHECK)
--   - one live Default per item (partial unique index)
--   - one live line per child item per BOM (partial unique index)
-- Loops and depth are refused by the service (a CHECK cannot see the tree).
--
-- Reuses the existing enum type bom_line_type (0021). RLS and policies copy
-- bom_masters / bom_master_lines / bom_master_revisions exactly
-- (company_read + manager_write; revisions are INSERT-only). updated_at is
-- bumped by public.set_updated_at() (0001) on the header and the lines.
--
-- Additive and idempotent (IF NOT EXISTS / duplicate_object guards). No data
-- change. Apply to BOTH databases (PROD + TEST).
--
-- Rollback (only while the tables are empty — it drops their data):
--   DROP TABLE IF EXISTS public.ml_bom_revisions;
--   DROP TABLE IF EXISTS public.ml_bom_lines;
--   DROP TABLE IF EXISTS public.ml_boms;
-- ============================================================

-- ─── ml_boms (header) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ml_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id),
  revision integer NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT ml_boms_id_item_uniq UNIQUE (id, item_id)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ml_boms_company_code_uniq
  ON public.ml_boms (company_id, code)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ml_boms_one_default_per_item_uniq
  ON public.ml_boms (company_id, item_id)
  WHERE is_default AND deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_boms_item_idx
  ON public.ml_boms (item_id);
--> statement-breakpoint

ALTER TABLE public.ml_boms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_boms_company_read" ON public.ml_boms
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_boms_manager_write" ON public.ml_boms
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER ml_boms_set_updated_at
  BEFORE UPDATE ON public.ml_boms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- ─── ml_bom_lines ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ml_bom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ml_bom_id uuid NOT NULL REFERENCES public.ml_boms(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  child_item_id uuid NOT NULL REFERENCES public.items(id),
  qty_per_set numeric(14,3) NOT NULL,
  bom_type bom_line_type NOT NULL,
  child_ml_bom_id uuid,
  raw_material_grade_id uuid REFERENCES public.material_grades(id) ON DELETE SET NULL,
  raw_material_grade_text text,
  raw_material_size_id uuid REFERENCES public.material_sizes(id) ON DELETE SET NULL,
  raw_material_size_text text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT ml_bom_lines_qty_positive CHECK (qty_per_set > 0),
  CONSTRAINT ml_bom_lines_link_manufacture_only
    CHECK (child_ml_bom_id IS NULL OR bom_type = 'manufacture'),
  CONSTRAINT ml_bom_lines_child_ml_bom_fk
    FOREIGN KEY (child_ml_bom_id, child_item_id)
    REFERENCES public.ml_boms (id, item_id)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ml_bom_lines_bom_item_uniq
  ON public.ml_bom_lines (ml_bom_id, child_item_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_bom_lines_bom_idx
  ON public.ml_bom_lines (ml_bom_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_bom_lines_child_bom_idx
  ON public.ml_bom_lines (child_ml_bom_id);
--> statement-breakpoint

ALTER TABLE public.ml_bom_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_bom_lines_company_read" ON public.ml_bom_lines
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_bom_lines_manager_write" ON public.ml_bom_lines
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER ml_bom_lines_set_updated_at
  BEFORE UPDATE ON public.ml_bom_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- ─── ml_bom_revisions (append-only) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.ml_bom_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ml_bom_id uuid NOT NULL REFERENCES public.ml_boms(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  changed_by_text text NOT NULL,
  notes text,
  lines_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  -- CLAUDE.md rule 3 audit columns. The table stays append-only (INSERT-only
  -- policy below); these are set once on insert and exist for uniformity.
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ml_bom_revisions_bom_rev_uniq
  ON public.ml_bom_revisions (ml_bom_id, revision);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_bom_revisions_bom_idx
  ON public.ml_bom_revisions (ml_bom_id);
--> statement-breakpoint

ALTER TABLE public.ml_bom_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_bom_revisions_company_read" ON public.ml_bom_revisions
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Append-only: only INSERT, no UPDATE/DELETE policies.
DO $$ BEGIN
  CREATE POLICY "ml_bom_revisions_manager_insert" ON public.ml_bom_revisions
    FOR INSERT TO authenticated
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
