-- 0097 — An op entry's DATE and TIME can be corrected. Its QTY still cannot.
--
-- User request (2026-08-17): "after click on Start the op entry must be
-- editable … i want date and time only user can edit. not qty."
--
-- Why this needs a migration at all: op_log has been append-only since 0004.
-- There is no UPDATE policy on the table, no updated_at/updated_by columns, and
-- ADR-011 #4 says corrections happen via a reversing entry. But the escape
-- hatch the ADR names does not exist either — check constraint
-- op_log_qty_nonneg forbids a negative-qty row — so today a mistyped date or
-- time is uncorrectable by any route in the system. The operator's only
-- recourse is to ask an admin to touch the database by hand.
--
-- The amendment (ADR-127) is deliberately the narrowest one that fixes it:
--   editable      log_date, start_time          — WHEN the work happened
--   still frozen  qty, reject_qty, log_type, machine, operator, everything else
--
-- Quantity remains immutable, so every number that 0095 made trustworthy —
-- v_op_machine_output, v_jc_op_status.completed_qty, the Daily Report — is
-- untouched by an edit. Only the timestamp moves, and it moves with an audit
-- trail: timing_edited_at / timing_edited_by on the row, plus an
-- OP_LOG_TIME_EDIT activity_log entry carrying the before → after values.
--
-- The column restriction is enforced by a TRIGGER, not by the RLS policy.
-- Postgres RLS cannot express "these columns only", and column-level GRANTs do
-- not apply to the owner role the API connects as. The trigger applies to every
-- writer including a psql session, which is exactly the guarantee ADR-011 #4
-- was protecting.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

alter table op_log add column if not exists timing_edited_at timestamptz;
--> statement-breakpoint
alter table op_log add column if not exists timing_edited_by uuid references users(id);
--> statement-breakpoint
-- Compare the two row images with the four permitted columns stripped out. If
-- anything at all remains different, some other column moved and the UPDATE is
-- refused. Written this way so it cannot fall out of date: a column added to
-- op_log next year is frozen by default, with no edit to this function.
create or replace function public.op_log_timing_only_update()
returns trigger
language plpgsql
as $fn$
begin
  if (to_jsonb(new) - 'log_date' - 'start_time' - 'timing_edited_at' - 'timing_edited_by')
     is distinct from
     (to_jsonb(old) - 'log_date' - 'start_time' - 'timing_edited_at' - 'timing_edited_by')
  then
    raise exception
      'op_log is append-only: only log_date and start_time may be updated (ADR-127)'
      using errcode = '23514';
  end if;
  new.timing_edited_at := now();
  return new;
end;
$fn$;
--> statement-breakpoint
drop trigger if exists op_log_timing_only_update on public.op_log;
--> statement-breakpoint
create trigger op_log_timing_only_update
  before update on public.op_log
  for each row execute function public.op_log_timing_only_update();
--> statement-breakpoint
-- Who may correct a timestamp = who may record one in the first place. The
-- three insert policies below this one (0004 lines 373-375) gate operator to
-- start/complete, qc to qc rows, manager/admin to anything; the service layer
-- applies the same per-row split before it issues the UPDATE. This policy is
-- the company/role floor — the trigger above is what keeps it to two columns.
drop policy if exists op_log_timing_update on public.op_log;
--> statement-breakpoint
create policy op_log_timing_update on public.op_log
  as permissive for update to authenticated
  using (
    company_id = current_company_id()
    and current_user_role() in ('admin', 'manager', 'operator', 'qc')
  )
  with check (company_id = current_company_id());
