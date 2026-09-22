-- 0140 — Partial (progressive) Production Order close (ADR-179).
--
-- Today a Production Order closes ONCE: status open→closed, the JC's whole
-- finished qty credited in one store_transactions row. The floor needs to close
-- pieces AS THEY FINISH — e.g. JC-001 (order 50): last op has cleared 11, credit
-- those 11 now, close the rest later.
--
-- This migration:
--   1. adds the 'partially_closed' status,
--   2. makes production_orders.credited_qty a RUNNING total (semantics only —
--      no column change) and adds lost_qty for a short close,
--   3. adds an append-only ledger `production_order_closes` — one row per
--      partial close, and one per reversal.
--
-- The crediting engine is unchanged: a PO-linked JC still credits ONLY here
-- (ADR-170), and store_transactions already has the 'production_order_close'
-- source_type (migration 0133). Idempotent.

-- 1 + 2. Status values + lost_qty on the header ------------------------------
ALTER TABLE public.production_orders DROP CONSTRAINT IF EXISTS production_orders_status_check;
ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_status_check
  CHECK (status IN ('open', 'partially_closed', 'closed'));

ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS lost_qty integer;
ALTER TABLE public.production_orders DROP CONSTRAINT IF EXISTS production_orders_lost_qty_check;
ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_lost_qty_check
  CHECK (lost_qty IS NULL OR lost_qty >= 0);

-- 3. The close ledger --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_order_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id),
  -- Pieces credited by this row (a reversal's qty is the amount undone).
  qty integer NOT NULL CHECK (qty > 0),
  is_reversal boolean NOT NULL DEFAULT false,
  -- The close row this one reverses (set only on reversal rows).
  reverses_close_id uuid REFERENCES public.production_order_closes(id),
  -- Set only on the close-short row that finishes the PO under target.
  lost_qty integer CHECK (lost_qty IS NULL OR lost_qty >= 0),
  -- The store_transactions row this close wrote (null on a 0-credit short close).
  store_txn_id uuid REFERENCES public.store_transactions(id),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS production_order_closes_po_idx
  ON public.production_order_closes (production_order_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.production_order_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_order_closes_company_read ON public.production_order_closes;
CREATE POLICY production_order_closes_company_read ON public.production_order_closes
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());

DROP POLICY IF EXISTS production_order_closes_manager_write ON public.production_order_closes;
CREATE POLICY production_order_closes_manager_write ON public.production_order_closes
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
