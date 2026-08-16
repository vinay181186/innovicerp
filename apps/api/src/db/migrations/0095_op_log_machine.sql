-- 0095 — A production log entry records the MACHINE that made the pieces.
--
-- User request (2026-08-16, traced on IN-JC-26-00093): "half parts are machined,
-- other half pending, I want to change machine — both the records must be
-- maintained, qty wise machine used."
--
-- Today that is impossible, and the reason is where the machine is stored:
--
--   jc_ops       ONE machine_id per operation        — no qty
--   op_log       MANY rows, each with qty            — NO machine column
--
-- So every machine-wise number in the system (Daily Report, SO Costing
-- machine-time, Op Log viewer) has to attribute qty through the operation's
-- CURRENT machine:
--     daily-report/service.ts:51   LEFT JOIN machines m ON m.id = op.machine_id
--     so-costing/service.ts:208    LEFT JOIN machines m ON m.id = o.machine_id
--     op-log-viewer/service.ts:72  .leftJoin(machines, eq(machines.id, jcOps.machineId))
--
-- Change the op's machine and all past production silently re-attributes to the
-- new machine; the first machine's output disappears from every report. That is
-- exactly why changeJcOpMachine (jc-ops/service.ts:171-176) refuses any op that
-- is not `waiting`/`available` — the lock is a bandage over this defect, not a
-- business rule. (running_ops does keep machine + start/stop per session, but it
-- carries no qty and has no key joining it to an op_log row, so the two cannot
-- be correlated after the fact either.)
--
-- Fix: put the machine on the QTY, not on the operation. Each op_log row carries
-- the machine it was produced on, stamped at log time. CNC-01's 50 and CNC-02's
-- 50 then sit side by side permanently, and changing the op's machine becomes a
-- forward-looking routing decision that rewrites no history.
--
-- machine_code_text mirrors the jc_ops FK-plus-text-fallback pattern (ADR-012
-- #10): plan/route-sourced ops legitimately carry the machine as text only.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

alter table op_log add column if not exists machine_id uuid references machines(id);
--> statement-breakpoint
alter table op_log add column if not exists machine_code_text text;
--> statement-breakpoint
create index if not exists op_log_machine_date_idx
  on op_log (machine_id, log_date)
  where machine_id is not null;
--> statement-breakpoint
-- Backfill 1 — resolved FK. The op's current machine is the best (and only)
-- available truth for rows logged before this migration. Correct for every op
-- whose machine was never changed, which is all of them: the lock above made a
-- change impossible once work was logged, and the one path that bypassed it
-- (production-schedule/service.ts:273) is closed in the same change set.
-- QC ops are excluded: they carry the literal machine_code_text 'QC' with a null
-- FK (ISSUE-010), which is a type label, not a machine.
update op_log l
set machine_id = o.machine_id,
    machine_code_text = coalesce(m.code, o.machine_code_text)
from jc_ops o
left join machines m on m.id = o.machine_id and m.deleted_at is null
where l.jc_op_id = o.id
  and l.machine_id is null
  and o.machine_id is not null
  and o.op_type <> 'qc';
--> statement-breakpoint
-- Backfill 2 — text-only ops (no FK ever resolved). Keeps the snapshot honest
-- rather than leaving the row with no machine at all.
update op_log l
set machine_code_text = o.machine_code_text
from jc_ops o
where l.jc_op_id = o.id
  and l.machine_id is null
  and l.machine_code_text is null
  and o.machine_id is null
  and o.machine_code_text is not null
  and o.machine_code_text <> 'QC'
  and o.op_type <> 'qc';
--> statement-breakpoint
-- ─── v_op_machine_output ───────────────────────────────────────────────────
-- THE machine-wise production record: one row per (operation × machine), so the
-- JC screen and the Machine Output report read the same numbers and can never
-- disagree. Only real production counts — 'start' markers carry qty 0 and 'qc'
-- rows are inspection, not machining.
--
-- COALESCE(l.machine_id, o.machine_id) keeps pre-backfill and text-only rows
-- attributed rather than dropping them into an unlabelled bucket.
--
-- RLS-respecting for the same reason as v_jc_op_status (0006 header): it reads
-- base tables that have RLS enabled, so the company_isolation policy applies
-- when an authenticated session queries it.
create or replace view public.v_op_machine_output as
select
  l.company_id,
  l.jc_op_id,
  o.job_card_id,
  o.op_seq,
  coalesce(l.machine_id, o.machine_id)                                  as machine_id,
  coalesce(m.code, l.machine_code_text, o.machine_code_text, '—')       as machine_code,
  m.name                                                                as machine_name,
  sum(l.qty)::integer                                                   as completed_qty,
  sum(l.reject_qty)::integer                                            as reject_qty,
  count(*)::integer                                                     as entry_count,
  min(l.log_date)                                                       as first_log_date,
  max(l.log_date)                                                       as last_log_date
from public.op_log l
join public.jc_ops o on o.id = l.jc_op_id and o.deleted_at is null
left join public.machines m
  on m.id = coalesce(l.machine_id, o.machine_id) and m.deleted_at is null
where l.log_type = 'complete'
  and l.qty > 0
group by
  l.company_id,
  l.jc_op_id,
  o.job_card_id,
  o.op_seq,
  coalesce(l.machine_id, o.machine_id),
  coalesce(m.code, l.machine_code_text, o.machine_code_text, '—'),
  m.name;
