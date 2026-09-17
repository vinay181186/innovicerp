-- 0132 — "Final Inspection" joins the QC Process Master; DIR stops being special.
--
-- ADR-069 (Rule B) makes the server append a terminal QC op to every job card
-- that would otherwise never pass a QC gate. That op used to be named DIR.
-- From this release the server writes "Final Inspection" instead
-- (lib/jc-default-qc.ts DEFAULT_FINAL_QC_OP), and DIR becomes an ordinary
-- QC process like MIR / MCR / TPI — pickable, deletable when unused, no
-- automatic behaviour attached.
--
-- A QC step is stored as free text on jc_ops / plan_ops / route_card_ops with
-- no FK to this master, so the code never needed the row to exist — but the
-- QC picker on the JC form lists ACTIVE master rows only, and the delete
-- guard in qc-processes/service.ts protects the name the server writes. Both
-- expect the row to be here. No migration ever seeded a QC process (the five
-- legacy ones arrived with the Firebase load), so this one does.
--
-- Data-only: one row per company that does not already have one (compared
-- case-insensitively, so a hand-typed "final inspection" is left alone rather
-- than duplicated — the delete guard is exact-match, so if that happens the
-- row must be renamed by delete-and-recreate before the guard covers it).
-- created_by / updated_by follow 0116: the company's oldest admin, because a
-- migration has no session user. Existing jc_ops named DIR are NOT rewritten
-- — history stays as it was signed.
--
-- Idempotent — a re-run inserts nothing.

INSERT INTO qc_processes (company_id, code, description, default_cycle_time_min, is_active, created_by, updated_by)
SELECT c.id,
       'Final Inspection',
       'Final QC gate on a job card — added automatically by the system when a routing has no QC at the end (ADR-069). Created by migration 0132.',
       0,
       true,
       (SELECT u.id FROM users u
         WHERE u.company_id = c.id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1),
       (SELECT u.id FROM users u
         WHERE u.company_id = c.id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1)
  FROM companies c
 WHERE c.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM users u
                WHERE u.company_id = c.id AND u.role = 'admin' AND u.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM qc_processes q
                    WHERE q.company_id = c.id
                      AND q.deleted_at IS NULL
                      AND lower(trim(q.code)) = 'final inspection');
