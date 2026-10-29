-- ADR-255 (owner 2026-10-29) — Day Log Working On: direct edits with a kept
-- history, and Super Admin replies.
--
--   daily_report_line_text_revisions — every saved version of an entry's
--     Working On text. Text Rev 0 = first save, +1 per changed save. Written
--     by the API only (entry insert + the direct Working On edit), in the same
--     transaction as the line, under the day header's FOR UPDATE lock.
--   daily_report_line_replies — Super Admin replies on one entry. seen_at =
--     when the entry's owner first opened it since it was sent / last edited.
--
-- PRIVACY: the owner must never see that edits are kept. Both tables are read
-- by the API only (BYPASSRLS). RLS is ON with a deny-all SELECT policy for
-- client roles, and neither table is published to Realtime (CLAUDE.md §22.3).
--
-- Backfill: Text Rev 0 for every live entry (its text before any approved
-- edit), and Text Rev 1 for the approved Working On edits made under the old
-- approval flow (0225), recovered from their EDIT_APPROVED activity text.
-- Re-runnable: every insert skips rows already present.

CREATE TABLE IF NOT EXISTS "daily_report_line_text_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "line_id" uuid NOT NULL REFERENCES "daily_report_lines"("id"),
  "text_rev_no" integer NOT NULL,
  "description" text NOT NULL,
  "saved_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daily_report_line_text_revisions" ADD CONSTRAINT "dl_text_revisions_rev_chk"
    CHECK ("text_rev_no" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dl_text_revisions_line_rev_uq"
  ON "daily_report_line_text_revisions" ("line_id", "text_rev_no")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dl_text_revisions_company_line_idx"
  ON "daily_report_line_text_revisions" ("company_id", "line_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_line_text_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "dl_text_revisions_no_client_read" ON "daily_report_line_text_revisions"
    FOR SELECT TO authenticated
    USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_report_line_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "line_id" uuid NOT NULL REFERENCES "daily_report_lines"("id"),
  "body" text NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "edited_at" timestamptz,
  "seen_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daily_report_line_replies" ADD CONSTRAINT "dl_replies_body_chk"
    CHECK (length(btrim("body")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dl_replies_company_line_idx"
  ON "daily_report_line_replies" ("company_id", "line_id", "sent_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dl_replies_unseen_idx"
  ON "daily_report_line_replies" ("company_id", "line_id")
  WHERE "seen_at" IS NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_line_replies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "dl_replies_no_client_read" ON "daily_report_line_replies"
    FOR SELECT TO authenticated
    USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- Approved Working On edits of the old flow, matched to exactly one live line
-- of the same day by the "<from>–<to> <text>" label the edit logged as its
-- new value. Only edits whose text changed count; one per line.
CREATE TEMP TABLE IF NOT EXISTS "_dl_old_edits" ON COMMIT DROP AS
WITH ev AS (
  SELECT a.id AS ev_id, a.ts, a.entity_id AS day_id,
         substring(a.detail FROM position(': approved the change of ' IN a.detail) + 25) AS body
  FROM public.activity_log a
  WHERE a.entity = 'Day Log' AND a.action = 'EDIT_APPROVED'
    AND position(': approved the change of ' IN a.detail) > 0
), lab AS (
  SELECT l.id AS line_id, l.daily_report_id AS day_id, l.description, l.company_id,
         l.updated_by,
         to_char(l.from_time, 'HH12:MI AM') || '–' || to_char(l.to_time, 'HH12:MI AM')
           || ' ' || l.description AS new_label
  FROM public.daily_report_lines l
  WHERE l.deleted_at IS NULL AND l.from_time IS NOT NULL AND l.to_time IS NOT NULL
), m AS (
  SELECT ev.ev_id, ev.ts, lab.line_id, lab.company_id, lab.updated_by, lab.description AS new_text,
         regexp_replace(left(ev.body, length(ev.body) - length(' to ' || lab.new_label)),
           '^[0-9]{2}:[0-9]{2} [AP]M–([0-9]{2}:[0-9]{2} [AP]M|Open) ', '') AS old_text
  FROM ev JOIN lab ON lab.day_id = ev.day_id
   AND right(ev.body, length(' to ' || lab.new_label)) = ' to ' || lab.new_label
), one AS (
  SELECT m.* FROM m
  WHERE (SELECT count(*) FROM m m2 WHERE m2.ev_id = m.ev_id) = 1
    AND (SELECT count(*) FROM m m3 WHERE m3.line_id = m.line_id) = 1
)
SELECT line_id, company_id, updated_by, ts, old_text, new_text
FROM one WHERE old_text IS DISTINCT FROM new_text AND length(btrim(old_text)) > 0;
--> statement-breakpoint
-- Text Rev 0 for every live entry: the pre-edit text where an old edit is
-- known, else the current text; saved when the entry was first saved.
INSERT INTO public.daily_report_line_text_revisions
  (company_id, line_id, text_rev_no, description, saved_at, created_by, updated_by)
SELECT l.company_id, l.id, 0, COALESCE(e.old_text, l.description), l.created_at, l.created_by, l.created_by
FROM public.daily_report_lines l
LEFT JOIN "_dl_old_edits" e ON e.line_id = l.id
WHERE l.deleted_at IS NULL AND l.from_time IS NOT NULL AND length(btrim(l.description)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.daily_report_line_text_revisions r
    WHERE r.line_id = l.id AND r.deleted_at IS NULL
  );
--> statement-breakpoint
-- Text Rev 1 = the approved new text, saved at the approval.
INSERT INTO public.daily_report_line_text_revisions
  (company_id, line_id, text_rev_no, description, saved_at, created_by, updated_by)
SELECT e.company_id, e.line_id, 1, e.new_text, e.ts, e.updated_by, e.updated_by
FROM "_dl_old_edits" e
WHERE NOT EXISTS (
  SELECT 1 FROM public.daily_report_line_text_revisions r
  WHERE r.line_id = e.line_id AND r.text_rev_no = 1 AND r.deleted_at IS NULL
);
