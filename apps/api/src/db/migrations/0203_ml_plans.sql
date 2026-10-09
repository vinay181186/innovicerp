-- ============================================================
-- 0203_ml_plans.sql  (ADR-225 Phase 3 — Multi-Level Plan)
--
-- Purpose: a NEW document, the ERPNext "Production Plan" for ONE Sales Order
-- line whose item has a Default Multi-Level BOM (ml_boms, 0202).
--
--   ml_plans       — header: IN-MLP-##### code, the SO line it plans, the
--                    item, the Multi-Level BOM + BOM Rev it copied, Plan Qty
--                    (complete sets), status draft / released / cancelled
--   ml_plan_nodes  — the BOM tree COPIED at snapshot time, one row per node
--                    (top row = the SO line's item), with the figures worked
--                    out then: Gross Need, From Stock, On PO / PR, Net Need
--                    (numeric(14,3)). parent_node_id makes the tree.
--
-- Guards in the database:
--   - one LIVE plan per SO line (partial unique index on so_line_id where
--     status <> 'cancelled' and not deleted) — the backstop for a double
--     submit; the service also locks the SO line FOR UPDATE (CLAUDE.md §20.3)
--   - plan_qty > 0; status in the three values; a cancelled plan carries
--     when it was cancelled
--   - every figure on a node >= 0
--   - one live node per (plan, seq)
--
-- Nothing existing is changed: plans / bom_masters / ml_boms are NOT touched.
-- RLS and policies copy ml_boms / ml_bom_lines (0202) exactly
-- (company_read + manager_write). updated_at is bumped by
-- public.set_updated_at() (0001) on both tables.
--
-- Additive and idempotent (IF NOT EXISTS / duplicate_object guards). No data
-- change. Apply to BOTH databases (PROD + TEST).
--
-- Rollback (only while the tables are empty — it drops their data):
--   DROP TABLE IF EXISTS public.ml_plan_nodes;
--   DROP TABLE IF EXISTS public.ml_plans;
-- ============================================================

-- ─── ml_plans (header) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ml_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id),
  so_line_id uuid NOT NULL REFERENCES public.sales_order_lines(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  ml_bom_id uuid NOT NULL REFERENCES public.ml_boms(id),
  ml_bom_revision integer NOT NULL,
  plan_qty integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  remarks text,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT ml_plans_plan_qty_positive CHECK (plan_qty > 0),
  CONSTRAINT ml_plans_status_check CHECK (status IN ('draft', 'released', 'cancelled')),
  CONSTRAINT ml_plans_cancelled_stamp CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ml_plans_company_code_uniq
  ON public.ml_plans (company_id, code)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ml_plans_one_live_per_so_line_uniq
  ON public.ml_plans (so_line_id)
  WHERE status <> 'cancelled' AND deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_plans_sales_order_idx
  ON public.ml_plans (sales_order_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_plans_ml_bom_idx
  ON public.ml_plans (ml_bom_id);
--> statement-breakpoint

ALTER TABLE public.ml_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_plans_company_read" ON public.ml_plans
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_plans_manager_write" ON public.ml_plans
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER ml_plans_set_updated_at
  BEFORE UPDATE ON public.ml_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- ─── ml_plan_nodes (the copied tree + figures) ────────────────
CREATE TABLE IF NOT EXISTS public.ml_plan_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ml_plan_id uuid NOT NULL REFERENCES public.ml_plans(id) ON DELETE CASCADE,
  parent_node_id uuid REFERENCES public.ml_plan_nodes(id),
  depth integer NOT NULL,
  seq integer NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id),
  bom_type bom_line_type,
  is_sub_assembly boolean NOT NULL DEFAULT false,
  ml_bom_id uuid REFERENCES public.ml_boms(id),
  ml_bom_revision integer,
  qty_per_set numeric(14,3),
  gross_need_qty numeric(14,3) NOT NULL,
  from_stock_qty numeric(14,3) NOT NULL,
  on_po_pr_qty numeric(14,3) NOT NULL,
  net_need_qty numeric(14,3) NOT NULL,
  raw_material_grade_text text,
  raw_material_size_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT ml_plan_nodes_depth_nonneg CHECK (depth >= 0),
  CONSTRAINT ml_plan_nodes_seq_nonneg CHECK (seq >= 0),
  CONSTRAINT ml_plan_nodes_gross_nonneg CHECK (gross_need_qty >= 0),
  CONSTRAINT ml_plan_nodes_from_stock_nonneg CHECK (from_stock_qty >= 0),
  CONSTRAINT ml_plan_nodes_on_po_pr_nonneg CHECK (on_po_pr_qty >= 0),
  CONSTRAINT ml_plan_nodes_net_nonneg CHECK (net_need_qty >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ml_plan_nodes_plan_seq_uniq
  ON public.ml_plan_nodes (ml_plan_id, seq)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_plan_nodes_plan_idx
  ON public.ml_plan_nodes (ml_plan_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ml_plan_nodes_item_idx
  ON public.ml_plan_nodes (item_id);
--> statement-breakpoint

ALTER TABLE public.ml_plan_nodes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_plan_nodes_company_read" ON public.ml_plan_nodes
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "ml_plan_nodes_manager_write" ON public.ml_plan_nodes
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER ml_plan_nodes_set_updated_at
  BEFORE UPDATE ON public.ml_plan_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
