-- Partial Incoming QC on Party GRN (owner 2026-10-31, "A"): a line received
-- 60 may be inspected 6 now and 54 later, like the Direct Purchase GRN.
-- accepted_qty / rejected_qty become RUNNING totals; QC Pending Qty =
-- received − accepted − rejected. qc_at is stamped at the FIRST inspection
-- (latest inspection thereafter), so a part-inspected line always has qc_at —
-- Customer Material Return and the edit freeze rely on that.
--
-- Old rule (0193 party_grn_lines_qc_split_check): untouched, or the whole
-- received qty in one go. New rule:
--   untouched                      qc_at NULL, accepted = 0, rejected = 0
--   pre-ADR-203 (0173 backfill)    qc_at NULL, accepted + rejected = received
--   inspected (part or whole)      qc_at set,  accepted + rejected <= received
-- Checked before writing: 0 pre-ADR-203 lines on PROD and TEST (2026-10-31).
ALTER TABLE "party_grn_lines" DROP CONSTRAINT IF EXISTS "party_grn_lines_qc_split_check";
--> statement-breakpoint
ALTER TABLE "party_grn_lines" ADD CONSTRAINT "party_grn_lines_qc_split_check" CHECK (
  ("qc_at" IS NULL AND "accepted_qty" = 0 AND "rejected_qty" = 0)
  OR ("qc_at" IS NULL AND "accepted_qty" + "rejected_qty" = "received_qty")
  OR ("qc_at" IS NOT NULL AND "accepted_qty" + "rejected_qty" <= "received_qty")
);
