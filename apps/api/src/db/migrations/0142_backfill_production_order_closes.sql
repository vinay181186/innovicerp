-- ============================================================
-- 0142_backfill_production_order_closes
--
-- Gives every Production Order that was closed BEFORE migration 0140 the
-- close-ledger row it never got.
--
-- ADR-179 turned the one-shot close into a progressive one and introduced
-- `production_order_closes` as the running record of what each close credited.
-- Orders closed before that migration landed set `production_orders.credited_qty`
-- and wrote their store_transactions row, but there was no ledger table to
-- record the close itself. The result is an order that says "credited 500"
-- with nothing behind it, which fails reconciliation check C2
-- (credited_qty = Σ closes) in docs/sql/check-stock-reservation.sql — found on
-- TEST as IN-PRO-00001, closed 2026-09-18, credited 500, zero close rows.
--
-- This writes ONE close row per such order, pointing at the stock movement
-- that actually credited the goods, so the trail reads end to end. It invents
-- no quantity: qty comes from `credited_qty`, which the ledger row already
-- agrees with (check C passes today).
--
-- No stock moves. No store_transactions row is written or changed.
--
-- Idempotent: an order that already has any close row is skipped, so a re-run
-- adds nothing.
-- ============================================================

INSERT INTO public.production_order_closes (
  company_id,
  production_order_id,
  qty,
  is_reversal,
  store_txn_id,
  remarks,
  created_at,
  created_by,
  updated_at,
  updated_by
)
SELECT
  p.company_id,
  p.id,
  p.credited_qty,
  false,
  -- The credit this close produced. Pre-0140 closes wrote source_ref = the
  -- bare order code; 0140 onwards append '#<n>'. Match either, oldest first.
  (
    SELECT t.id
    FROM public.store_transactions t
    WHERE t.company_id = p.company_id
      AND t.source_type = 'production_order_close'
      AND t.txn_type = 'in'
      AND (t.source_ref = p.code OR t.source_ref LIKE p.code || '#%')
    ORDER BY t.created_at
    LIMIT 1
  ),
  'Backfilled by migration 0142 — order closed before the close ledger existed (ADR-179).',
  COALESCE(p.closed_at, p.updated_at),
  COALESCE(p.closed_by, p.updated_by, p.created_by),
  COALESCE(p.closed_at, p.updated_at),
  COALESCE(p.closed_by, p.updated_by, p.created_by)
FROM public.production_orders p
WHERE p.deleted_at IS NULL
  AND COALESCE(p.credited_qty, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.production_order_closes c
    WHERE c.production_order_id = p.id
      AND c.deleted_at IS NULL
  );
