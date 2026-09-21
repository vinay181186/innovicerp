-- 0139 — Task Board grows into Inbox / Outbox / My To-Do / All Tasks
-- (ADR-176). The task row gains what the approved board shows and the old
-- one never stored: a task type (assigned vs personal to-do), a start date,
-- a reminder stamp, and who completed it, when, with what remark. Overdue
-- stays DERIVED (due_date < today AND status NOT IN completed/cancelled) —
-- nothing here writes an "overdue" status.
--
-- Priority gains 'urgent' (ahead of 'high'). The existing 'medium' value is
-- kept as stored and simply LABELLED "Normal" on screen, so no row changes.
--
-- Every change to a task is now kept on task_history — an append-only trail
-- in the style of so_line_drawing_revisions (0112) — because the global
-- activity_log has no per-record index and only a free-text sentence.
--
-- Task attachments ride on file_registry like SO / JC / JW documents: one
-- more nullable owner column (task_id), same bucket, same preview/download.
--
-- Live data at the time of writing: PROD 0 tasks, TEST 1 task. Every existing
-- row keeps its values and becomes task_type 'assigned' by default; nothing
-- is reclassified as personal.
--
-- Idempotent — every step is guarded, so a re-run is a no-op. The enum ADD
-- VALUE runs as its own statement (apply-sql runs each breakpoint outside a
-- transaction) and is not referenced later in this file.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'assigned';
--> statement-breakpoint

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS start_date date;
--> statement-breakpoint

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reminder_at timestamptz;
--> statement-breakpoint

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
--> statement-breakpoint

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES users(id);
--> statement-breakpoint

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completion_remark text;
--> statement-breakpoint

-- A personal to-do may have no due date (approved To-Do form: Due Date is
-- optional). Assigned tasks still require one — enforced in the service.
ALTER TABLE public.tasks
  ALTER COLUMN due_date DROP NOT NULL;
--> statement-breakpoint

-- Outbox / My To-Do are keyed on the creator; give them the same partial
-- index the assignee already has.
CREATE INDEX IF NOT EXISTS tasks_company_creator_idx
  ON public.tasks (company_id, created_by)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TYPE public.task_priority ADD VALUE IF NOT EXISTS 'urgent' BEFORE 'high';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_value text,
  to_value text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);
--> statement-breakpoint

-- Several trail rows are written inside ONE transaction (status changed +
-- completed + remark + attachment). now() is the transaction start, so they
-- would all carry the same stamp; clock_timestamp() is the real instant and
-- keeps the timeline in the order it happened.
ALTER TABLE public.task_history
  ALTER COLUMN created_at SET DEFAULT clock_timestamp();
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS task_history_task_created_idx
  ON public.task_history (task_id, created_at);
--> statement-breakpoint

ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS task_history_company_read ON public.task_history;
--> statement-breakpoint

CREATE POLICY task_history_company_read ON public.task_history
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
--> statement-breakpoint

DROP POLICY IF EXISTS task_history_company_insert ON public.task_history;
--> statement-breakpoint

-- Whoever may act on a task (assignee, creator, admin) writes its trail; the
-- per-task rule lives in the service. Here: same company, own row.
CREATE POLICY task_history_company_insert ON public.task_history
  FOR INSERT TO authenticated
  WITH CHECK (company_id = current_company_id() AND created_by = current_user_id());
--> statement-breakpoint

ALTER TABLE public.file_registry
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS file_registry_company_task_idx
  ON public.file_registry (company_id, task_id)
  WHERE deleted_at IS NULL;
