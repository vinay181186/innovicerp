-- ADR-290 — Drawing Rev control, steps 2 + 3: Drawing Register with a release
-- status, the Released-only rule for new work, Item Master fields.
-- Additive only. Nothing is dropped or retyped except two RLS policies (5).
-- Safe to re-run (IF NOT EXISTS / guarded DO blocks / CREATE OR REPLACE).
--
-- 1. item_revisions.release_status (+ who / when of every step). Every row that
--    exists today stays 'unverified' — never guessed. New rows made from a
--    document are inserted 'draft' by lib/item-revision.ts.
-- 2. user_access.drawing_release — "Can release drawings", beside drawing_print
--    (0247). FALSE for everybody; admin / L6 pass without it.
-- 3. items.customer_part_no, items.replacement_item_id.
-- 4. drawing_corrections — a file change asked for on a released Rev, applied
--    only when someone with the release switch approves it. One pending per Rev.
--    RLS: company_all, as stock_out_parts (0247).
-- 5. History is append-only: item_revision_drawings, item_revision_changes,
--    so_line_drawing_revisions refuse UPDATE always, and DELETE from an app
--    request (request.jwt.claims set). A DELETE cascading from a parent row and
--    a maintenance session with no user claims still work. The FOR ALL manager
--    policy on the two item_revision_* history tables becomes INSERT only.
--
-- ROLLBACK (only before any code reads them):
--   DROP TRIGGER item_revision_drawings_append_only ON public.item_revision_drawings;
--   DROP TRIGGER item_revision_changes_append_only ON public.item_revision_changes;
--   DROP TRIGGER so_line_drawing_revisions_append_only ON public.so_line_drawing_revisions;
--   DROP FUNCTION public.refuse_history_change();
--   (re-create the two *_manager_write FOR ALL policies from 0232)
--   DROP TABLE public.drawing_corrections;
--   ALTER TABLE public.items DROP COLUMN replacement_item_id, DROP COLUMN customer_part_no;
--   ALTER TABLE public.user_access DROP COLUMN drawing_release;
--   ALTER TABLE public.item_revisions DROP COLUMN release_status, … (the columns below)

-- ── 1. item_revisions release status ──
ALTER TABLE public.item_revisions
  ADD COLUMN IF NOT EXISTS release_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS change_note text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS obsoleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS obsoleted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS file_hash text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.item_revisions ADD CONSTRAINT item_revisions_release_status_check
    CHECK (release_status IN ('unverified', 'draft', 'under_review', 'approved', 'released',
                              'superseded', 'obsolete', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_revisions_company_status_idx
  ON public.item_revisions (company_id, release_status) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ── 2. user_access.drawing_release ──
ALTER TABLE public.user_access
  ADD COLUMN IF NOT EXISTS drawing_release boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- ── 3. items: customer part no + replacement item ──
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS customer_part_no text,
  ADD COLUMN IF NOT EXISTS replacement_item_id uuid REFERENCES public.items(id) ON DELETE SET NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.items ADD CONSTRAINT items_replacement_not_self_check
    CHECK (replacement_item_id IS NULL OR replacement_item_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS items_company_customer_part_no_idx
  ON public.items (company_id, customer_part_no) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ── 4. drawing_corrections ──
CREATE TABLE IF NOT EXISTS public.drawing_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  item_revision_id uuid NOT NULL REFERENCES public.item_revisions(id),
  drawing_file_path text NOT NULL,
  drawing_no text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT drawing_corrections_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_corrections_one_pending_uniq
  ON public.drawing_corrections (item_revision_id) WHERE status = 'pending' AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_corrections_rev_idx
  ON public.drawing_corrections (item_revision_id, requested_at);
--> statement-breakpoint
DROP TRIGGER IF EXISTS drawing_corrections_set_updated_at ON public.drawing_corrections;
--> statement-breakpoint
CREATE TRIGGER drawing_corrections_set_updated_at
  BEFORE UPDATE ON public.drawing_corrections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.drawing_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY drawing_corrections_company_all ON public.drawing_corrections
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── 5. Append-only history ──
CREATE OR REPLACE FUNCTION public.refuse_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is history — rows are never changed', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  -- DELETE: a cascade from the parent row (pg_trigger_depth() > 1) and a
  -- maintenance session with no user claims may remove rows; an app request may not.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF COALESCE(current_setting('request.jwt.claims', true), '') <> '' THEN
    RAISE EXCEPTION '% is history — rows are never deleted', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS item_revision_drawings_append_only ON public.item_revision_drawings;
--> statement-breakpoint
CREATE TRIGGER item_revision_drawings_append_only
  BEFORE UPDATE OR DELETE ON public.item_revision_drawings
  FOR EACH ROW EXECUTE FUNCTION public.refuse_history_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS item_revision_changes_append_only ON public.item_revision_changes;
--> statement-breakpoint
CREATE TRIGGER item_revision_changes_append_only
  BEFORE UPDATE OR DELETE ON public.item_revision_changes
  FOR EACH ROW EXECUTE FUNCTION public.refuse_history_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS so_line_drawing_revisions_append_only ON public.so_line_drawing_revisions;
--> statement-breakpoint
CREATE TRIGGER so_line_drawing_revisions_append_only
  BEFORE UPDATE OR DELETE ON public.so_line_drawing_revisions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_history_change();
--> statement-breakpoint
DROP POLICY IF EXISTS item_revision_drawings_manager_write ON public.item_revision_drawings;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY item_revision_drawings_manager_insert ON public.item_revision_drawings
    FOR INSERT TO authenticated
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DROP POLICY IF EXISTS item_revision_changes_manager_write ON public.item_revision_changes;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY item_revision_changes_manager_insert ON public.item_revision_changes
    FOR INSERT TO authenticated
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
