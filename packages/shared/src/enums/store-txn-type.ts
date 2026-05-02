// Stock-movement direction on a store_transactions row. Legacy values:
// 'IN' / 'OUT'. `adjust` is the canonical name for manual stock counts.
// qty is always stored positive; the sign is implied by txn_type.
export const STORE_TXN_TYPES = ['in', 'out', 'adjust'] as const;
export type StoreTxnType = (typeof STORE_TXN_TYPES)[number];
