-- ============================================================
-- 0179_op_log_reversal.sql  (ADR-197 step 2 — "Correct a wrong entry", req. 3.2)
--
-- A wrong production / QC entry is corrected by an OPPOSITE entry. The
-- original op_log row stays exactly as written (0097 trigger still freezes
-- every column but the timing ones); a NEW row is added that names the row it
-- cancels (reversal_of_id), carries the reason, and holds the NEGATIVE of the
-- original qty / reject_qty with the SAME log_type.
--
-- Why negative qty and not a positive row + flag: every reader of op_log sums
-- qty / reject_qty by log_type (v_jc_op_status op_log_rollup, v_osp_wip
-- in_house, the Daily Report, the JC feed, reports). A negative row nets out in
-- all of them with no change; a positive "reversal" row would be ADDED by any
-- reader that forgot to filter the flag — the unsafe failure. The only reader
-- that filtered qty > 0 is v_op_machine_output, fixed below.
--
--   1. op_log.reversal_of_id (FK to op_log) + op_log.reversal_reason.
--   2. One reversal per entry (partial unique index).
--   3. op_log_qty_nonneg / op_log_reject_qty_nonneg: a normal row stays >= 0;
--      a reversal row must be <= 0 and must carry a reason.
--   4. v_op_machine_output nets reversal rows (same column list).
--
-- v_jc_op_status needs NO change (sums already net). Additive + idempotent;
-- existing rows all satisfy the new checks (reversal_of_id NULL, qty >= 0).
-- Apply to BOTH the test and the production database.
-- ROLLBACK: drop the two columns after re-adding the 0004 checks, re-run the
-- 0095 view body.
-- ============================================================

ALTER TABLE public.op_log
  ADD COLUMN IF NOT EXISTS reversal_of_id uuid REFERENCES public.op_log(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS op_log_reversal_of_uq
  ON public.op_log (reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.op_log DROP CONSTRAINT IF EXISTS op_log_qty_nonneg;
--> statement-breakpoint
ALTER TABLE public.op_log
  ADD CONSTRAINT op_log_qty_nonneg CHECK (
    (reversal_of_id IS NULL AND qty >= 0) OR (reversal_of_id IS NOT NULL AND qty <= 0)
  );
--> statement-breakpoint
ALTER TABLE public.op_log DROP CONSTRAINT IF EXISTS op_log_reject_qty_nonneg;
--> statement-breakpoint
ALTER TABLE public.op_log
  ADD CONSTRAINT op_log_reject_qty_nonneg CHECK (
    (reversal_of_id IS NULL AND reject_qty >= 0)
    OR (reversal_of_id IS NOT NULL AND reject_qty <= 0)
  );
--> statement-breakpoint
ALTER TABLE public.op_log DROP CONSTRAINT IF EXISTS op_log_reversal_reason_required;
--> statement-breakpoint
ALTER TABLE public.op_log
  ADD CONSTRAINT op_log_reversal_reason_required CHECK (
    reversal_of_id IS NULL OR length(btrim(COALESCE(reversal_reason, ''))) > 0
  );
--> statement-breakpoint
-- v_op_machine_output (0095) filtered `qty > 0`, which would keep a reversed
-- entry's pieces on the machine for good. Now: every complete row with a qty
-- (reversals included, so the sum nets), an entry count that subtracts the
-- reversal, and a machine row that nets to nothing drops out.
CREATE OR REPLACE VIEW public.v_op_machine_output AS
SELECT
  l.company_id,
  l.jc_op_id,
  o.job_card_id,
  o.op_seq,
  COALESCE(l.machine_id, o.machine_id)                                  AS machine_id,
  COALESCE(m.code, l.machine_code_text, o.machine_code_text, '—')       AS machine_code,
  m.name                                                                AS machine_name,
  SUM(l.qty)::integer                                                   AS completed_qty,
  SUM(l.reject_qty)::integer                                            AS reject_qty,
  SUM(CASE WHEN l.reversal_of_id IS NULL THEN 1 ELSE -1 END)::integer   AS entry_count,
  MIN(l.log_date)                                                       AS first_log_date,
  MAX(l.log_date)                                                       AS last_log_date
FROM public.op_log l
JOIN public.jc_ops o ON o.id = l.jc_op_id AND o.deleted_at IS NULL
LEFT JOIN public.machines m
  ON m.id = COALESCE(l.machine_id, o.machine_id) AND m.deleted_at IS NULL
WHERE l.log_type = 'complete'
  AND l.qty <> 0
GROUP BY
  l.company_id,
  l.jc_op_id,
  o.job_card_id,
  o.op_seq,
  COALESCE(l.machine_id, o.machine_id),
  COALESCE(m.code, l.machine_code_text, o.machine_code_text, '—'),
  m.name
HAVING SUM(l.qty) <> 0;
