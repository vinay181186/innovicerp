// Screen words for the stock-movement codes (wording clean-up 2026-09-26).
// Display only — the stored codes (`in`, `grn_qc`, …) are unchanged.

import type { StoreTxnSourceType, StoreTxnType } from '@innovic/shared';

export const STORE_TXN_TYPE_LABELS: Record<StoreTxnType, string> = {
  in: 'In',
  out: 'Out',
  adjust: 'Adjustment',
};

export const STORE_TXN_SOURCE_LABELS: Record<StoreTxnSourceType, string> = {
  grn_qc: 'GRN',
  manual_adjust: 'Manual Adjustment',
  dispatch: 'Dispatch',
  jw_in: 'JW In',
  jw_out: 'JW Out',
  qc_accept: 'QC Accepted',
  jw_return: 'JW Return',
  assembly: 'Assembly',
  reservation: 'Reservation',
  production_order_close: 'Production Order Close',
  other: 'Other',
};
