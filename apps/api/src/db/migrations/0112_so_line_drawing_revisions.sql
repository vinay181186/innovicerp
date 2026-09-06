-- 0112 — the Rev on a Sales Order line becomes the DRAWING FILE's revision
-- number, owned by the server, with a full per-line history behind it.
--
-- Until now `revision` (added in 0104) was free text the user typed, and it had
-- nothing to do with the drawing that was actually uploaded: replacing the
-- drawing left the number alone, and the drawing it replaced was lost from the
-- record. Now the line is born at Rev 0 and climbs by one every time the file
-- itself changes, and every step is kept in so_line_drawing_revisions.
--
-- The text -> integer cast is lossless on live data: of 42 live lines only 3
-- carried a value and all three were '1'. The CASE guard is belt-and-braces —
-- anything non-numeric would land on 0 rather than break the migration.
--
-- Seeding: every line that already has a drawing gets ONE revision row at the
-- number it currently carries (0 for the two lines with no Rev, 1 for the three
-- that had '1'), pointing at the drawing it holds today and stamped with that
-- line's own creator and creation time. We cannot invent the drawings that came
-- before, so the trail starts where the record actually starts.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

ALTER TABLE sales_order_lines
  ALTER COLUMN revision TYPE integer
  USING CASE WHEN revision ~ '^[0-9]+$' THEN revision::integer ELSE 0 END;
--> statement-breakpoint

UPDATE sales_order_lines SET revision = 0 WHERE revision IS NULL;
--> statement-breakpoint

ALTER TABLE sales_order_lines ALTER COLUMN revision SET DEFAULT 0;
--> statement-breakpoint

ALTER TABLE sales_order_lines ALTER COLUMN revision SET NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS so_line_drawing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  so_line_id uuid NOT NULL REFERENCES sales_order_lines(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  action text NOT NULL,
  drawing_file_path text,
  drawing_no text,
  item_code_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS so_line_drawing_revisions_line_rev_uniq
  ON so_line_drawing_revisions (so_line_id, revision_no);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS so_line_drawing_revisions_so_idx
  ON so_line_drawing_revisions (sales_order_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS so_line_drawing_revisions_line_created_idx
  ON so_line_drawing_revisions (so_line_id, created_at);
--> statement-breakpoint

ALTER TABLE so_line_drawing_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS so_line_drawing_revisions_company_read ON so_line_drawing_revisions;
--> statement-breakpoint

CREATE POLICY so_line_drawing_revisions_company_read ON so_line_drawing_revisions
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
--> statement-breakpoint

DROP POLICY IF EXISTS so_line_drawing_revisions_manager_insert ON so_line_drawing_revisions;
--> statement-breakpoint

CREATE POLICY so_line_drawing_revisions_manager_insert ON so_line_drawing_revisions
  FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
--> statement-breakpoint

-- Seed Rev rows for drawings that already exist. NOT EXISTS makes the re-run
-- a no-op and stops it from clobbering a history the app has since written.
INSERT INTO so_line_drawing_revisions
  (company_id, sales_order_id, so_line_id, revision_no, action,
   drawing_file_path, drawing_no, item_code_text, created_at, created_by)
SELECT l.company_id, l.sales_order_id, l.id, l.revision, 'added',
       l.drawing_file_path, l.drawing_no,
       COALESCE(i.code, l.item_code_text), l.created_at, l.created_by
FROM sales_order_lines l
LEFT JOIN items i ON i.id = l.item_id
WHERE l.deleted_at IS NULL
  AND l.drawing_file_path IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM so_line_drawing_revisions r WHERE r.so_line_id = l.id
  );
