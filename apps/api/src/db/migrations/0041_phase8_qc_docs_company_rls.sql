-- ============================================================
-- 0041_phase8_qc_docs_company_rls
-- Harden the `qc-docs` Storage bucket: replace the permissive
-- "any authenticated user" object policies (migration 0039) with
-- per-company isolation. An object's first path segment is the owning
-- company id (uploadFile writes `${companyId}/<folder>/<file>`), so a
-- caller may only read / insert / delete objects under their OWN
-- company's prefix.
--
-- The Supabase access token used for direct browser->Storage calls does
-- NOT carry a company_id claim (the API derives company from public.users
-- by the JWT `sub` — see apps/api/src/plugins/auth.ts), so
-- current_company_id() is NULL in the Storage context. current_auth_company_id()
-- instead derives the company from public.users by the JWT sub, via
-- SECURITY DEFINER so it bypasses the users RLS that would otherwise need a
-- company context to read even the caller's own row. See ADR-033. Idempotent.
-- ============================================================

-- Company of the authenticated caller, derived from public.users by JWT sub.
-- SECURITY DEFINER: runs as the owner so it can read public.users without the
-- company-scoped users RLS (which is unavailable in the claim-less Storage ctx).
CREATE OR REPLACE FUNCTION public.current_auth_company_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT company_id FROM public.users
    WHERE id = NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
      AND deleted_at IS NULL
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.current_auth_company_id() TO authenticated;
--> statement-breakpoint

-- Drop the permissive 0039 policies (any authenticated user).
DROP POLICY IF EXISTS "qc_docs_authenticated_read" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "qc_docs_authenticated_insert" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "qc_docs_authenticated_delete" ON storage.objects;
--> statement-breakpoint

-- Per-company policies: object's first path segment = caller's company.
DO $$ BEGIN
  CREATE POLICY "qc_docs_company_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'qc-docs'
      AND (storage.foldername(name))[1] = public.current_auth_company_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "qc_docs_company_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'qc-docs'
      AND (storage.foldername(name))[1] = public.current_auth_company_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "qc_docs_company_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'qc-docs'
      AND (storage.foldername(name))[1] = public.current_auth_company_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
