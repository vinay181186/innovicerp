-- 0260 — ADR-311: a Drawing Rev that holds a drawing file is Under Review.
-- There is no "Send for Review" step any more, so every live Draft Rev that
-- already has a file is moved to under_review (submitted by whoever last
-- touched it), with one activity_log row per moved Rev.
-- Idempotent: a second run finds no Draft-with-file rows and does nothing.
-- Data only — no schema change.

DO $$
DECLARE
  n int;
BEGIN
  WITH moved AS (
    UPDATE public.item_revisions r
       SET release_status = 'under_review',
           submitted_at   = now(),
           submitted_by   = COALESCE(r.updated_by, r.created_by),
           rejected_at = NULL, rejected_by = NULL, reject_reason = NULL,
           approved_at = NULL, approved_by = NULL, file_hash = NULL
     WHERE r.deleted_at IS NULL
       AND r.release_status = 'draft'
       AND NULLIF(btrim(r.drawing_file_path), '') IS NOT NULL
    RETURNING r.id, r.company_id, r.item_id, r.rev, r.submitted_by
  )
  INSERT INTO public.activity_log
    (company_id, user_id, user_name, action, entity, entity_id, ref_id, detail, reason, changes)
  SELECT m.company_id, m.submitted_by, 'system (data fix 0260)', 'SUBMIT', 'ItemRevision',
         m.id, i.code || '/' || m.rev,
         i.code || '/' || m.rev || ' sent for review automatically — it holds a drawing file (ADR-311)',
         'Rev with a drawing file goes straight to Under Review; owner-approved 23-Nov-2026',
         jsonb_build_array(jsonb_build_object(
           'field', 'releaseStatus', 'label', 'Release Status',
           'before', 'Not released', 'after', 'Under Review'))
    FROM moved m
    JOIN public.items i ON i.id = m.item_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0260: % Draft Rev(s) with a file moved to Under Review', n;
END $$;
