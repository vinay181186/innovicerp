-- 0100 — Access Control: (Tier + Department) model, an Approve action, and an Auditor flag.
--
-- Answers the ERP Generic Role Audit Checklist (L1–L7). Before this, a user
-- carried ONE global `users.role` that applied identically in every
-- department, and the access matrix only hid sidebar links. Three gaps in
-- particular could not be expressed at all:
--
--   L2 Data Entry      — no role anywhere is create-but-not-edit
--   L4 Approver        — the matrix had no "approve" action to grant
--   L5 Department Admin— rights were never scoped to a department
--
-- What changes here:
--   1. user_access.auditor           — L7: read every department, write nothing
--   2. user_access.departments       — values become tier keys (L1…L5) instead
--                                      of bare `true`
--   3. user_access.forms             — each entry gains an `approve` flag
--
-- `users.role` is NOT touched. The 176 row-level-security policies keyed to it
-- stay exactly as they are and remain the outer wall: a tier can only ever
-- narrow what the role already allows, never widen it. Making the tier the
-- sole authority is a separate, later migration.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

alter table public.user_access
  add column if not exists auditor boolean not null default false;
--> statement-breakpoint
-- Backfill the dept map: `true` → the tier that matches what the user could
-- actually DO before this migration, so nobody is promoted or demoted by the
-- upgrade itself.
--
--   admin    → L5  (dept admin; they also carry full_access in practice)
--   manager  → L3  (create + edit, no approve — approve was admin-gated)
--   operator → L2  (records entries; L2 is create-only by design)
--   qc       → L3  (records + amends inspections)
--   everyone else → L1 (procurement / dispatch / design / viewer could save
--                       nothing at all, so read-only is the honest reading)
--
-- Values that are ALREADY tier keys are left alone, so re-running is safe.
update public.user_access ua
set departments = coalesce(
      (
        select jsonb_object_agg(e.key, to_jsonb(
          case
            when jsonb_typeof(e.value) = 'string' then e.value #>> '{}'
            when e.value = 'true'::jsonb then
              case u.role
                when 'admin' then 'L5'
                when 'manager' then 'L3'
                when 'operator' then 'L2'
                when 'qc' then 'L3'
                else 'L1'
              end
            else null
          end
        ))
        from jsonb_each(ua.departments) e
        where jsonb_typeof(e.value) = 'string' or e.value = 'true'::jsonb
      ),
      '{}'::jsonb
    ),
    updated_at = now()
from public.users u
where u.id = ua.user_id
  and ua.deleted_at is null
  and ua.departments <> '{}'::jsonb
  -- Only rows that still hold at least one legacy boolean need rewriting.
  and exists (
    select 1 from jsonb_each(ua.departments) e where jsonb_typeof(e.value) = 'boolean'
  );
--> statement-breakpoint
-- Give every stored form entry the new `approve` key, defaulted to false.
-- Nobody gains approval rights from the upgrade; an admin grants them
-- explicitly, either by setting an L4/L5 tier on the department or by
-- ticking Approve on the individual form.
update public.user_access ua
set forms = coalesce(
      (
        select jsonb_object_agg(e.key, e.value || jsonb_build_object('approve', false))
        from jsonb_each(ua.forms) e
        where jsonb_typeof(e.value) = 'object' and not (e.value ? 'approve')
      ) || coalesce(
        (
          select jsonb_object_agg(e.key, e.value)
          from jsonb_each(ua.forms) e
          where jsonb_typeof(e.value) = 'object' and (e.value ? 'approve')
        ),
        '{}'::jsonb
      ),
      ua.forms
    ),
    updated_at = now()
where ua.deleted_at is null
  and ua.forms <> '{}'::jsonb
  and exists (
    select 1 from jsonb_each(ua.forms) e
    where jsonb_typeof(e.value) = 'object' and not (e.value ? 'approve')
  );
