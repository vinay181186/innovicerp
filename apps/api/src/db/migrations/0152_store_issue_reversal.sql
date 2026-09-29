-- ============================================================
-- 0152_store_issue_reversal.sql  (ADR-189 #7)
--
-- A store issue can be undone only by an OPPOSITE ledger entry, never by
-- editing or deleting the one it made (stock ledger rows are immutable, 0149).
-- store_issues gains who / when / why of the reversal and the 'in' ledger row
-- that put the pieces back. Who / when / why are set together or not at all
-- (CHECK); the ledger-row link is nullable (ON DELETE SET NULL).
-- A reversed issue stays on the Issue Register, marked Reversed.
--
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback: ALTER TABLE public.store_issues DROP CONSTRAINT store_issues_reversal_all_or_none,
--           DROP COLUMN reversed_at, DROP COLUMN reversed_by, DROP COLUMN reversal_reason,
--           DROP COLUMN reversal_store_transaction_id;
-- ============================================================

ALTER TABLE public.store_issues
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_store_transaction_id uuid
    REFERENCES public.store_transactions (id) ON DELETE SET NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.store_issues'::regclass
      AND conname = 'store_issues_reversal_all_or_none'
  ) THEN
    ALTER TABLE public.store_issues
      ADD CONSTRAINT store_issues_reversal_all_or_none CHECK (
        (reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
        OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL
            AND length(btrim(reversal_reason)) > 0)
      );
  END IF;
END $$;
