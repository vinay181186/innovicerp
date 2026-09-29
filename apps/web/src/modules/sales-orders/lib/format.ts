// Display formatting shared by the SO detail page and its sub-components.
//
// Lives here rather than inside detail.tsx because the Drawing History tab
// needs the same timestamp format and importing it from a route file would
// close an import cycle (detail → history → detail).

import { fmtDateTime } from '@/lib/date';

/** Format a stored UTC timestamp as IST date + time (e.g. "16-Jun-2026 14:30"). */
export function fmtIstDateTime(iso: string): string {
  return fmtDateTime(iso);
}
