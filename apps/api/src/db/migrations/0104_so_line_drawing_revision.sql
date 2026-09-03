-- 0104 — a Sales Order LINE carries an optional drawing revision and an
-- uploaded drawing-document path.
--
-- The SO form already records a free-text drawing number per line. These two
-- columns sit alongside it: `revision` is the drawing revision the customer
-- ordered against (e.g. "Rev C"), and `drawing_file_path` is the storage path
-- of the drawing document uploaded for that line.
--
-- Both nullable: existing lines predate the columns and lines typed without a
-- drawing have neither. No backfill.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS revision text;
--> statement-breakpoint
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS drawing_file_path text;
