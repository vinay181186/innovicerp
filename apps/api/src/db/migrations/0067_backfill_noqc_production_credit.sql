-- 0067 — One-time production-credit backfill for pre-existing no-QC JCs (ADR-069).
--
-- Companion to the go-forward "Rule B" fix (a JC without a QC gate now gets a
-- default DIR QC op appended at creation). Existing JCs that were completed
-- before that fix — pure in-house routings with NO QC op and NO outsource op —
-- never posted a finished-stock credit (qc_accept fires only on a QC last op),
-- so dispatching them drove on-hand negative. The observed case is SPACER /
-- IN-JC-26-00007 (3 process ops, produced 60, dispatched 60 → −60).
--
-- Fix: for each such JC, post ONE compensating 'in' ledger row equal to its
-- produced output (the last op's completed_qty) — exactly the credit a terminal
-- DIR QC acceptance would have made. JCs containing a QC op (already gated) or
-- an outsource op (credited on OSP receive via grn_qc — a second credit would
-- DOUBLE-count) are excluded, mirroring needsDefaultQcOp(). Ledger-based (not a
-- direct balance edit) so the trigger-maintained item_stock_balances and future
-- reconciles stay consistent. Idempotent via a per-JC marker source_ref.
--
-- Superuser connection: disable RLS for the write.
SET row_security = off;
--> statement-breakpoint

INSERT INTO public.store_transactions
  (company_id, txn_date, item_id, txn_type, qty, source_type, source_ref,
   stock_before, stock_after, remarks, created_by)
SELECT
  jc.company_id,
  CURRENT_DATE,
  jc.item_id,
  'in',
  lo.produced::int,
  'manual_adjust',
  'DIR-QC-BACKFILL / ' || jc.code,
  COALESCE(bal.on_hand_qty, 0),
  COALESCE(bal.on_hand_qty, 0) + lo.produced::int,
  'ADR-069 backfill: finished-stock credit for pre-existing no-QC JC ' || jc.code,
  jc.created_by
FROM public.job_cards jc
JOIN public.v_jc_status vs ON vs.job_card_id = jc.id
JOIN LATERAL (
  SELECT s.completed_qty AS produced
  FROM public.jc_ops o
  JOIN public.v_jc_op_status s ON s.jc_op_id = o.id
  WHERE o.job_card_id = jc.id AND o.deleted_at IS NULL
  ORDER BY o.op_seq DESC
  LIMIT 1
) lo ON TRUE
LEFT JOIN public.item_stock_balances bal
  ON bal.item_id = jc.item_id AND bal.company_id = jc.company_id
WHERE jc.deleted_at IS NULL
  AND vs.computed_status IN ('complete', 'closed')
  AND lo.produced > 0
  -- Pure in-house, no QC gate, no outsource op (matches needsDefaultQcOp).
  AND NOT EXISTS (
    SELECT 1 FROM public.jc_ops o
    WHERE o.job_card_id = jc.id AND o.deleted_at IS NULL
      AND o.op_type IN ('qc', 'outsource')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.store_transactions x
    WHERE x.source_ref = 'DIR-QC-BACKFILL / ' || jc.code
  );
