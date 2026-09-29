// Screen words for the PR codes (wording clean-up 2026-09-26). Display only —
// the stored codes (`po_created`, `jw_osp`, …) are unchanged.

import type { PrStatus, PrType } from '@innovic/shared';

export const PR_STATUS_LABELS: Record<PrStatus, string> = {
  open: 'Open',
  approved: 'Approved',
  po_created: 'PO Created',
  cancelled: 'Cancelled',
};

export const PR_TYPE_LABELS: Record<PrType, string> = {
  standard: 'Standard',
  jw_osp: 'Outsource',
  service: 'Service',
};
