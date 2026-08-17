-- 0098 — A date/time correction on an op entry WAITS for a manager (ADR-130).
--
-- User decision (2026-08-17): "for update in time update until approval" — the
-- edit does NOT take effect when the operator saves it. The entry keeps its
-- original date/time, every report keeps showing the original date/time, and
-- nothing moves until a manager approves.
--
-- Builds on 0097 / ADR-127, which opened `log_date` + `start_time` for UPDATE
-- and froze every other column with a trigger. 0097 applied the edit
-- immediately; this migration puts a queue in front of it. The apply step is
-- unchanged — it is simply performed by the approver instead of the requester.
--
-- Why a request table rather than a status column on op_log: op_log is
-- append-only (ADR-011 #4) and 0097 already narrowed the writable surface to
-- exactly two columns. Parking a pending value on the row would mean adding
-- more writable columns to the one table the whole system's production numbers
-- are derived from. A separate table keeps op_log's guarantee intact — a
-- pending request cannot touch a single number until it is approved.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'op_log_change_status') then
    create type public.op_log_change_status as enum ('pending', 'approved', 'rejected');
  end if;
end
$$;
--> statement-breakpoint
create table if not exists public.op_log_time_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  op_log_id uuid not null references op_log(id) on delete cascade,
  jc_op_id uuid not null references jc_ops(id) on delete cascade,
  -- What the entry read when the change was asked for. Kept as a snapshot so
  -- the approval screen can show "was → asked for" even if the row is retimed
  -- by an admin in between, and so a stale request is visibly stale.
  prev_log_date date not null,
  prev_start_time time,
  requested_log_date date not null,
  requested_start_time time,
  reason text,
  status public.op_log_change_status not null default 'pending',
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
-- One open request per entry. A second edit before the first is decided would
-- otherwise queue two conflicting values against the same row, and whichever
-- was approved last would silently win.
create unique index if not exists op_log_time_change_pending_uq
  on public.op_log_time_change_requests (op_log_id)
  where status = 'pending' and deleted_at is null;
--> statement-breakpoint
-- The approvals inbox reads exactly this: pending, my company, oldest first.
create index if not exists op_log_time_change_company_status_idx
  on public.op_log_time_change_requests (company_id, status, requested_at)
  where deleted_at is null;
--> statement-breakpoint
create index if not exists op_log_time_change_op_log_idx
  on public.op_log_time_change_requests (op_log_id)
  where deleted_at is null;
--> statement-breakpoint
create or replace trigger op_log_time_change_requests_set_updated_at
  before update on public.op_log_time_change_requests
  for each row execute function public.set_updated_at();
--> statement-breakpoint
alter table public.op_log_time_change_requests enable row level security;
--> statement-breakpoint
drop policy if exists op_log_time_change_company_read on public.op_log_time_change_requests;
--> statement-breakpoint
create policy op_log_time_change_company_read on public.op_log_time_change_requests
  as permissive for select to authenticated
  using (company_id = current_company_id());
--> statement-breakpoint
-- Anyone who may record an entry may ask for its time to be corrected. The
-- per-row split (qc rows need the QC role) is applied in the service, mirroring
-- how the three op_log insert policies divide the same ground.
drop policy if exists op_log_time_change_request_insert on public.op_log_time_change_requests;
--> statement-breakpoint
create policy op_log_time_change_request_insert on public.op_log_time_change_requests
  as permissive for insert to authenticated
  with check (
    company_id = current_company_id()
    and current_user_role() in ('admin', 'manager', 'operator', 'qc')
  );
--> statement-breakpoint
-- Deciding is manager/admin only. This is the whole point of the feature.
drop policy if exists op_log_time_change_decide on public.op_log_time_change_requests;
--> statement-breakpoint
create policy op_log_time_change_decide on public.op_log_time_change_requests
  as permissive for update to authenticated
  using (
    company_id = current_company_id()
    and current_user_role() in ('admin', 'manager')
  )
  with check (company_id = current_company_id());
--> statement-breakpoint
-- The on/off switch, sitting beside po_approval / pr_approval. Default TRUE:
-- the feature was asked for, so it is on from the first deploy. Turning it off
-- restores 0097 behaviour exactly — the edit applies on save.
alter table public.approval_config
  add column if not exists op_entry_edit_approval boolean not null default true;
