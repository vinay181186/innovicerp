// Screen words for the GRN QC status codes (wording clean-up 2026-09-26).
// Display only — the stored codes (`pending`, `in_progress`, …) are unchanged.

import type { GrnQcStatus } from '@innovic/shared';

export const GRN_QC_STATUS_LABELS: Record<GrnQcStatus, string> = {
  pending: 'QC Pending',
  in_progress: 'QC In Progress',
  completed: 'QC Cleared',
};
