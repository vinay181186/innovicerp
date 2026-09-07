-- 0116 — Machine Group master, plus product_code on machines.
--
-- The Machine Master screen gains a second tab where machine groups (VMC, CNC,
-- Lathe) are maintained, and the machine form gains a picker that reads from it,
-- so machines can finally be grouped on something reliable rather than on the
-- free-text `machine_type` where the same group arrives as "VMC", "vmc" and
-- "V.M.C".
--
-- Shaped as a deliberate sibling of `material_grades` / `tpi_masters` — the two
-- masters either side of it in the menus: `code` is what the user types and
-- reads, unique per company, and permanent once created. Retire a group with
-- is_active rather than renaming it.
--
-- machine_type is deliberately KEPT and stays a normal user-entered field. The
-- group is an ADDITIONAL field beside it, not a replacement — the user asked for
-- Type to remain on the form. Six other modules read the column (alerts AL-013,
-- job-queue, machine-loading, production-schedule, shop-floor), so nothing about
-- their behaviour changes either.
--
-- The backfill below therefore seeds the new master from the Type values already
-- in use, purely so the picker opens with the groups this company actually runs
-- instead of empty. The two fields are independent from then on.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS machine_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS machine_groups_company_code_uniq
  ON machine_groups (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS machine_groups_company_active_idx
  ON machine_groups (company_id, is_active) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE machine_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS machine_groups_company_read ON machine_groups;
--> statement-breakpoint

CREATE POLICY machine_groups_company_read ON machine_groups
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
--> statement-breakpoint

DROP POLICY IF EXISTS machine_groups_manager_write ON machine_groups;
--> statement-breakpoint

CREATE POLICY machine_groups_manager_write ON machine_groups
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
--> statement-breakpoint

-- The two new machine columns. Both nullable: existing machines predate the
-- group master, and product_code is not known for every machine on day one.
ALTER TABLE machines ADD COLUMN IF NOT EXISTS machine_group_id uuid REFERENCES machine_groups(id);
--> statement-breakpoint

ALTER TABLE machines ADD COLUMN IF NOT EXISTS product_code text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS machines_machine_group_id_idx
  ON machines (machine_group_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- Backfill: every distinct machine_type already in use becomes a group, so the
-- new dropdown opens with the groups this company actually runs rather than
-- empty. created_by/updated_by borrow the company's first admin because a
-- migration has no session user. TRIM + NULLIF drops blanks; the DISTINCT is on
-- the trimmed value so "VMC" and "VMC " collapse into one group.
INSERT INTO machine_groups (company_id, code, description, created_by, updated_by)
SELECT DISTINCT ON (m.company_id, TRIM(m.machine_type))
       m.company_id,
       TRIM(m.machine_type),
       'Created by migration 0116 from the old free-text Type field',
       (SELECT u.id FROM users u
         WHERE u.company_id = m.company_id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1),
       (SELECT u.id FROM users u
         WHERE u.company_id = m.company_id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1)
  FROM machines m
 WHERE m.deleted_at IS NULL
   AND NULLIF(TRIM(m.machine_type), '') IS NOT NULL
   AND EXISTS (SELECT 1 FROM users u
                WHERE u.company_id = m.company_id AND u.role = 'admin' AND u.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM machine_groups g
                    WHERE g.company_id = m.company_id
                      AND g.code = TRIM(m.machine_type)
                      AND g.deleted_at IS NULL);
--> statement-breakpoint

-- Link every existing machine to the group its old Type text now names.
UPDATE machines m
   SET machine_group_id = g.id
  FROM machine_groups g
 WHERE m.machine_group_id IS NULL
   AND m.deleted_at IS NULL
   AND g.company_id = m.company_id
   AND g.deleted_at IS NULL
   AND g.code = TRIM(m.machine_type);
