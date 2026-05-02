// Polymorphic source type for store_transactions (ADR-015 #10).
// `source_ref` text holds the natural-key reference (e.g. 'IN-GRN-00001');
// FK columns deferred until a source needs strong consistency.
export const STORE_TXN_SOURCE_TYPES = [
  'grn_qc',
  'manual_adjust',
  'dispatch',
  'jw_in',
  'jw_out',
  'other',
] as const;
export type StoreTxnSourceType = (typeof STORE_TXN_SOURCE_TYPES)[number];
