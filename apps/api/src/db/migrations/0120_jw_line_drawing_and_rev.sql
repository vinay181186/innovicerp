-- 0120 — JWSO lines get a drawing FILE and a drawing REVISION.
--
-- A job-work order line carried only `drawing_no`: the number printed on the
-- customer's drawing, as text. There was nowhere to put the drawing itself and
-- nowhere to record which revision of it the order was placed against — so a
-- Job Card raised from a JWSO line had no drawing to show, while the same card
-- raised from a SALES ORDER line did (sales_order_lines has both columns).
--
-- These two columns are the sales-order line's, copied deliberately, so the two
-- kinds of line are the same shape and one screen can serve both:
--
--   revision           text NOT NULL DEFAULT '0'   (sales_order_lines.revision)
--   drawing_file_path  text                        (storage path in `qc-docs`)
--
-- `revision` is FREE TEXT and independent of the file, exactly as on the SO
-- line since 0119: it is what is printed on the customer's drawing ('A', 'B',
-- '2'), not a counter the server owns. The NOT NULL default backfills every
-- existing line with '0' — the same value an SO line gets when a server path
-- inserts one without naming a revision. "Compulsory" is enforced on the FORM,
-- the only layer that can ask a human.
--
-- `drawing_file_path` holds a path inside the private `qc-docs` bucket, under
-- <company_id>/jw-line-drawings/. Nullable: a line may have no drawing.
--
-- Idempotent — safe to run twice.

ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS revision text NOT NULL DEFAULT '0';

ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS drawing_file_path text;
