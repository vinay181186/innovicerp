-- ADR-228 — the company and the app role travel IN THE TOKEN, so every layer
-- asks one question and gets one answer.
--
-- THE ROOT PROBLEM: "which company is this person?" had three different
-- answers.
--   the API            synthesizes a company_id claim on every request
--                      (with-user-context.ts) and connects as `postgres`, which
--                      has rolbypassrls, so RLS is never even evaluated
--   file storage       uses a special workaround function,
--                      current_auth_company_id() (0041 / ADR-033), because the
--                      normal one does not work there
--   the browser        has NOTHING — and this is why three features silently
--                      did nothing
--
-- Proven on TEST by decoding a real access token minted by this project:
--   company_id present? .... False
--   role claim ............. "authenticated"   (Supabase's own)
--   app_metadata ........... {"provider":"email","providers":["email"]}
--
-- So every policy reading `company_id = current_company_id()` got NULL for a
-- browser, `company_id = NULL` is never true, and the browser received ZERO
-- ROWS. That killed ADR-226's "someone else is editing this" warning, killed Op
-- Entry's live updates (which have never delivered one event in their life —
-- the 30-second poll beside them has been doing all the work), and was already
-- hit once for QC document downloads, which is why the Storage workaround
-- exists at all. 0041's own header says it outright.
--
-- WHY app_metadata AND NOT A CUSTOM ACCESS TOKEN HOOK. A hook is the textbook
-- answer, and it is the one with an outage for a failure mode: Supabase CALLS
-- the hook to mint every token, so a hook that throws means nobody can log in.
-- `app_metadata` is data Supabase ALREADY copies into every token — nothing
-- runs, so nothing can throw. Worst case is a token without the field, which is
-- exactly today's behaviour. Proven on TEST before this migration was written:
-- writing company_id + app_role into one user's app_metadata and minting a
-- fresh token produced
--   {"app_role":"admin","company_id":"f77042c6-…","provider":"email","providers":["email"]}
-- with the top-level `role` still "authenticated".
--
-- THE TRAP THAT MADE THIS NEED A PLAN: the app role CANNOT live in the `role`
-- claim. That name belongs to Supabase, and Postgres reads it to decide which
-- DATABASE role to assume — writing "admin" there would make it try to become a
-- database role called `admin`, which does not exist, and every browser request
-- would fail. Hence `app_role`, and hence current_user_role() changing too.
-- Note what that means for today: in a browser context current_user_role()
-- returns "authenticated", so every policy testing it against 'admin' has
-- always been false for the browser.
--
-- WHY app_metadata AND NOT user_metadata — THE SECURITY HINGE, AND IT WAS
-- ATTACKED RATHER THAN ASSUMED. These functions read `app_metadata`, which only
-- the service role may write. Two attempts with a REAL user token on TEST:
--
--   PUT /auth/v1/user  {"app_metadata":{...}}
--     -> REFUSED: "Updating app_metadata requires admin privileges"
--
--   PUT /auth/v1/user  {"data":{"company_id":"1111…","app_role":"admin"}}
--     -> accepted, and it landed in USER_metadata carrying the forged company,
--        while app_metadata kept the real one.
--
-- So a user CAN write any company they like into `user_metadata`. Had either
-- function read that object, every user could claim any company — a complete
-- privilege escalation. One word apart. Anyone editing these two functions:
-- `app_metadata` is server-only, `user_metadata` is the user's own, and the
-- difference is the whole access-control boundary.
--
-- The remaining trust boundary is the signature. The company is now asserted BY
-- THE TOKEN, so a token is trusted because Supabase signed it — the standard
-- JWT boundary, and the same one the login itself already rests on. Verified
-- that a token whose `sub` is not a real user but whose app_metadata names a
-- real company WOULD be admitted; that is only reachable by someone holding the
-- project's signing secret or service-role key, at which point nothing else
-- matters either. Note the deliberate contrast with
-- `current_auth_company_id()`, which derives the company from `public.users` and
-- is therefore unforgeable but cannot answer the ROLE question at all — which is
-- why it could never fix `user_access_admin_read`, and this does.
--
-- WHAT THIS DOES NOT TOUCH: no RLS policy changes at all. The twelve read
-- policies stay exactly as written; only what FILLS the claim changes. And the
-- API path is unaffected — it keeps synthesizing a top-level claim, which both
-- functions still read FIRST.

-- 1. Backfill. `||` MERGES, so provider / providers / anything else already on
--    the row survives. Soft-deleted users are skipped: a deleted login should
--    not gain a company. Idempotent — re-running writes the same values.
UPDATE auth.users a
SET raw_app_meta_data =
      COALESCE(a.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('company_id', u.company_id::text, 'app_role', u.role::text)
FROM public.users u
WHERE u.id = a.id
  AND u.deleted_at IS NULL
  AND u.company_id IS NOT NULL;
--> statement-breakpoint

-- 2. The company. Reads the API's top-level claim FIRST so that path is
--    byte-identical to before, then falls back to the token's app_metadata.
--    Keeps the `::jsonb` shape of the original, including that an empty claims
--    string raises rather than returning NULL — that is pre-existing behaviour
--    on both of these functions (checked side by side), and it fails CLOSED.
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'company_id', ''),
      NULLIF(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'company_id', '')
    )::uuid
$function$;
--> statement-breakpoint

-- 3. The app role. Same order, same reason. The fallback matters: a user who
--    has not been backfilled (or whose token predates it) resolves to the
--    top-level `role`, which for a browser is "authenticated" — i.e. exactly
--    what they get today. No regression while tokens turn over.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $function$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'app_role', ''),
      NULLIF(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'app_role', ''),
      current_setting('request.jwt.claims', true)::jsonb ->> 'role'
    )
$function$;
