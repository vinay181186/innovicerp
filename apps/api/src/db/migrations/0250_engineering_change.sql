-- ADR-291 — Drawing Rev control Step 4–5: Engineering Change (ECR), operation
-- hold, approved Rev substitution, strict Drawing Rev switch.
--
-- 1. engineering_changes — one ECR (IN-ECR-#####). Status / classification /
--    customer approval CHECKs mirror packages/shared/src/schemas/engineering-change.ts.
-- 2. engineering_change_impacts — what the ECR touches (SO line, JWSO line,
--    Job Card, stock of the old Rev) and, per Job Card, what happens to it.
-- 3. engineering_change_approvals — one decision per role (design / qc /
--    production); UNIQUE (ecr_id, role) among live rows makes two people
--    deciding the same role at once lose cleanly (23505 → 409).
-- 4. rev_substitutions — an approved use of Rev A stock where Rev B is asked
--    for, on exactly one SO line / JWSO line / Job Card, with a qty cap.
-- 5. jc_ops hold columns — an operation on hold refuses every writer
--    (lib/jc-op-hold.ts).
-- 6. approval_config.drawing_rev_strict — when on, a MAKE item needs a Rev on
--    every Production Order / Job Card.
--
-- Additive and idempotent. RLS company_all on every new table, as
-- stock_out_parts (0247).
--
-- ROLLBACK (only before any code reads them):
--   ALTER TABLE public.approval_config DROP COLUMN drawing_rev_strict;
--   ALTER TABLE public.jc_ops DROP COLUMN hold_ecr_id, DROP COLUMN held_by,
--     DROP COLUMN held_at, DROP COLUMN hold_reason, DROP COLUMN hold_kind;
--   DROP TABLE public.rev_substitutions;
--   DROP TABLE public.engineering_change_approvals;
--   DROP TABLE public.engineering_change_impacts;
--   DROP TABLE public.engineering_changes;

CREATE TABLE IF NOT EXISTS public.engineering_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  item_id uuid NOT NULL REFERENCES public.items(id),
  from_item_revision_id uuid NOT NULL REFERENCES public.item_revisions(id),
  to_item_revision_id uuid REFERENCES public.item_revisions(id),
  replacement_item_id uuid REFERENCES public.items(id),
  classification text NOT NULL,
  description text NOT NULL,
  customer_approval text NOT NULL DEFAULT 'not_required',
  customer_approval_ref text,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES public.users(id),
  reject_reason text,
  implemented_at timestamptz,
  implemented_by uuid REFERENCES public.users(id),
  closed_at timestamptz,
  closed_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT engineering_changes_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'implemented', 'closed', 'cancelled')),
  CONSTRAINT engineering_changes_classification_check
    CHECK (classification IN ('documentation_only', 'interchangeable', 'non_interchangeable')),
  CONSTRAINT engineering_changes_customer_approval_check
    CHECK (customer_approval IN ('not_required', 'pending', 'received'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS engineering_changes_company_code_uniq
  ON public.engineering_changes (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_changes_company_status_idx
  ON public.engineering_changes (company_id, status) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_changes_item_idx ON public.engineering_changes (item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_changes_from_rev_idx ON public.engineering_changes (from_item_revision_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_changes_to_rev_idx ON public.engineering_changes (to_item_revision_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_changes_replacement_item_idx ON public.engineering_changes (replacement_item_id);
--> statement-breakpoint
ALTER TABLE public.engineering_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY engineering_changes_company_all ON public.engineering_changes
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.engineering_change_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ecr_id uuid NOT NULL REFERENCES public.engineering_changes(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  so_line_id uuid REFERENCES public.sales_order_lines(id),
  jw_line_id uuid REFERENCES public.job_work_order_lines(id),
  job_card_id uuid REFERENCES public.job_cards(id),
  item_revision_id uuid REFERENCES public.item_revisions(id),
  label text NOT NULL,
  qty_done numeric(14, 3) NOT NULL DEFAULT 0,
  qty_wip numeric(14, 3) NOT NULL DEFAULT 0,
  qty_not_started numeric(14, 3) NOT NULL DEFAULT 0,
  qty_stock numeric(14, 3) NOT NULL DEFAULT 0,
  disposition text,
  move_qty numeric(14, 3) NOT NULL DEFAULT 0,
  note text,
  new_production_order_id uuid REFERENCES public.production_orders(id),
  new_job_card_id uuid REFERENCES public.job_cards(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT engineering_change_impacts_doc_type_check
    CHECK (doc_type IN ('so_line', 'jw_line', 'job_card', 'stock')),
  CONSTRAINT engineering_change_impacts_disposition_check
    CHECK (disposition IS NULL OR disposition IN ('keep_old', 'move_new', 'decide_later')),
  CONSTRAINT engineering_change_impacts_move_qty_check
    CHECK (move_qty >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_impacts_ecr_idx
  ON public.engineering_change_impacts (ecr_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_impacts_so_line_idx ON public.engineering_change_impacts (so_line_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_impacts_jw_line_idx ON public.engineering_change_impacts (jw_line_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_impacts_job_card_idx ON public.engineering_change_impacts (job_card_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_impacts_item_revision_idx ON public.engineering_change_impacts (item_revision_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_impacts_new_po_idx ON public.engineering_change_impacts (new_production_order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_impacts_new_jc_idx ON public.engineering_change_impacts (new_job_card_id);
--> statement-breakpoint
ALTER TABLE public.engineering_change_impacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY engineering_change_impacts_company_all ON public.engineering_change_impacts
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.engineering_change_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ecr_id uuid NOT NULL REFERENCES public.engineering_changes(id) ON DELETE CASCADE,
  role text NOT NULL,
  decision text NOT NULL,
  decided_by uuid NOT NULL REFERENCES public.users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT engineering_change_approvals_role_check CHECK (role IN ('design', 'qc', 'production')),
  CONSTRAINT engineering_change_approvals_decision_check CHECK (decision IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS engineering_change_approvals_ecr_role_uniq
  ON public.engineering_change_approvals (ecr_id, role) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engineering_change_approvals_decided_by_idx
  ON public.engineering_change_approvals (decided_by);
--> statement-breakpoint
ALTER TABLE public.engineering_change_approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY engineering_change_approvals_company_all ON public.engineering_change_approvals
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.rev_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  from_item_revision_id uuid NOT NULL REFERENCES public.item_revisions(id),
  to_item_revision_id uuid NOT NULL REFERENCES public.item_revisions(id),
  sales_order_line_id uuid REFERENCES public.sales_order_lines(id),
  jw_line_id uuid REFERENCES public.job_work_order_lines(id),
  job_card_id uuid REFERENCES public.job_cards(id),
  qty_allowed numeric(14, 3) NOT NULL,
  qty_used numeric(14, 3) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  ecr_id uuid REFERENCES public.engineering_changes(id),
  approved_by uuid NOT NULL REFERENCES public.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT rev_substitutions_qty_allowed_check CHECK (qty_allowed > 0),
  CONSTRAINT rev_substitutions_qty_used_check CHECK (qty_used >= 0 AND qty_used <= qty_allowed),
  CONSTRAINT rev_substitutions_one_scope_check CHECK (
    (CASE WHEN sales_order_line_id IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN jw_line_id IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN job_card_id IS NULL THEN 0 ELSE 1 END) = 1
  ),
  CONSTRAINT rev_substitutions_revs_differ_check CHECK (from_item_revision_id <> to_item_revision_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitutions_item_idx
  ON public.rev_substitutions (company_id, item_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitutions_from_rev_idx ON public.rev_substitutions (from_item_revision_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitutions_to_rev_idx ON public.rev_substitutions (to_item_revision_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitutions_so_line_idx ON public.rev_substitutions (sales_order_line_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitutions_jw_line_idx ON public.rev_substitutions (jw_line_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitutions_job_card_idx ON public.rev_substitutions (job_card_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rev_substitutions_ecr_idx ON public.rev_substitutions (ecr_id);
--> statement-breakpoint
ALTER TABLE public.rev_substitutions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY rev_substitutions_company_all ON public.rev_substitutions
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.jc_ops
  ADD COLUMN IF NOT EXISTS hold_kind text,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS hold_ecr_id uuid REFERENCES public.engineering_changes(id);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.jc_ops ADD CONSTRAINT jc_ops_hold_kind_check
    CHECK (hold_kind IS NULL OR hold_kind IN ('ecr', 'rev_not_released', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jc_ops_hold_ecr_idx
  ON public.jc_ops (hold_ecr_id) WHERE hold_ecr_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jc_ops_held_idx
  ON public.jc_ops (company_id) WHERE hold_kind IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.approval_config
  ADD COLUMN IF NOT EXISTS drawing_rev_strict boolean NOT NULL DEFAULT false;
