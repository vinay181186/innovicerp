-- 0101 — An admin picks a DEPARTMENT, not a role.
--
-- ADR-136. The role dropdown asked the wrong question. "Is this person a
-- manager?" is not something anyone in the business knows; "is this person in
-- Design?" is. So the dropdown becomes a department, picking one seeds that
-- department's tier at L3 Editor / Executor, and `users.role` is DERIVED from
-- the access rather than chosen alongside it — which is what stops the two
-- from ever contradicting each other.
--
-- This column stores WHICH department is the main one. It cannot be derived:
-- a main department and a hand-added extra department look identical in the
-- `departments` map, so without this, reopening the box could not tell
-- "Design L3 because that's their department" from "Sales L1 because the
-- admin granted it", and changing the main department would clear the wrong
-- row.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

alter table public.user_access
  add column if not exists main_dept text;
--> statement-breakpoint
-- Backfill: for a row that already holds departments, the main one is the
-- highest tier held (ties broken by the same priority order the dashboard
-- uses to pick a primary department). Rows with no departments, and the L6 /
-- L7 whole-account rows, stay null — neither is departmental.
update public.user_access ua
set main_dept = (
      select e.key
      from jsonb_each_text(ua.departments) e
      where e.value in ('L1', 'L2', 'L3', 'L4', 'L5')
      order by
        array_position(array['L5','L4','L3','L2','L1'], e.value),
        array_position(
          array['qc','purchase','design','sales','store','production','finance','planning'],
          e.key
        )
      limit 1
    ),
    updated_at = now()
where ua.deleted_at is null
  and ua.main_dept is null
  and ua.full_access = false
  and ua.auditor = false
  and ua.departments <> '{}'::jsonb;
