-- ============================================================
-- 0158_assembly_reservations_fitting.sql  (ADR-193 phase 3c)
--
-- Reserve parts for an assembly (Equipment) SO; Complete only checks and fits.
--   assembly_part_reservations  NEW — free stock held for an assembly SO's BOM
--                               parts (numeric, keyed to the SO, not a line —
--                               so_stock_reservations is integer and per SO
--                               line, and dispatch / PRO close read it: P27)
--   assembly_unit_consumptions  NEW — parts FITTED into an assembled unit by
--                               Complete. No ledger row: the parts left the
--                               store when they were issued.
--   store_issue_lines          += reserved_used_qty (own reservation used by
--                               the line; given back on Reverse)
--   v_item_stock_availability  reserved_qty = sales reservations remaining
--                               + assembly reservations remaining
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback (in this order):
--   CREATE OR REPLACE VIEW public.v_item_stock_availability AS <the 0153
--     definition, 0153 lines 97-112: so_stock_reservations only>;
--   ALTER TABLE public.store_issue_lines DROP COLUMN reserved_used_qty;
--   DROP TABLE public.assembly_unit_consumptions;
--   DROP TABLE public.assembly_part_reservations;
-- ============================================================

BEGIN;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.assembly_part_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id),
  so_code_text text NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  consumed_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  released_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (released_qty >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'partially_consumed', 'consumed', 'released')),
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  CONSTRAINT assembly_part_reservations_settled_check CHECK (consumed_qty + released_qty <= qty)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assembly_part_reservations_so_idx
  ON public.assembly_part_reservations (sales_order_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assembly_part_reservations_item_idx
  ON public.assembly_part_reservations (item_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.assembly_unit_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  assembly_unit_id uuid NOT NULL REFERENCES public.assembly_units(id),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  variance_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assembly_unit_consumptions_unit_idx
  ON public.assembly_unit_consumptions (assembly_unit_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assembly_unit_consumptions_so_item_idx
  ON public.assembly_unit_consumptions (sales_order_id, item_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE public.assembly_part_reservations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assembly_unit_consumptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY assembly_part_reservations_company_all ON public.assembly_part_reservations
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY assembly_unit_consumptions_company_all ON public.assembly_unit_consumptions
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE public.store_issue_lines
  ADD COLUMN IF NOT EXISTS reserved_used_qty numeric(14,3) NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.store_issue_lines
    ADD CONSTRAINT store_issue_lines_reserved_used_check CHECK (reserved_used_qty >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Same columns, names, order and types as before — only "reserved" now also
-- counts what assembly SOs still hold.
CREATE OR REPLACE VIEW public.v_item_stock_availability AS
SELECT b.company_id,
       b.item_id,
       b.on_hand_qty AS physical_qty,
       COALESCE(r.reserved_qty, 0)::numeric(14,3) AS reserved_qty,
       (b.on_hand_qty - COALESCE(r.reserved_qty, 0))::numeric(14,3) AS available_qty
FROM public.item_stock_balances b
LEFT JOIN (
  SELECT x.company_id, x.item_id, SUM(x.held) AS reserved_qty
  FROM (
    SELECT company_id, item_id, (qty - consumed_qty - released_qty)::numeric AS held
    FROM public.so_stock_reservations
    WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed')
    UNION ALL
    SELECT company_id, item_id, (qty - consumed_qty - released_qty)::numeric AS held
    FROM public.assembly_part_reservations
    WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed')
  ) x
  GROUP BY x.company_id, x.item_id
) r ON r.company_id = b.company_id AND r.item_id = b.item_id;
--> statement-breakpoint
GRANT SELECT ON public.v_item_stock_availability TO authenticated;
--> statement-breakpoint

COMMIT;
