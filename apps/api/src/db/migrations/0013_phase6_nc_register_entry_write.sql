-- Phase 6 (T-040a) — replace nc_register write policy from manager-only to
-- entry-write (admin/manager/operator). Legacy `_addManualNC` (legacy/
-- InnovicERP_v82_12_3_DataLossFix_29-04-2026.html line 22565) gates on
-- `canEntry()` which includes operators — operators on the shop floor file
-- NCs against their own ops, so the RLS layer must allow it.
--
-- Hand-written because drizzle-kit treats this as an ambiguous rename
-- (manager_write → entry_write). Idempotent so re-runs via apply-sql.ts
-- are safe.

DROP POLICY IF EXISTS "nc_register_manager_write" ON "nc_register";
--> statement-breakpoint
DROP POLICY IF EXISTS "nc_register_entry_write" ON "nc_register";
--> statement-breakpoint
CREATE POLICY "nc_register_entry_write" ON "nc_register"
  AS PERMISSIVE FOR ALL
  TO "authenticated"
  USING (
    current_user_role() IN ('admin', 'manager', 'operator')
    AND company_id = current_company_id()
  )
  WITH CHECK (
    current_user_role() IN ('admin', 'manager', 'operator')
    AND company_id = current_company_id()
  );
