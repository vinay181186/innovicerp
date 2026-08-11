// Polymorphic source type for store_transactions (ADR-015 #10).
// `source_ref` text holds the natural-key reference (e.g. 'IN-GRN-00001');
// FK columns deferred until a source needs strong consistency.
export const STORE_TXN_SOURCE_TYPES = [
  'grn_qc',
  'manual_adjust',
  'dispatch',
  'jw_in',
  'jw_out',
  // T-040f (2026-05-15): production QC accept on the LAST op of a JC.
  // Distinct from grn_qc which is incoming GRN material acceptance.
  'qc_accept',
  // ADR-106 (2026-08-06): machined job-work goods going back to the customer
  // on a JW Return Challan — the debit that balances the qc_accept credit on a
  // JWSO Job Card, mirroring dispatch on the sales side. NOT 'jw_out', which is
  // the historical OSP-send debit that ADR-067 retired.
  'jw_return',
  // ADR-115 (2026-08-11): components consumed by assembling one unit of an
  // Equipment SO. Assembling physically empties the shelf, but the tracker
  // wrote no ledger row at all — so components already inside finished
  // machines still counted as available to build more.
  'assembly',
  'other',
] as const;
export type StoreTxnSourceType = (typeof STORE_TXN_SOURCE_TYPES)[number];
