-- 0263 — ADR-323: the Drawing Register has two working statuses.
--
--   unverified — no drawing PDF yet, or a PDF Design has not checked
--   verified   — Design opened the PDF and pressed Verify
--   obsolete   — retired (unchanged)
--
-- The Review / Approve / Release steps (ADR-290) are gone. This file:
--   a. widens the CHECK so BOTH the new and the old words are accepted — the
--      old API keeps running for a few minutes during the release and must not
--      crash on a write. 0264 (next release) removes the legacy words.
--   b. moves every Rev to the new words (approved rows first get Verified On /
--      By from their approval), one activity_log row per moved Rev.
--   c. closes every pending drawing correction (a replace now applies at once).
--   d. copies a Drawing No. onto a Rev that has none, from the live SO / JWSO
--      lines naming that Rev — only when they agree on exactly one value.
-- Idempotent: a second run finds nothing left to move, close or copy.
-- No column or table is dropped.

ALTER TABLE public.item_revisions DROP CONSTRAINT IF EXISTS item_revisions_release_status_check;
--> statement-breakpoint
-- Legacy words (draft … rejected) stay allowed only until 0264.
ALTER TABLE public.item_revisions ADD CONSTRAINT item_revisions_release_status_check
  CHECK (release_status IN ('unverified', 'verified', 'obsolete',
                            'draft', 'under_review', 'approved', 'released', 'superseded', 'rejected'));
--> statement-breakpoint
UPDATE public.item_revisions
   SET released_at = approved_at,
       released_by = approved_by
 WHERE release_status = 'approved'
   AND released_at IS NULL;
--> statement-breakpoint
DO $$
DECLARE
  n int;
BEGIN
  WITH old AS (
    SELECT r.id, r.release_status AS before_status
      FROM public.item_revisions r
     WHERE r.release_status IN ('released', 'superseded', 'approved',
                                'draft', 'under_review', 'rejected')
       FOR UPDATE
  ), moved AS (
    UPDATE public.item_revisions r
       SET release_status = CASE
             WHEN o.before_status IN ('released', 'superseded', 'approved') THEN 'verified'
             ELSE 'unverified'
           END
      FROM old o
     WHERE r.id = o.id
    RETURNING r.id, r.company_id, r.item_id, r.rev, r.release_status AS after_status,
              o.before_status, COALESCE(r.updated_by, r.created_by) AS actor, r.deleted_at
  )
  INSERT INTO public.activity_log
    (company_id, user_id, user_name, action, entity, entity_id, ref_id, detail, reason, changes)
  SELECT m.company_id, m.actor, 'system (data fix 0263)', 'UPDATE', 'ItemRevision',
         m.id, i.code || '/' || m.rev,
         i.code || '/' || m.rev || ' status ' || m.before_status || ' → ' || m.after_status
           || ' (ADR-323 two statuses)',
         'ADR-323 two statuses — Review / Approve / Release replaced by Unverified / Verified; owner-approved 26-Nov-2026',
         jsonb_build_array(jsonb_build_object(
           'field', 'releaseStatus', 'label', 'Drawing Rev Status',
           'before', m.before_status, 'after', m.after_status))
    FROM moved m
    JOIN public.items i ON i.id = m.item_id
   WHERE m.deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0263: % live Rev(s) moved to Unverified / Verified', n;
END $$;
--> statement-breakpoint
UPDATE public.drawing_corrections
   SET status = 'rejected',
       decided_at = now(),
       decision_note = 'Closed by ADR-323 — Replace drawing now applies at once and resets the status.'
 WHERE status = 'pending';
--> statement-breakpoint
WITH line_dno AS (
  SELECT l.item_revision_id, btrim(l.drawing_no) AS dno
    FROM public.sales_order_lines l
   WHERE l.deleted_at IS NULL
     AND l.item_revision_id IS NOT NULL
     AND NULLIF(btrim(l.drawing_no), '') IS NOT NULL
  UNION ALL
  SELECT l.item_revision_id, btrim(l.drawing_no)
    FROM public.job_work_order_lines l
   WHERE l.deleted_at IS NULL
     AND l.item_revision_id IS NOT NULL
     AND NULLIF(btrim(l.drawing_no), '') IS NOT NULL
), one_value AS (
  SELECT item_revision_id, min(dno) AS dno
    FROM line_dno
   GROUP BY item_revision_id
  HAVING count(DISTINCT dno) = 1
)
UPDATE public.item_revisions r
   SET drawing_no = v.dno
  FROM one_value v
 WHERE r.id = v.item_revision_id
   AND r.deleted_at IS NULL
   AND NULLIF(btrim(r.drawing_no), '') IS NULL;
