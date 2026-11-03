// Date / time captions for the Job Card status page (`dd-MM-yyyy hh:mm AM`
// stamps). Thin wrappers over the one shared web display format in
// `@/lib/date`, kept so existing callers need not change their imports.

import { fmtClock, fmtDate, fmtDateAndTime } from '@/lib/date';

/** `2026-09-18` → `18-09-2026` (a timestamp shows its IST date); null → `—`. */
export function fmtJcDate(d: string | null | undefined): string {
  return fmtDate(d);
}

/** `12:26:05` → `12:26 PM`; null / blank → ``. */
export function fmtJcTime(t: string | null | undefined): string {
  if (!t) return '';
  return fmtClock(t) || t;
}

/** `18-09-2026 12:26 PM`, or the date alone when there is no time. */
export function fmtJcStamp(d: string | null | undefined, t?: string | null): string {
  return fmtDateAndTime(d, t);
}
