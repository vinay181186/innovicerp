-- ============================================================
-- 0232_item_revision_register
-- Item + Drawing Rev register (owner model 2026-10-31) — "ABC/1" = Item ABC at
-- customer Drawing Rev 1 = ONE record holding one drawing. Contract:
-- packages/shared/src/schemas/item-revision.ts.
--
--   1. item_revisions            — the register (one live row per company+item+rev).
--   2. item_revision_drawings    — append-only drawing history (born/adopted/
--                                  copied/replaced/cleared).
--   3. item_revision_changes     — Rev change log of an SO / JWSO line (D1).
--   4. item_revision_id (nullable FK) on route_cards, sales_order_lines,
--      job_work_order_lines, plans, production_orders, job_cards, ml_plan_nodes;
--      child_item_revision_id on bom_master_lines and ml_bom_lines (D2).
--   5. Route Card uniqueness moves from one-per-item to one-per-Item+Rev; cards
--      with no Rev (old cards / Buy items) keep one-per-item.
--   6. BACKFILL (deterministic — no guessing):
--      a. one 'legacy' register row per distinct (company, item, UPPER(TRIM(rev)))
--         over LIVE SO / JWSO lines (line + header not deleted, header and line
--         not cancelled) of MAKE items whose Rev matches the pattern;
--         drawing = the one distinct file those lines share, else none;
--      b. a 'born' history row for each one that got a file;
--      c. every SO / JWSO line (incl. cancelled docs) linked to its matching row;
--      d. plans / job cards copy the Rev from their SO / JWSO line ONLY when
--         the item matches (a BOM child plan carries the parent's line id);
--         production orders copy from their plan; job cards with no source
--         line fall back to their production order (same item only).
--      route_cards.item_revision_id stays NULL — old cards are fixed by hand.
-- The SO/JWSO line `revision` text and `drawing_file_path` stay as display copies.
-- Additive except one index swap (route_cards_company_item_uniq, an index, no
-- data). Idempotent. Runs in ONE transaction (apply-sql default).
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

-- ── 1. item_revisions (the register) ──
CREATE TABLE IF NOT EXISTS "item_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "rev" text NOT NULL,
  "drawing_file_path" text,
  "drawing_no" text,
  "source_type" text NOT NULL,
  "source_ref" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_revisions" ADD CONSTRAINT "item_revisions_rev_check"
    CHECK ("rev" ~ '^[A-Z0-9][A-Z0-9./-]{0,31}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_revisions" ADD CONSTRAINT "item_revisions_source_type_check"
    CHECK ("source_type" IN ('so_line', 'jw_line', 'route_card', 'bom_line', 'ml_bom_line', 'legacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- One live ABC/1 per company — two first-namers at once get a 23505 here.
CREATE UNIQUE INDEX IF NOT EXISTS "item_revisions_company_item_rev_uniq"
  ON "item_revisions" ("company_id", "item_id", "rev") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_revisions_item_idx" ON "item_revisions" ("item_id");
--> statement-breakpoint
-- §20.4: Replace drawing carries expectedUpdatedAt — the column must move on every UPDATE.
DROP TRIGGER IF EXISTS item_revisions_set_updated_at ON public.item_revisions;
--> statement-breakpoint
CREATE TRIGGER item_revisions_set_updated_at
  BEFORE UPDATE ON public.item_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE "item_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "item_revisions_company_read" ON "item_revisions"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "item_revisions_manager_write" ON "item_revisions"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── 2. item_revision_drawings (append-only drawing history) ──
CREATE TABLE IF NOT EXISTS "item_revision_drawings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "item_revision_id" uuid NOT NULL REFERENCES "item_revisions"("id"),
  "action" text NOT NULL,
  "drawing_file_path" text,
  "drawing_no" text,
  "reason" text,
  "source_type" text,
  "source_ref" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_revision_drawings" ADD CONSTRAINT "item_revision_drawings_action_check"
    CHECK ("action" IN ('born', 'adopted', 'copied', 'replaced', 'cleared'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_revision_drawings" ADD CONSTRAINT "item_revision_drawings_source_type_check"
    CHECK ("source_type" IS NULL OR "source_type" IN ('so_line', 'jw_line', 'route_card', 'bom_line', 'ml_bom_line', 'legacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_revision_drawings_rev_created_idx"
  ON "item_revision_drawings" ("item_revision_id", "created_at");
--> statement-breakpoint
ALTER TABLE "item_revision_drawings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "item_revision_drawings_company_read" ON "item_revision_drawings"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "item_revision_drawings_manager_write" ON "item_revision_drawings"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── 3. item_revision_changes (SO / JWSO line Rev change log, D1) ──
CREATE TABLE IF NOT EXISTS "item_revision_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "so_line_id" uuid REFERENCES "sales_order_lines"("id"),
  "jw_line_id" uuid REFERENCES "job_work_order_lines"("id"),
  "from_item_revision_id" uuid REFERENCES "item_revisions"("id"),
  "to_item_revision_id" uuid NOT NULL REFERENCES "item_revisions"("id"),
  "moved_docs" text[] NOT NULL DEFAULT '{}',
  "kept_docs" text[] NOT NULL DEFAULT '{}',
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_revision_changes_so_line_idx" ON "item_revision_changes" ("so_line_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_revision_changes_jw_line_idx" ON "item_revision_changes" ("jw_line_id");
--> statement-breakpoint
ALTER TABLE "item_revision_changes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "item_revision_changes_company_read" ON "item_revision_changes"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "item_revision_changes_manager_write" ON "item_revision_changes"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── 4. Link columns on the documents ──
ALTER TABLE "route_cards" ADD COLUMN IF NOT EXISTS "item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_cards_item_revision_idx" ON "route_cards" ("item_revision_id");
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_lines_item_revision_idx" ON "sales_order_lines" ("item_revision_id");
--> statement-breakpoint
ALTER TABLE "job_work_order_lines" ADD COLUMN IF NOT EXISTS "item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_work_order_lines_item_revision_idx" ON "job_work_order_lines" ("item_revision_id");
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_item_revision_idx" ON "plans" ("item_revision_id");
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_orders_item_revision_idx" ON "production_orders" ("item_revision_id");
--> statement-breakpoint
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_cards_item_revision_idx" ON "job_cards" ("item_revision_id");
--> statement-breakpoint
ALTER TABLE "ml_plan_nodes" ADD COLUMN IF NOT EXISTS "item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ml_plan_nodes_item_revision_idx" ON "ml_plan_nodes" ("item_revision_id");
--> statement-breakpoint
-- D2: the BOM child part's Item + Rev (SHAFT/2).
ALTER TABLE "bom_master_lines" ADD COLUMN IF NOT EXISTS "child_item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_master_lines_child_item_revision_idx" ON "bom_master_lines" ("child_item_revision_id");
--> statement-breakpoint
ALTER TABLE "ml_bom_lines" ADD COLUMN IF NOT EXISTS "child_item_revision_id" uuid REFERENCES "item_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ml_bom_lines_child_item_revision_idx" ON "ml_bom_lines" ("child_item_revision_id");
--> statement-breakpoint

-- ── 5. Route Card: one per Item + Rev; no-Rev cards keep one per item ──
DROP INDEX IF EXISTS "route_cards_company_item_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_cards_company_itemrev_uniq"
  ON "route_cards" ("company_id", "item_revision_id")
  WHERE "deleted_at" IS NULL AND "item_revision_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_cards_company_item_norev_uniq"
  ON "route_cards" ("company_id", "item_id")
  WHERE "deleted_at" IS NULL AND "item_revision_id" IS NULL;
--> statement-breakpoint

-- ── 6a. Backfill the register from live SO / JWSO lines (MAKE items) ──
WITH live AS (
  SELECT l.company_id, l.item_id, UPPER(TRIM(l.revision)) AS rev,
         NULLIF(TRIM(l.drawing_file_path), '') AS path,
         h.code AS doc_code, l.created_at, l.created_by
  FROM public.sales_order_lines l
  JOIN public.sales_orders h ON h.id = l.sales_order_id
  WHERE l.deleted_at IS NULL AND h.deleted_at IS NULL
    AND h.status <> 'cancelled' AND l.status <> 'cancelled'
    AND l.item_id IS NOT NULL AND l.revision IS NOT NULL
  UNION ALL
  SELECT l.company_id, l.item_id, UPPER(TRIM(l.revision)),
         NULLIF(TRIM(l.drawing_file_path), ''),
         h.code, l.created_at, l.created_by
  FROM public.job_work_order_lines l
  JOIN public.job_work_orders h ON h.id = l.job_work_order_id
  WHERE l.deleted_at IS NULL AND h.deleted_at IS NULL
    AND h.status <> 'cancelled' AND l.status <> 'cancelled'
    AND l.item_id IS NOT NULL AND l.revision IS NOT NULL
),
eligible AS (
  SELECT lv.*
  FROM live lv
  JOIN public.items i ON i.id = lv.item_id
  WHERE i.procurement_type = 'make'
    AND lv.rev ~ '^[A-Z0-9][A-Z0-9./-]{0,31}$'
),
firsts AS (
  SELECT DISTINCT ON (company_id, item_id, rev)
         company_id, item_id, rev, doc_code, created_by
  FROM eligible
  ORDER BY company_id, item_id, rev, created_at, doc_code
),
files AS (
  SELECT company_id, item_id, rev,
         CASE WHEN COUNT(DISTINCT path) = 1 THEN MIN(path) END AS path
  FROM eligible
  GROUP BY company_id, item_id, rev
)
INSERT INTO public.item_revisions
  (company_id, item_id, rev, drawing_file_path, source_type, source_ref, created_by, updated_by)
SELECT f.company_id, f.item_id, f.rev, fl.path, 'legacy', f.doc_code, f.created_by, f.created_by
FROM firsts f
JOIN files fl USING (company_id, item_id, rev)
WHERE NOT EXISTS (
  SELECT 1 FROM public.item_revisions r
  WHERE r.company_id = f.company_id AND r.item_id = f.item_id AND r.rev = f.rev AND r.deleted_at IS NULL
);
--> statement-breakpoint

-- ── 6b. 'born' history row for each legacy record that got a file ──
INSERT INTO public.item_revision_drawings
  (company_id, item_revision_id, action, drawing_file_path, reason, source_type, source_ref, created_by, updated_by, created_at)
SELECT r.company_id, r.id, 'born', r.drawing_file_path, 'Backfill 0232 from SO / JWSO lines',
       'legacy', r.source_ref, r.created_by, r.created_by, r.created_at
FROM public.item_revisions r
WHERE r.source_type = 'legacy' AND r.deleted_at IS NULL AND r.drawing_file_path IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.item_revision_drawings d WHERE d.item_revision_id = r.id);
--> statement-breakpoint

-- ── 6c. Link every SO / JWSO line (incl. cancelled docs) to its record ──
UPDATE public.sales_order_lines l
   SET item_revision_id = r.id
  FROM public.item_revisions r
 WHERE l.item_revision_id IS NULL
   AND r.deleted_at IS NULL
   AND r.company_id = l.company_id AND r.item_id = l.item_id
   AND r.rev = UPPER(TRIM(l.revision));
--> statement-breakpoint
UPDATE public.job_work_order_lines l
   SET item_revision_id = r.id
  FROM public.item_revisions r
 WHERE l.item_revision_id IS NULL
   AND r.deleted_at IS NULL
   AND r.company_id = l.company_id AND r.item_id = l.item_id
   AND r.rev = UPPER(TRIM(l.revision));
--> statement-breakpoint

-- ── 6d. Plans / PROs / JCs inherit — same item only ──
UPDATE public.plans p
   SET item_revision_id = l.item_revision_id
  FROM public.sales_order_lines l
 WHERE p.item_revision_id IS NULL
   AND l.id = p.so_line_id AND l.item_revision_id IS NOT NULL
   AND l.item_id = p.item_id AND l.company_id = p.company_id;
--> statement-breakpoint
UPDATE public.plans p
   SET item_revision_id = l.item_revision_id
  FROM public.job_work_order_lines l
 WHERE p.item_revision_id IS NULL
   AND l.id = p.jw_line_id AND l.item_revision_id IS NOT NULL
   AND l.item_id = p.item_id AND l.company_id = p.company_id;
--> statement-breakpoint
UPDATE public.production_orders po
   SET item_revision_id = p.item_revision_id
  FROM public.plans p
 WHERE po.item_revision_id IS NULL
   AND p.id = po.plan_id AND p.item_revision_id IS NOT NULL
   AND p.item_id = po.item_id AND p.company_id = po.company_id;
--> statement-breakpoint
UPDATE public.job_cards j
   SET item_revision_id = l.item_revision_id
  FROM public.sales_order_lines l
 WHERE j.item_revision_id IS NULL
   AND l.id = j.source_so_line_id AND l.item_revision_id IS NOT NULL
   AND l.item_id = j.item_id AND l.company_id = j.company_id;
--> statement-breakpoint
UPDATE public.job_cards j
   SET item_revision_id = l.item_revision_id
  FROM public.job_work_order_lines l
 WHERE j.item_revision_id IS NULL
   AND l.id = j.source_jw_line_id AND l.item_revision_id IS NOT NULL
   AND l.item_id = j.item_id AND l.company_id = j.company_id;
--> statement-breakpoint
UPDATE public.job_cards j
   SET item_revision_id = po.item_revision_id
  FROM public.production_orders po
 WHERE j.item_revision_id IS NULL
   AND po.id = j.production_order_id AND po.item_revision_id IS NOT NULL
   AND po.item_id = j.item_id AND po.company_id = j.company_id;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Loses every Item + Rev record, drawing history and Rev change log.
--
-- DROP INDEX IF EXISTS "route_cards_company_item_norev_uniq";
-- DROP INDEX IF EXISTS "route_cards_company_itemrev_uniq";
-- CREATE UNIQUE INDEX "route_cards_company_item_uniq" ON "route_cards" ("company_id", "item_id") WHERE "deleted_at" IS NULL;
--   (fails if two live cards of one item exist by then — remove one first)
-- ALTER TABLE "ml_bom_lines" DROP COLUMN IF EXISTS "child_item_revision_id";
-- ALTER TABLE "bom_master_lines" DROP COLUMN IF EXISTS "child_item_revision_id";
-- ALTER TABLE "ml_plan_nodes" DROP COLUMN IF EXISTS "item_revision_id";
-- ALTER TABLE "job_cards" DROP COLUMN IF EXISTS "item_revision_id";
-- ALTER TABLE "production_orders" DROP COLUMN IF EXISTS "item_revision_id";
-- ALTER TABLE "plans" DROP COLUMN IF EXISTS "item_revision_id";
-- ALTER TABLE "job_work_order_lines" DROP COLUMN IF EXISTS "item_revision_id";
-- ALTER TABLE "sales_order_lines" DROP COLUMN IF EXISTS "item_revision_id";
-- ALTER TABLE "route_cards" DROP COLUMN IF EXISTS "item_revision_id";
-- DROP TABLE IF EXISTS "item_revision_changes";
-- DROP TABLE IF EXISTS "item_revision_drawings";
-- DROP TABLE IF EXISTS "item_revisions";
-- ------------------------------------------------------------
