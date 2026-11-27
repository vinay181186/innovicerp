-- ============================================================
-- 0265_cancel_line_undo
-- ADR-324 line undo (P1) — three new Cancel Request types whose doc_id is a
-- LINE or NC id, not a document header:
--   party_grn_line     — remove a Party GRN line nothing was inspected on
--   party_grn_line_qc  — reverse the Incoming QC of one Party GRN line
--   nc_disposition     — undo the decision on a customer-material NC
-- cancel_requests_doc_type_chk re-added with 0221's list + these three
-- (packages/shared CANCEL_DOC_TYPES). Constraint only — no rows change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

ALTER TABLE "cancel_requests" DROP CONSTRAINT IF EXISTS "cancel_requests_doc_type_chk";
--> statement-breakpoint
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_doc_type_chk"
  CHECK ("doc_type" IN (
    'invoice', 'jw_invoice', 'customer_dispatch',
    'jw_return', 'customer_material_return', 'party_grn', 'party_material_issue',
    'delivery_challan', 'store_issue', 'stock_count', 'tool_issue',
    'purchase_request', 'purchase_order',
    'jw_dc_outward', 'plan', 'job_work_order', 'sales_order', 'grn',
    'job_card', 'production_order', 'dc_receipt', 'jw_dc_inward',
    'party_grn_line', 'party_grn_line_qc', 'nc_disposition'
  ));

-- Rollback (manual, only while no row uses the three new types):
-- Re-add cancel_requests_doc_type_chk with the 0221 list.
