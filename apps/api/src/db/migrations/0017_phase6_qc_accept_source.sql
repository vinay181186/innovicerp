-- ============================================================
-- 0017_phase6_qc_accept_source
-- T-040f — add 'qc_accept' to store_txn_source_type enum.
--
-- Triggered by op-entry submitQcLog when the QC log is against the
-- LAST op of a JC AND qty (accepted) > 0. The cascade writes a
-- store_transactions row with source_type='qc_accept'; v_item_stock
-- automatically reflects the new on_hand_qty.
--
-- Distinct from 'grn_qc' which is incoming GRN material acceptance —
-- per ADR-015 #11 the ledger is the source of truth, no items.stock_qty
-- denormalisation.
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is non-transactional in
-- Postgres; this migration intentionally contains a single statement
-- so the runner can commit it cleanly.
-- ============================================================

ALTER TYPE store_txn_source_type ADD VALUE IF NOT EXISTS 'qc_accept';
