-- 0115 — close the two remaining places where a QC entry NAMES a person but
-- links to nobody, or links to the wrong person (ADR-149, finishing ADR-147).
--
-- ADR-147 gave Incoming QC a "QC By" dropdown of the people Access Control
-- lets do QC work, and pointed goods_receipt_note_lines.qc_inspected_by at the
-- person picked instead of whoever pressed Submit. Two paths were left open:
--
-- 1. THE QC LOG (op_log). The QC Call Register's process-QC entry could only
--    save the inspector's NAME. Its operator_id column references the
--    OPERATORS master — shop-floor machinists — so a QC user (a login,
--    configured in Access Control) had nowhere to go. This adds qc_user_id.
--
-- 2. THE GRN SCREEN. goods_receipt_note_lines already HAS both columns
--    (qc_inspected_by + qc_inspected_by_text); the GRN form simply never
--    collected an inspector, and the service stamped whoever saved the GRN on
--    the completed transition. That is a code fix, not a schema one — nothing
--    in this migration is needed for it.
--
-- So this file adds ONE nullable column and one index. Nothing is backfilled:
-- entries written before today named a person in text and we cannot honestly
-- work out which login that was. operator_name keeps its own snapshot either
-- way, because a signed-off inspection must not change when someone is later
-- renamed, moved between departments or removed.
--
-- op_log is append-only; adding a nullable column touches no existing row and
-- leaves the append-only trigger alone.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

ALTER TABLE op_log ADD COLUMN IF NOT EXISTS qc_user_id uuid REFERENCES users(id);
--> statement-breakpoint

-- Drives "every inspection signed by this person" without scanning op_log.
-- Partial: only QC entries carry the column, and they are the minority.
CREATE INDEX IF NOT EXISTS op_log_qc_user_idx
  ON op_log (qc_user_id, log_date) WHERE qc_user_id IS NOT NULL;
