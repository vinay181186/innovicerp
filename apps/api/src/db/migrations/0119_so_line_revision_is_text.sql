-- 0119 — the SO line's Rev goes back to being text the user types, and stops
-- being a consequence of the drawing upload.
--
-- WHAT WAS WRONG. 0112 turned `sales_order_lines.revision` into an integer owned
-- by the server: a line was born at Rev 0 and the number climbed by one every
-- time the drawing FILE changed. Two separate facts had been welded together.
-- The revision is the customer's drawing revision -- it arrives on the drawing
-- the customer sends, it is often a letter, and it can change without anyone
-- uploading anything. Making it a side effect of the upload meant a planner
-- could not simply record "this is Rev B", and re-uploading the same drawing
-- invented a revision that does not exist on paper.
--
-- WHAT THIS DOES. `revision` becomes text again, entered on the SO line and
-- compulsory on the form. The upload no longer touches it. Nothing on the server
-- computes it.
--
-- The cast is lossless on today's data, checked before writing this:
--     PROD  45 live lines -- 41 at 0, 4 at 1
--     TEST   2 live lines -- both at 0
-- Every value is a small non-negative integer, so `revision::text` gives '0' and
-- '1' and nothing is rounded, truncated or lost.
--
-- The default stays '0' rather than being dropped. Several server paths insert a
-- line without naming a revision (a BOM cascade, a JW-sourced line), and a NOT
-- NULL column with no default would make those paths fail. The form is where
-- "compulsory" is enforced, which is the layer that can actually ask a human.
--
-- Idempotent -- every step is guarded, so a re-run is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'sales_order_lines'
       AND column_name = 'revision'
       AND data_type = 'integer'
  ) THEN
    -- Drop the default first: '0'::integer cannot survive the type change.
    ALTER TABLE sales_order_lines ALTER COLUMN revision DROP DEFAULT;
    ALTER TABLE sales_order_lines
      ALTER COLUMN revision TYPE text USING revision::text;
    ALTER TABLE sales_order_lines ALTER COLUMN revision SET DEFAULT '0';
    ALTER TABLE sales_order_lines ALTER COLUMN revision SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint

-- A line that somehow holds an empty string reads as a blank box on a field the
-- form now insists on, so it is normalised to '0' -- the same value every line
-- already carried before anyone typed anything.
UPDATE sales_order_lines
   SET revision = '0'
 WHERE deleted_at IS NULL
   AND (revision IS NULL OR btrim(revision) = '');
--> statement-breakpoint

-- so_line_drawing_revisions.revision_no was the line's Rev. It no longer can be:
-- the line's Rev is now free text that a human types, and this column is an
-- integer that must keep climbing by one so the history stays ordered and its
-- (so_line_id, revision_no) unique index keeps working.
--
-- So revision_no keeps its old job under a new meaning -- "the Nth time this
-- line's drawing changed" -- and the line's actual Rev is snapshotted beside it,
-- so a history row can still say which drawing revision it belonged to.
ALTER TABLE so_line_drawing_revisions
  ADD COLUMN IF NOT EXISTS line_revision_text text;
--> statement-breakpoint

-- Backfill is exact, not a guess: until this migration the two WERE the same
-- number, so for every existing history row the line's Rev at that moment is
-- precisely revision_no. Only rows that have not already been filled are touched.
UPDATE so_line_drawing_revisions
   SET line_revision_text = revision_no::text
 WHERE line_revision_text IS NULL;
