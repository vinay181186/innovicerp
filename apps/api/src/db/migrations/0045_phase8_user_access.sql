-- ============================================================
-- 0045_phase8_user_access
-- Access Control matrix per user — fine-grained permissions layered on
-- top of the role enum. Mirror of legacy db.userAccess
-- (renderAccessControl HTML L13861; helpers canEdit/canEntry/canView/
-- _hasDeptAccess L13776-13803). See docs/PARITY/access-control.md.
--
-- One row per user with: full_access flag, departments map (sidebar gates),
-- and a forms map of { form_key: {view, entry, edit} } per the 39-key
-- registry in @innovic/shared (35 legacy + 4 new React-only keys).
--
-- DELTA from legacy bug (L1254): legacy gave every NEW user
-- full_access:true. We default new users to full_access:false; only
-- explicit admins get full_access:true. Backfill mirrors this.
--
-- Slice 1 of the build — UI-only enforcement (ADR-035 option A): the
-- matrix is advisory; per-form service-layer gating is a tagged audit
-- task. Existing role-based RLS remains the actual security boundary.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS "user_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "full_access" boolean NOT NULL DEFAULT false,
  "departments" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "forms" jsonb NOT NULL DEFAULT '{}'::jsonb,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

-- One active row per user (per company); upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS "user_access_user_uq"
  ON "user_access" ("user_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_access_company_idx"
  ON "user_access" ("company_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "user_access" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Self-read: every authenticated user can read their own grants so the
-- web shell can hide buttons/sections without a separate /me endpoint.
DO $$ BEGIN
  CREATE POLICY "user_access_self_read" ON "user_access"
    FOR SELECT TO authenticated
    USING (user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Admins can read every row in their company for the matrix list view.
DO $$ BEGIN
  CREATE POLICY "user_access_admin_read" ON "user_access"
    FOR SELECT TO authenticated
    USING (current_user_role() = 'admin' AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Writes: admin-only.
DO $$ BEGIN
  CREATE POLICY "user_access_admin_write" ON "user_access"
    FOR ALL TO authenticated
    USING (current_user_role() = 'admin' AND company_id = current_company_id())
    WITH CHECK (current_user_role() = 'admin' AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Backfill: one row per existing user. Admin users get full_access:true so
-- the new gate doesn't break their existing flow; everyone else starts at
-- full_access:false with empty grants (admin must explicitly grant).
-- WHERE NOT EXISTS makes this safe to re-run (partial unique index above
-- isn't a valid ON CONFLICT target).
INSERT INTO "user_access" ("user_id", "company_id", "full_access", "departments", "forms", "created_by", "updated_by")
SELECT u.id, u.company_id,
       (u.role = 'admin'),
       '{}'::jsonb,
       '{}'::jsonb,
       u.id, u.id
FROM "users" u
WHERE u.company_id IS NOT NULL
  AND u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user_access" ua WHERE ua.user_id = u.id AND ua.deleted_at IS NULL
  );
