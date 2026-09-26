// SO status → the words the user reads. The stored codes stay lower-case
// (packages/shared SO_STATUSES); only the display text is Title Case.
import type { SoStatus } from '@innovic/shared';

export const SO_STATUS_LABEL: Record<SoStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

/** For a status that arrives as a plain string (report rows). An unknown code
 *  falls back to the code itself with underscores turned into spaces. */
export function soStatusLabel(status: string): string {
  return SO_STATUS_LABEL[status as SoStatus] ?? status.replaceAll('_', ' ');
}
