-- ============================================================
-- 0001_post_init
-- Helpers (current_company_id, current_user_role, set_updated_at),
-- BEFORE UPDATE triggers per table,
-- auth.users -> public.users provisioning + email-sync triggers,
-- DEFERRABLE FK adjustment for the seed-admin bootstrap transaction.
-- ============================================================

-- ----- Helpers --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'company_id', '')::uuid
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT current_setting('request.jwt.claims', true)::jsonb->>'role'
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
$$;
--> statement-breakpoint

-- ----- BEFORE UPDATE triggers (auto-bump updated_at) ------------------------

CREATE OR REPLACE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER items_set_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- ----- auth.users -> public.users provisioning -----------------------------

-- Fires on every Supabase Auth signup (or admin-invite). Creates a row in
-- public.users with role=viewer and is_active=false. An admin must later
-- assign company_id, role, and flip is_active=true.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    INSERT INTO public.users (id, email, full_name, role, is_active, created_by, updated_by)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'full_name',
      'viewer'::user_role,
      false,
      NEW.id,
      NEW.id
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
--> statement-breakpoint

-- Keep public.users.email in step with auth.users.email.
CREATE OR REPLACE FUNCTION public.sync_auth_user_email() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    UPDATE public.users
       SET email = NEW.email,
           updated_at = now()
     WHERE id = NEW.id;
    RETURN NEW;
  END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_auth_user_email();
--> statement-breakpoint

-- ----- Deferrable FK fix for bootstrap circularity --------------------------

-- companies.created_by/updated_by point at users.id.
-- users.created_by/updated_by point at users.id (self-ref).
-- The seed transaction inserts both the first company and the first user
-- in one atomic block. With INITIALLY DEFERRED, the FK check waits until
-- COMMIT, so the cross-references resolve as a unit.

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE public.companies
  ADD CONSTRAINT companies_created_by_users_id_fk
  FOREIGN KEY (created_by) REFERENCES public.users(id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_updated_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE public.companies
  ADD CONSTRAINT companies_updated_by_users_id_fk
  FOREIGN KEY (updated_by) REFERENCES public.users(id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE public.users
  ADD CONSTRAINT users_created_by_users_id_fk
  FOREIGN KEY (created_by) REFERENCES public.users(id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_updated_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE public.users
  ADD CONSTRAINT users_updated_by_users_id_fk
  FOREIGN KEY (updated_by) REFERENCES public.users(id)
  DEFERRABLE INITIALLY DEFERRED;
