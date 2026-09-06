-- 0114 — TPI Master: the third-party inspectors this company works with.
--
-- The TPI entry screen (renderTPI) took Inspector Name and Organization as
-- free text, so the same person arrived as "Mr. Sharma", "Mr sharma" and
-- "R. Sharma" on three different job cards, and no TPI history could be
-- grouped by who actually signed it off. This master is the list those two
-- fields now pick from.
--
-- Shaped as a deliberate sibling of `qc_processes`, the master sitting next to
-- it in the Quality menu: `code` holds the name the user types and reads, is
-- unique per company, and is permanent once created — every TPI log snapshots
-- it, so renaming it would make the master disagree with inspections already
-- signed. Retire an inspector with is_active instead.
--
-- Nothing is written to `op_log`: tpi_inspector stays a text snapshot of the
-- name, not a foreign key, because a QC log records what was true on the day.
-- So this migration only ADDS a table — no existing row is touched and no
-- existing screen changes behaviour until the new code ships.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS tpi_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  organization text,
  contact_no text,
  email text,
  remarks text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS tpi_masters_company_code_uniq
  ON tpi_masters (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS tpi_masters_company_active_idx
  ON tpi_masters (company_id, is_active) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE tpi_masters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tpi_masters_company_read ON tpi_masters;
--> statement-breakpoint

CREATE POLICY tpi_masters_company_read ON tpi_masters
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
--> statement-breakpoint

DROP POLICY IF EXISTS tpi_masters_manager_write ON tpi_masters;
--> statement-breakpoint

CREATE POLICY tpi_masters_manager_write ON tpi_masters
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
