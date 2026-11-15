-- ADR-292 — record every use of an approved Rev substitution, so a reversal
-- gives back exactly what was used instead of re-deriving it from the order /
-- Job Card's Rev (which may have changed since: line Rev moved between dispatch
-- and cancel, Job Card Rev moved between issue and return).
--
-- rev_substitution_uses — one row per (substitution, source row) taken:
--   source_type 'dispatch_line'    → customer_dispatch_lines.id
--               'store_issue_line' → store_issue_lines.id
--   qty           what the source used of that substitution;
--   returned_qty  what a Return / Cancel / dispatch edit gave back (≤ qty).
-- Written only by lib/rev-substitution.ts (consumeSubstitution /
-- giveBackSubstitution), the one writer of rev_substitutions.qty_used (§20.1).
--
-- Additive and idempotent. RLS company_all, as stock_out_parts (0247).
--
-- ROLLBACK (only before any code reads it):
--   DROP TABLE public.rev_substitution_uses;

CREATE TABLE IF NOT EXISTS public.rev_substitution_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  substitution_id uuid NOT NULL REFERENCES public.rev_substitutions(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  qty numeric(14, 3) NOT NULL,
  returned_qty numeric(14, 3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT rev_substitution_uses_source_type_check
    CHECK (source_type IN ('dispatch_line', 'store_issue_line')),
  CONSTRAINT rev_substitution_uses_qty_check CHECK (qty > 0),
  CONSTRAINT rev_substitution_uses_returned_check CHECK (returned_qty >= 0 AND returned_qty <= qty)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitution_uses_source_idx
  ON public.rev_substitution_uses (source_type, source_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitution_uses_substitution_idx
  ON public.rev_substitution_uses (substitution_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitution_uses_company_idx
  ON public.rev_substitution_uses (company_id);
--> statement-breakpoint
ALTER TABLE public.rev_substitution_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY rev_substitution_uses_company_all ON public.rev_substitution_uses
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
