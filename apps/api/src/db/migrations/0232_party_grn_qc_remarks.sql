-- QC Remarks on Party GRN Incoming QC (owner 2026-10-31). The Direct Purchase
-- GRN already keeps goods_receipt_note_lines.qc_remarks; Party GRN had only
-- the Deviation Reason (reject_reason, required only when deviated), so a
-- fully accepted line could carry no remark at all. Additive, nullable — lines
-- inspected before stay NULL ("—"). Not the gate-in party_grn_lines.remarks.
ALTER TABLE "party_grn_lines" ADD COLUMN IF NOT EXISTS "qc_remarks" text;
