// DC status → the words the user reads. The stored codes stay lower-case
// (packages/shared DC_STATUSES); only the display text is Title Case.
import type { DcStatus } from '@innovic/shared';

export const DC_STATUS_LABEL: Record<DcStatus, string> = {
  issued: 'Issued',
  received: 'Received',
  cancelled: 'Cancelled',
};
