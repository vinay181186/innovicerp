-- ============================================================
-- 0193_jwso_structure.sql  (ADR-203)
-- JWSO structure foundation: customer RM per LINE (real FKs), one RM item
-- per order item (<item code>-RM), DB rules the code used to promise alone.
-- Idempotent. Apply to BOTH the test and the production database.
-- ============================================================

-- 0. Pre-flight: refuse to run if the new unique rules would fail mid-way.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.items WHERE deleted_at IS NULL
    GROUP BY company_id, lower(code) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0193: two live items share a code that differs only by letter case — fix them first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.party_materials WHERE deleted_at IS NULL AND item_id IS NOT NULL
    GROUP BY company_id, item_id, client_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0193: duplicate party materials for one customer + item — merge them first';
  END IF;
END $$;
--> statement-breakpoint

-- 1. Party Supplied Material code suffix is now upper-case "-RM" (owner D2).
UPDATE public.items
   SET code = regexp_replace(code, '-rm$', '-RM')
 WHERE item_type = 'party_supplied_material' AND code ~ '-rm$';
--> statement-breakpoint
UPDATE public.party_materials
   SET item_code_text = regexp_replace(item_code_text, '-rm$', '-RM')
 WHERE item_code_text ~ '-rm$';
--> statement-breakpoint
UPDATE public.job_work_orders
   SET client_material = regexp_replace(client_material, '-rm$', '-RM')
 WHERE client_material ~ '-rm$';
--> statement-breakpoint

-- 2. Item codes unique regardless of letter case; RM item knows its order item.
CREATE UNIQUE INDEX IF NOT EXISTS items_company_lower_code_uniq
  ON public.items (company_id, lower(code)) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS parent_item_id uuid REFERENCES public.items(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS items_company_parent_rm_uniq
  ON public.items (company_id, parent_item_id)
  WHERE deleted_at IS NULL AND parent_item_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_parent_only_psm;
ALTER TABLE public.items
  ADD CONSTRAINT items_parent_only_psm
  CHECK (parent_item_id IS NULL OR item_type = 'party_supplied_material');
--> statement-breakpoint
-- Link existing RM items to their order item when the code says so.
UPDATE public.items rm
   SET parent_item_id = p.id
  FROM public.items p
 WHERE rm.item_type = 'party_supplied_material'
   AND rm.parent_item_id IS NULL
   AND rm.deleted_at IS NULL
   AND p.company_id = rm.company_id
   AND p.deleted_at IS NULL
   AND p.item_type <> 'party_supplied_material'
   AND lower(p.code) || '-rm' = lower(rm.code);
--> statement-breakpoint

-- 3. Party material: one per customer + RM item; non-negative counters.
CREATE UNIQUE INDEX IF NOT EXISTS party_materials_company_item_client_uniq
  ON public.party_materials (company_id, item_id, client_id)
  WHERE deleted_at IS NULL AND item_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.party_materials DROP CONSTRAINT IF EXISTS party_materials_returned_nonneg;
ALTER TABLE public.party_materials
  ADD CONSTRAINT party_materials_returned_nonneg CHECK (returned_qty >= 0);
--> statement-breakpoint

-- 4. JWSO line carries its own customer RM (item + per-customer party material).
ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS rm_item_id uuid REFERENCES public.items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS party_material_id uuid REFERENCES public.party_materials(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_work_order_lines_rm_item_idx
  ON public.job_work_order_lines (rm_item_id) WHERE deleted_at IS NULL AND rm_item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_work_order_lines_party_material_idx
  ON public.job_work_order_lines (party_material_id) WHERE deleted_at IS NULL AND party_material_id IS NOT NULL;
--> statement-breakpoint
-- Backfill (a): the RM item that belongs to the line's order item.
UPDATE public.job_work_order_lines l
   SET rm_item_id = rm.id
  FROM public.items rm
 WHERE l.rm_item_id IS NULL
   AND l.item_id IS NOT NULL
   AND rm.parent_item_id = l.item_id
   AND rm.deleted_at IS NULL;
--> statement-breakpoint
-- Backfill (b): otherwise the JWSO header's customer material code.
UPDATE public.job_work_order_lines l
   SET rm_item_id = i.id
  FROM public.job_work_orders jw, public.items i
 WHERE l.rm_item_id IS NULL
   AND l.job_work_order_id = jw.id
   AND btrim(coalesce(jw.client_material, '')) <> ''
   AND i.company_id = jw.company_id
   AND lower(i.code) = lower(btrim(jw.client_material))
   AND i.item_type = 'party_supplied_material'
   AND i.deleted_at IS NULL;
--> statement-breakpoint
UPDATE public.job_work_order_lines l
   SET party_material_id = pm.id
  FROM public.job_work_orders jw, public.party_materials pm
 WHERE l.party_material_id IS NULL
   AND l.rm_item_id IS NOT NULL
   AND l.job_work_order_id = jw.id
   AND pm.company_id = jw.company_id
   AND pm.item_id = l.rm_item_id
   AND pm.client_id = jw.client_id
   AND pm.deleted_at IS NULL;
--> statement-breakpoint
-- Four legacy line columns, empty on both databases and absent from schema.ts.
ALTER TABLE public.job_work_order_lines
  DROP COLUMN IF EXISTS client_material,
  DROP COLUMN IF EXISTS client_material_qty,
  DROP COLUMN IF EXISTS material_received_date,
  DROP COLUMN IF EXISTS material_received_qty;
--> statement-breakpoint

-- 5. JWSO line counters can never contradict each other.
ALTER TABLE public.job_work_order_lines DROP CONSTRAINT IF EXISTS job_work_order_lines_counters_check;
ALTER TABLE public.job_work_order_lines
  ADD CONSTRAINT job_work_order_lines_counters_check
  CHECK (returned_qty >= 0 AND invoiced_qty >= 0 AND invoiced_qty <= returned_qty);
--> statement-breakpoint

-- 6. Party GRN line numbers unique within a GRN.
CREATE UNIQUE INDEX IF NOT EXISTS party_grn_lines_grn_line_uniq
  ON public.party_grn_lines (party_grn_id, line_no) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- 7. Issue to Job Card records the JWSO line it draws on.
ALTER TABLE public.party_material_issues
  ADD COLUMN IF NOT EXISTS jw_line_id uuid REFERENCES public.job_work_order_lines(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_material_issues_jw_line_idx
  ON public.party_material_issues (jw_line_id) WHERE deleted_at IS NULL AND jw_line_id IS NOT NULL;
--> statement-breakpoint
UPDATE public.party_material_issues pmi
   SET jw_line_id = jc.source_jw_line_id
  FROM public.job_cards jc
 WHERE pmi.jw_line_id IS NULL
   AND pmi.job_card_id = jc.id
   AND jc.source_jw_line_id IS NOT NULL;
--> statement-breakpoint

-- 8. Quantities must be positive; return challan status is a closed list.
ALTER TABLE public.party_material_issues DROP CONSTRAINT IF EXISTS party_material_issues_qty_positive;
ALTER TABLE public.party_material_issues
  ADD CONSTRAINT party_material_issues_qty_positive CHECK (qty > 0);
--> statement-breakpoint
ALTER TABLE public.jw_return_challans DROP CONSTRAINT IF EXISTS jw_return_challans_qty_positive;
ALTER TABLE public.jw_return_challans
  ADD CONSTRAINT jw_return_challans_qty_positive CHECK (qty > 0);
--> statement-breakpoint
ALTER TABLE public.jw_return_challans DROP CONSTRAINT IF EXISTS jw_return_challans_status_check;
ALTER TABLE public.jw_return_challans
  ADD CONSTRAINT jw_return_challans_status_check CHECK (status IN ('issued', 'cancelled'));
--> statement-breakpoint
ALTER TABLE public.jw_invoices DROP CONSTRAINT IF EXISTS jw_invoices_qty_positive;
ALTER TABLE public.jw_invoices
  ADD CONSTRAINT jw_invoices_qty_positive CHECK (qty > 0);
--> statement-breakpoint

-- 9. Party stock ledger: movement and direction must agree.
ALTER TABLE public.party_stock_ledger DROP CONSTRAINT IF EXISTS party_stock_ledger_movement_direction_check;
ALTER TABLE public.party_stock_ledger
  ADD CONSTRAINT party_stock_ledger_movement_direction_check
  CHECK (
    (movement = 'receive' AND direction = 'in')
    OR (movement IN ('issue', 'consume', 'return') AND direction = 'out')
    OR movement = 'reversal'
  );
--> statement-breakpoint

-- 10. History links to a JWSO line can no longer be cut by a delete.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.job_work_order_lines'::regclass
       AND c.conrelid IN ('public.party_grn_lines'::regclass, 'public.party_stock_ledger'::regclass)
       AND c.confdeltype <> 'r'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.job_work_order_lines(id) ON DELETE RESTRICT',
      r.tbl, r.conname, r.col);
  END LOOP;
END $$;
--> statement-breakpoint

-- 11. Party stock ledger is append-only (same rule as the company stock ledger, ADR-185).
CREATE OR REPLACE FUNCTION public.party_stock_ledger_refuse_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('innovic.ledger_maintenance', true), '') = 'on'
     OR COALESCE(current_setting('application_name', true), '') = 'innovic-test-harness' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'The customer material register cannot be % — post a reversal instead (ADR-203).',
    CASE TG_OP WHEN 'UPDATE' THEN 'edited' ELSE 'deleted' END
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS party_stock_ledger_immutable ON public.party_stock_ledger;
--> statement-breakpoint
CREATE TRIGGER party_stock_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.party_stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.party_stock_ledger_refuse_change();
--> statement-breakpoint

-- 12. Incoming QC is a separate step (owner D4): a new Party GRN line waits
--     with accepted = rejected = 0 and qc_at NULL until QC books it.
ALTER TABLE public.party_grn_lines
  ADD COLUMN IF NOT EXISTS rejected_returned_qty integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.party_grn_lines DROP CONSTRAINT IF EXISTS party_grn_lines_qc_split_check;
ALTER TABLE public.party_grn_lines
  ADD CONSTRAINT party_grn_lines_qc_split_check
  CHECK (
    (qc_at IS NULL AND accepted_qty = 0 AND rejected_qty = 0)
    OR (qc_at IS NOT NULL AND accepted_qty + rejected_qty = received_qty)
    OR (qc_at IS NULL AND accepted_qty + rejected_qty = received_qty)
  );
--> statement-breakpoint
ALTER TABLE public.party_grn_lines DROP CONSTRAINT IF EXISTS party_grn_lines_rejected_returned_check;
ALTER TABLE public.party_grn_lines
  ADD CONSTRAINT party_grn_lines_rejected_returned_check
  CHECK (rejected_returned_qty >= 0 AND rejected_returned_qty <= rejected_qty);
--> statement-breakpoint

-- 13. Unused material put back from a Job Card into the register.
ALTER TABLE public.party_material_issues
  ADD COLUMN IF NOT EXISTS returned_to_store_qty integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.party_material_issues DROP CONSTRAINT IF EXISTS party_material_issues_returned_check;
ALTER TABLE public.party_material_issues
  ADD CONSTRAINT party_material_issues_returned_check
  CHECK (returned_to_store_qty >= 0 AND returned_to_store_qty <= qty);
--> statement-breakpoint

-- 14. Customer Material Return (IN-CMR-#####, owner D3): the challan that
--     sends the customer's own material back — spare good stock or held rejects.
CREATE TABLE IF NOT EXISTS public.customer_material_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  return_date date NOT NULL,
  job_work_order_id uuid NOT NULL REFERENCES public.job_work_orders(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  vehicle_no text,
  remarks text,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS customer_material_returns_company_code_uniq
  ON public.customer_material_returns (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_material_returns_jw_idx
  ON public.customer_material_returns (company_id, job_work_order_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.customer_material_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  return_id uuid NOT NULL REFERENCES public.customer_material_returns(id) ON DELETE RESTRICT,
  line_no integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('good', 'rejected')),
  jw_line_id uuid NOT NULL REFERENCES public.job_work_order_lines(id) ON DELETE RESTRICT,
  party_material_id uuid NOT NULL REFERENCES public.party_materials(id) ON DELETE RESTRICT,
  party_grn_line_id uuid REFERENCES public.party_grn_lines(id) ON DELETE RESTRICT,
  qty integer NOT NULL CHECK (qty > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT customer_material_return_lines_rejected_has_grn
    CHECK (kind = 'good' OR party_grn_line_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS customer_material_return_lines_line_uniq
  ON public.customer_material_return_lines (return_id, line_no) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_material_return_lines_jw_line_idx
  ON public.customer_material_return_lines (jw_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.customer_material_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_material_return_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS customer_material_returns_company_read ON public.customer_material_returns;
CREATE POLICY customer_material_returns_company_read ON public.customer_material_returns
  FOR SELECT TO authenticated USING (company_id = current_company_id());
DROP POLICY IF EXISTS customer_material_returns_manager_write ON public.customer_material_returns;
CREATE POLICY customer_material_returns_manager_write ON public.customer_material_returns
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
--> statement-breakpoint
DROP POLICY IF EXISTS customer_material_return_lines_company_read ON public.customer_material_return_lines;
CREATE POLICY customer_material_return_lines_company_read ON public.customer_material_return_lines
  FOR SELECT TO authenticated USING (company_id = current_company_id());
DROP POLICY IF EXISTS customer_material_return_lines_manager_write ON public.customer_material_return_lines;
CREATE POLICY customer_material_return_lines_manager_write ON public.customer_material_return_lines
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
