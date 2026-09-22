-- ============================================================
-- 0141_stock_reservation_soft  (ADR-180)
--
-- Reservation stops moving stock and starts BOOKING it.
--
-- Stage 1 (migration 0099) modelled a reservation as a HARD MOVE: reserving
-- posted a store_transactions 'out' row, so the shelf figure fell even though
-- nothing had left the building, and "free stock" and "physical stock" became
-- the same number. The three figures the factory actually needs are:
--
--   PHYSICAL  = item_stock_balances.on_hand_qty     (on the shelf)
--   RESERVED  = Σ (reserved_qty - consumed_qty - released_qty) of active rows
--   AVAILABLE = PHYSICAL - RESERVED
--
-- From here a reservation NEVER writes to store_transactions. Only a real
-- stock-out (dispatch, store issue) reduces PHYSICAL.
--
-- The existing so_stock_reservations table is EXTENDED, not replaced: it
-- already carries company / so_line / item / qty / status / audit columns and
-- is read by SO Planning and Customer Dispatch. A second reservation table
-- would have split the truth in two.
--
-- Safe to run: verified on both databases 2026-09-22 — so_stock_reservations
-- holds 0 rows and store_transactions holds 0 rows with source_type
-- 'reservation', on TEST and on PROD. Nothing to back-fill, no stock figure
-- moves when this lands.
--
-- Additive and nullable only. No column is dropped or renamed.
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Partial consumption and release, so one booking can be shipped in pieces.
ALTER TABLE public.so_stock_reservations
  ADD COLUMN IF NOT EXISTS consumed_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_qty integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- 2. Where the booking came from, and which documents produced it.
ALTER TABLE public.so_stock_reservations
  ADD COLUMN IF NOT EXISTS reservation_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_reason text;
--> statement-breakpoint

-- 3. The close that created an automatic booking. UNIQUE, so replaying the
--    close API can never book the same pieces twice (ADR-180 §M).
ALTER TABLE public.so_stock_reservations
  ADD COLUMN IF NOT EXISTS production_order_close_id uuid
    REFERENCES public.production_order_closes(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS so_stock_reservations_close_uniq
  ON public.so_stock_reservations (production_order_close_id)
  WHERE production_order_close_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint

-- 4. Status vocabulary grows from 3 values to 5. 'dispatched' is kept so any
--    historical row stays legal; new rows use 'consumed'.
ALTER TABLE public.so_stock_reservations
  DROP CONSTRAINT IF EXISTS so_stock_reservations_status_valid;
--> statement-breakpoint

ALTER TABLE public.so_stock_reservations
  ADD CONSTRAINT so_stock_reservations_status_valid
  CHECK (status IN ('active', 'partially_consumed', 'consumed', 'released', 'cancelled', 'dispatched'));
--> statement-breakpoint

ALTER TABLE public.so_stock_reservations
  DROP CONSTRAINT IF EXISTS so_stock_reservations_source_valid;
--> statement-breakpoint

ALTER TABLE public.so_stock_reservations
  ADD CONSTRAINT so_stock_reservations_source_valid
  CHECK (reservation_source IN ('auto_production', 'manual'));
--> statement-breakpoint

-- 5. A booking can never give back more than it took.
ALTER TABLE public.so_stock_reservations
  DROP CONSTRAINT IF EXISTS so_stock_reservations_settled_within_qty;
--> statement-breakpoint

ALTER TABLE public.so_stock_reservations
  ADD CONSTRAINT so_stock_reservations_settled_within_qty
  CHECK (consumed_qty >= 0 AND released_qty >= 0 AND consumed_qty + released_qty <= qty);
--> statement-breakpoint

-- 6. The index the availability sum runs on: only rows still holding stock.
CREATE INDEX IF NOT EXISTS so_stock_reservations_active_item_idx
  ON public.so_stock_reservations (company_id, item_id)
  WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed');
--> statement-breakpoint

-- 7. RESERVED and AVAILABLE per item, in one place, so no screen re-invents
--    the arithmetic. Reads the maintained balance table, never a ledger sum.
CREATE OR REPLACE VIEW public.v_item_stock_availability AS
SELECT
  b.company_id,
  b.item_id,
  b.on_hand_qty                                        AS physical_qty,
  COALESCE(r.reserved_qty, 0)::integer                 AS reserved_qty,
  (b.on_hand_qty - COALESCE(r.reserved_qty, 0))::integer AS available_qty
FROM public.item_stock_balances b
LEFT JOIN (
  SELECT company_id, item_id,
         SUM(qty - consumed_qty - released_qty)::integer AS reserved_qty
  FROM public.so_stock_reservations
  WHERE deleted_at IS NULL
    AND status IN ('active', 'partially_consumed')
  GROUP BY company_id, item_id
) r ON r.company_id = b.company_id AND r.item_id = b.item_id;
--> statement-breakpoint

-- 8. Audit of every reservation movement. The generic activity_log keeps its
--    one-line-per-action story; this is the numeric trail the reconciliation
--    checks read (old qty -> new qty per reservation).
CREATE TABLE IF NOT EXISTS public.stock_reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  reservation_id uuid NOT NULL REFERENCES public.so_stock_reservations(id) ON DELETE CASCADE,
  -- reserve | consume | release | cancel | amend_release
  event_type text NOT NULL CHECK (event_type IN ('reserve', 'consume', 'release', 'cancel', 'amend_release')),
  qty integer NOT NULL CHECK (qty > 0),
  remaining_before integer NOT NULL,
  remaining_after integer NOT NULL,
  reason text,
  -- The document that caused it (a DC code on consume, null on a manual reserve).
  source_ref text,
  customer_dispatch_id uuid REFERENCES public.customer_dispatches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS stock_reservation_events_res_idx
  ON public.stock_reservation_events (reservation_id, created_at);
--> statement-breakpoint

ALTER TABLE public.stock_reservation_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY stock_reservation_events_company_read ON public.stock_reservation_events
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY stock_reservation_events_manager_insert ON public.stock_reservation_events
    FOR INSERT TO authenticated
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
