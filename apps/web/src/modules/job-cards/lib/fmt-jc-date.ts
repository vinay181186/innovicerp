// Date / time captions for the Job Card status page (`dd-MMM-yyyy hh:mm`
// stamps). Thin wrappers over the one shared web display format in
// `@/lib/date`, kept so existing callers need not change their imports.

import { fmtDate, fmtDateAndTime } from '@/lib/date';

/** `2026-09-18` → `18-Sep-2026` (a timestamp shows its IST date); null → `—`. */
export function fmtJcDate(d: string | null | undefined): string {
  return fmtDate(d);
}

/** `12:26:05` → `12:26`; null / blank → ``. */
export function fmtJcTime(t: string | null | undefined): string {
  if (!t) return '';
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

/** `18-Sep-2026 12:26`, or the date alone when there is no time. */
export function fmtJcStamp(d: string | null | undefined, t?: string | null): string {
  return fmtDateAndTime(d, t);
}
