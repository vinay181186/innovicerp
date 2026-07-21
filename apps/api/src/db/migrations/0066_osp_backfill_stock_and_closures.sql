-- 0066 — One-time backfill for the OSP inventory fix (increment #4).
--
-- Repairs the state left by the two OSP bugs now fixed in code:
--   * ADR-067: OSP send debited finished stock (source_type='jw_out'), which
--     — with no BOM — drove on-hand negative once the piece was dispatched.
--   * 0065: outsource ops were marked complete on the 'received' flag regardless
--     of qty, which auto-closed one JC (IN-JC-26-00020) and its SO line early.
--
-- This migration is IDEMPOTENT and DATA-ONLY (no schema change):
--   (1) Stock — post a compensating 'in' ledger row per item equal to the net
--       jw_out debit, so the ledger sum (and the trigger-maintained
--       item_stock_balances) reflect Option A "OSP send never debited stock".
--       Guarded by a marker source_ref so a re-run is a no-op. Uses the ledger
--       (not a direct balance edit) so a future 0020-style reconcile stays
--       correct.
--   (2) Closures — clear closed_at on any JC that is closed but not actually
--       complete under the corrected v_jc_op_status, and reopen the SO/JW
--       line + header that were auto-closed off the back of it. Each UPDATE is
--       self-limiting (once repaired the WHERE no longer matches).
--
-- Superuser connection: disable RLS for the data writes below.
SET row_security = off;
--> statement-breakpoint

-- (1) Reverse erroneous jw_out debits (one 'in' per item = net jw_out).
INSERT INTO public.store_transactions
  (company_id, txn_date, item_id, txn_type, qty, source_type, source_ref,
   stock_before, stock_after, remarks, created_by)
SELECT
  agg.company_id,
  CURRENT_DATE,
  agg.item_id,
  'in',
  agg.net_out,
  'manual_adjust',
  'OSP-BACKFILL-ADR067',
  COALESCE(bal.on_hand_qty, 0),
  COALESCE(bal.on_hand_qty, 0) + agg.net_out,
  'ADR-067 OSP stock-neutral backfill: reverse erroneous jw_out debit',
  agg.created_by
FROM (
  SELECT
    st.company_id,
    st.item_id,
    SUM(CASE WHEN st.txn_type = 'out' THEN st.qty ELSE -st.qty END)::int AS net_out,
    (array_agg(st.created_by))[1] AS created_by
  FROM public.store_transactions st
  WHERE st.source_type = 'jw_out'
    AND st.item_id IS NOT NULL
  GROUP BY st.company_id, st.item_id
  HAVING SUM(CASE WHEN st.txn_type = 'out' THEN st.qty ELSE -st.qty END) > 0
) agg
LEFT JOIN public.item_stock_balances bal
  ON bal.item_id = agg.item_id AND bal.company_id = agg.company_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_transactions x
  WHERE x.item_id = agg.item_id
    AND x.company_id = agg.company_id
    AND x.source_ref = 'OSP-BACKFILL-ADR067'
);
--> statement-breakpoint

-- (2a) Clear premature closed_at on JCs that are closed but not truly complete.
UPDATE public.job_cards jc
SET closed_at = NULL, updated_at = now()
WHERE jc.closed_at IS NOT NULL
  AND jc.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.v_jc_op_status s
    WHERE s.job_card_id = jc.id AND s.computed_status <> 'complete'
  );
--> statement-breakpoint

-- (2b) Reopen SO lines auto-closed by a now-reopened, not-complete JC.
UPDATE public.sales_order_lines sol
SET status = 'open', updated_at = now()
WHERE sol.status = 'closed'
  AND sol.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.job_cards jc
    JOIN public.v_jc_status vjs ON vjs.job_card_id = jc.id
    WHERE jc.source_so_line_id = sol.id
      AND jc.deleted_at IS NULL
      AND jc.closed_at IS NULL
      AND vjs.computed_status <> 'complete'
  );
--> statement-breakpoint

-- (2c) Reopen SO headers that still carry a non-terminal line.
UPDATE public.sales_orders so
SET status = 'open', updated_at = now()
WHERE so.status = 'closed'
  AND so.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.sales_order_lines sol
    WHERE sol.sales_order_id = so.id
      AND sol.deleted_at IS NULL
      AND sol.status NOT IN ('closed', 'cancelled')
  );
--> statement-breakpoint

-- (2d) Symmetric reopen for JW-sourced JCs (no rows expected today; kept for
-- correctness should a JW-sourced JC ever be affected).
UPDATE public.job_work_order_lines jwl
SET status = 'open', updated_at = now()
WHERE jwl.status = 'closed'
  AND jwl.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.job_cards jc
    JOIN public.v_jc_status vjs ON vjs.job_card_id = jc.id
    WHERE jc.source_jw_line_id = jwl.id
      AND jc.deleted_at IS NULL
      AND jc.closed_at IS NULL
      AND vjs.computed_status <> 'complete'
  );
--> statement-breakpoint

-- (2e) Reopen JW headers that still carry a non-terminal line.
UPDATE public.job_work_orders jw
SET status = 'open', updated_at = now()
WHERE jw.status = 'closed'
  AND jw.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.job_work_order_lines jwl
    WHERE jwl.job_work_order_id = jw.id
      AND jwl.deleted_at IS NULL
      AND jwl.status NOT IN ('closed', 'cancelled')
  );
