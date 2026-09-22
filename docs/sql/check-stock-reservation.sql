-- ============================================================
-- check-stock-reservation.sql — the ADR-180 reconciliation
--
-- Run against a database AFTER applying migration 0141 and after any round of
-- reservation testing. Every row must read PASS. A FAIL means the three stock
-- figures have drifted apart and the feature must not be called complete.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- Read-only: nothing here writes.
--
-- The seven checks map 1:1 to the acceptance list in ADR-180 §X:
--   A  available = physical - reserved            (the definition itself)
--   B  Σ reservation detail = displayed reserved  (no orphan/oversized rows)
--   C  production accepted FG = ledger movement   (close credited what it says)
--   D  dispatch reduction    = dispatch movement  (shipped what it says)
--   E  reservation consumption = dispatched reserved qty
--   F  no duplicate inventory posting
--   G  no negative available reachable
-- ============================================================

-- A. AVAILABLE = PHYSICAL - RESERVED, for every item.
--    The view computes it; this proves the view agrees with the raw tables.
SELECT 'A. available = physical - reserved' AS check,
       COUNT(*) FILTER (
         WHERE v.available_qty <> v.physical_qty - v.reserved_qty
       ) AS bad_rows,
       CASE WHEN COUNT(*) FILTER (
         WHERE v.available_qty <> v.physical_qty - v.reserved_qty
       ) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.v_item_stock_availability v;

-- B. The reserved figure equals the sum of the rows behind it, item by item.
WITH detail AS (
  SELECT company_id, item_id,
         SUM(qty - consumed_qty - released_qty)::int AS held
  FROM public.so_stock_reservations
  WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed')
  GROUP BY company_id, item_id
)
SELECT 'B. sum(detail) = reserved shown' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.v_item_stock_availability v
LEFT JOIN detail d ON d.company_id = v.company_id AND d.item_id = v.item_id
WHERE v.reserved_qty <> COALESCE(d.held, 0);

-- B2. No reservation may have given back or shipped more than it booked.
SELECT 'B2. consumed + released <= qty' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.so_stock_reservations
WHERE deleted_at IS NULL
  AND (consumed_qty < 0 OR released_qty < 0 OR consumed_qty + released_qty > qty);

-- B3. A reservation must never hold more than the order line asked for.
SELECT 'B3. reserved <= order qty - dispatched' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT r.so_line_id,
         SUM(r.qty - r.consumed_qty - r.released_qty)::int AS held,
         MAX(l.order_qty)::int       AS order_qty,
         MAX(l.dispatched_qty)::int  AS dispatched_qty
  FROM public.so_stock_reservations r
  JOIN public.sales_order_lines l ON l.id = r.so_line_id AND l.deleted_at IS NULL
  WHERE r.deleted_at IS NULL AND r.status IN ('active', 'partially_consumed')
  GROUP BY r.so_line_id
) x
WHERE x.held > GREATEST(0, x.order_qty - x.dispatched_qty);

-- C. Every Production Order close credited exactly what its ledger row says.
--    A close with qty > 0 must have one store_transactions 'in' row.
SELECT 'C. close credited = ledger movement' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.production_order_closes c
LEFT JOIN public.store_transactions t ON t.id = c.store_txn_id
WHERE c.deleted_at IS NULL
  AND c.is_reversal = false
  AND c.qty > 0
  AND (t.id IS NULL OR t.qty <> c.qty OR t.txn_type <> 'in');

-- C2. credited_qty on the order equals the signed sum of its close ledger.
SELECT 'C2. credited_qty = sum(closes)' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT p.id,
         COALESCE(p.credited_qty, 0)::int AS stored,
         COALESCE(SUM(CASE WHEN c.is_reversal THEN -c.qty ELSE c.qty END), 0)::int AS computed
  FROM public.production_orders p
  LEFT JOIN public.production_order_closes c
         ON c.production_order_id = p.id AND c.deleted_at IS NULL
  WHERE p.deleted_at IS NULL
  GROUP BY p.id, p.credited_qty
) y
WHERE y.stored <> y.computed;

-- D. Dispatch reduced stock by exactly what the dispatch lines say.
SELECT 'D. dispatch out = dispatch lines' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT d.id, d.code,
         COALESCE(SUM(dl.qty), 0)::int AS line_qty,
         COALESCE((
           SELECT SUM(CASE WHEN t.txn_type = 'out' THEN t.qty ELSE -t.qty END)
           FROM public.store_transactions t
           WHERE t.source_type = 'dispatch' AND t.source_ref LIKE d.code || '%'
         ), 0)::int AS ledger_qty
  FROM public.customer_dispatches d
  JOIN public.customer_dispatch_lines dl
    ON dl.customer_dispatch_id = d.id AND dl.deleted_at IS NULL
  WHERE d.deleted_at IS NULL AND d.status = 'dispatched'
  GROUP BY d.id, d.code
) z
WHERE z.line_qty <> z.ledger_qty;

-- E. Reservation consumption never exceeds what was dispatched on that line.
SELECT 'E. consumed <= dispatched on line' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT r.so_line_id,
         SUM(r.consumed_qty)::int AS consumed,
         MAX(l.dispatched_qty)::int AS dispatched
  FROM public.so_stock_reservations r
  JOIN public.sales_order_lines l ON l.id = r.so_line_id AND l.deleted_at IS NULL
  WHERE r.deleted_at IS NULL
  GROUP BY r.so_line_id
) e
WHERE e.consumed > e.dispatched;

-- F. No duplicate inventory posting.
-- F1. A reservation must NEVER appear in the stock ledger (ADR-180's core rule).
SELECT 'F1. no reservation rows in ledger' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.store_transactions
WHERE source_type = 'reservation'
  AND created_at > (SELECT COALESCE(MAX(created_at), '-infinity'::timestamptz)
                    FROM public.so_stock_reservations WHERE false);
-- (Historical rows, if any ever existed, would predate 0141; both databases
--  held zero when it landed, so any row here at all is a regression.)

-- F2. One automatic booking per Production Order close, at most.
SELECT 'F2. one auto booking per close' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT production_order_close_id, COUNT(*) AS n
  FROM public.so_stock_reservations
  WHERE deleted_at IS NULL AND production_order_close_id IS NOT NULL
  GROUP BY production_order_close_id
  HAVING COUNT(*) > 1
) f2;

-- F3. The on-hand cache still equals the ledger. (Guards the trigger.)
SELECT 'F3. balance cache = ledger sum' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT b.company_id, b.item_id, b.on_hand_qty,
         COALESCE(SUM(CASE WHEN t.txn_type = 'in' THEN t.qty
                           WHEN t.txn_type = 'out' THEN -t.qty
                           ELSE t.qty END), 0)::int AS ledger
  FROM public.item_stock_balances b
  LEFT JOIN public.store_transactions t
         ON t.company_id = b.company_id AND t.item_id = b.item_id
  GROUP BY b.company_id, b.item_id, b.on_hand_qty
) f3
WHERE f3.on_hand_qty <> f3.ledger;

-- G. No negative AVAILABLE, and no negative PHYSICAL.
SELECT 'G. no negative available/physical' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.v_item_stock_availability
WHERE available_qty < 0 OR physical_qty < 0;

-- H. The event trail balances against the rows it describes.
SELECT 'H. events reconcile to reservation' AS check,
       COUNT(*) AS bad_rows,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT r.id,
         r.consumed_qty,
         r.released_qty,
         COALESCE(SUM(e.qty) FILTER (WHERE e.event_type = 'consume'), 0)::int AS ev_consumed,
         COALESCE(SUM(e.qty) FILTER (WHERE e.event_type IN ('release', 'cancel', 'amend_release')), 0)::int AS ev_released
  FROM public.so_stock_reservations r
  LEFT JOIN public.stock_reservation_events e ON e.reservation_id = r.id
  WHERE r.deleted_at IS NULL
  GROUP BY r.id, r.consumed_qty, r.released_qty
) h
WHERE h.consumed_qty <> h.ev_consumed OR h.released_qty <> h.ev_released;
