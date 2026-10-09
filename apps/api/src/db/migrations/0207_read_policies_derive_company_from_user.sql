-- ADR-228 — the READ policies on the thirteen live-watched tables stop asking
-- the token which company you are in, and look it up from WHO you are instead.
--
-- THE ROOT PROBLEM, and it is one sentence: the browser's access token does not
-- carry a company_id claim, and every one of these policies is
-- `company_id = current_company_id()`, which reads exactly that claim.
--
-- Two paths reach these tables and only one of them works:
--
--   screen -> API -> database   the API synthesizes the claim per request
--                               (with-user-context.ts) AND connects as
--                               `postgres`, which has rolbypassrls — so RLS is
--                               not even evaluated. Always worked.
--   browser -> database         Realtime and Storage. Nobody supplies the
--                               claim, current_company_id() is NULL,
--                               `company_id = NULL` is never true, and the
--                               subscriber receives ZERO ROWS.
--
-- Measured on TEST before this migration, with a browser-shaped claim set
-- ({sub, role} and no company_id), as role `authenticated`:
--     machines visible .......... 0
--     job_cards visible ......... 0
--     current_company_id() ...... NULL
--     current_auth_company_id() . f77042c6-… (correct)
--
-- That is why three separate features silently did nothing: ADR-226's
-- "someone else is editing this" warning, Op Entry's live updates (which have
-- never delivered an event in their life), and QC document downloads — the
-- third of which somebody already hit and worked around, in
-- 0041_phase8_qc_docs_company_rls.sql, whose header says it outright: "The
-- Supabase access token … does NOT carry a company_id claim … so
-- current_company_id() is NULL in the Storage context."
--
-- So the function this migration switches to is NOT new and NOT untried.
-- `current_auth_company_id()` (ADR-033) is STABLE SECURITY DEFINER with a
-- pinned search_path, derives the company from `public.users` by the token's
-- `sub` — which the browser DOES carry — and skips soft-deleted users. Three
-- Storage policies have used it since 0041. This points twelve more at it.
--
-- WHY THIS IS NEARLY RISK-FREE, stated plainly because "RLS change" sounds
-- alarming: the API bypasses RLS (role `postgres`, rolbypassrls = true), so no
-- existing screen evaluates these policies at all. The only readers affected
-- are the direct-browser paths that currently get nothing. This can turn a
-- zero into rows; it cannot turn working rows into nothing.
--
-- Also: the WRITE policies are deliberately untouched. Writing goes through the
-- API, which bypasses RLS anyway, and a browser has no business writing to
-- these tables directly. One change, one reason.
--
-- TWO THINGS DELIBERATELY NOT DONE, both recorded in ADR-228:
--
-- 1. `user_access_admin_read` keeps `current_company_id()` AND
--    `current_user_role()` — the role claim is missing from the browser token
--    for the same reason the company one is. Fixing it would mean inventing a
--    second lookup function for the role, and Access Control is the one screen
--    that REFUSES rather than merges (ADR-226), so its live warning is worth
--    least. `user_access_self_read` is `user_id = current_user_id()`, and `sub`
--    IS in the browser token, so an admin editing their OWN access row already
--    gets events.
--
-- 2. `current_auth_company_id()` is left exactly as it is, including that it
--    checks `deleted_at IS NULL` but not `is_active`. So a deactivated user
--    whose token has not yet expired could receive row events for up to that
--    token's lifetime. Tightening the function would be strictly safer and
--    would improve Storage too — but it is a live function with three existing
--    dependents, and changing its semantics in the same migration that changes
--    its reach is how you cannot tell which one broke something. Its own
--    change.
--
-- Re-runnable: ALTER POLICY sets the expression, so a second run is a no-op.
-- Reversible one table at a time by putting `current_company_id()` back.

ALTER POLICY goods_receipt_notes_company_read ON public.goods_receipt_notes
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY job_cards_company_read ON public.job_cards
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY delivery_challans_company_read ON public.delivery_challans
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY customer_dispatches_company_read ON public.customer_dispatches
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY nc_register_company_read ON public.nc_register
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY users_company_read ON public.users
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY machines_company_read ON public.machines
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY operators_company_read ON public.operators
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY qc_processes_company_read ON public.qc_processes
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY tpi_masters_company_read ON public.tpi_masters
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY cost_centers_company_read ON public.cost_centers
  USING (company_id = current_auth_company_id());
--> statement-breakpoint
ALTER POLICY saved_reports_company_read ON public.saved_reports
  USING (company_id = current_auth_company_id());
