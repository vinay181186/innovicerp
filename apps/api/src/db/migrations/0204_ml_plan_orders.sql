-- ============================================================
-- 0204_ml_plan_orders.sql  (ADR-225 Phase 4 — raise orders from a
-- Multi-Level Plan)
--
-- Purpose: remember WHICH Multi-Level Plan row (ml_plan_nodes, 0203) a plan
-- or a purchase request was raised from.
--
--   plans.ml_plan_node_id              — a Manufacture / Outsource row's plan.
--                                        The TOP row's plan also carries the
--                                        SO line; every other row's plan has
--                                        no SO line, so it never moves the SO
--                                        line's Planned figure.
--   purchase_requests.ml_plan_node_id  — a Buy row's PR (no SO line). Such a
--                                        PR is bound to demand, exactly like
--                                        source_so_line_id: it is not free
--                                        supply for another plan's On PO / PR.
--
-- Raised (per row) = live plan_qty of its plans + live qty of its PRs; the
-- service caps a request at Net Need − Raised under the Multi-Level Plan's
-- row lock (CLAUDE.md §20.3).
--
-- Additive only: two nullable columns + two partial indexes. Existing rows
-- keep NULL. No data change. Idempotent (IF NOT EXISTS). The tables' RLS is
-- unchanged (no new table). Apply to BOTH databases (PROD + TEST) BEFORE the
-- code that reads the columns is deployed — a bare select on plans /
-- purchase_requests lists every column in schema.ts.
--
-- Rollback (drops only the link; the plans / PRs themselves stay):
--   DROP INDEX IF EXISTS public.purchase_requests_ml_plan_node_idx;
--   DROP INDEX IF EXISTS public.plans_ml_plan_node_idx;
--   ALTER TABLE public.purchase_requests DROP COLUMN IF EXISTS ml_plan_node_id;
--   ALTER TABLE public.plans DROP COLUMN IF EXISTS ml_plan_node_id;
-- ============================================================

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS ml_plan_node_id uuid REFERENCES public.ml_plan_nodes(id);
--> statement-breakpoint

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS ml_plan_node_id uuid REFERENCES public.ml_plan_nodes(id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS plans_ml_plan_node_idx
  ON public.plans (ml_plan_node_id)
  WHERE ml_plan_node_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS purchase_requests_ml_plan_node_idx
  ON public.purchase_requests (ml_plan_node_id)
  WHERE ml_plan_node_id IS NOT NULL;
