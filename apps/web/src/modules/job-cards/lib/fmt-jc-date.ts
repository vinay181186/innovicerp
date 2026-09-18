// Date / time captions for the Job Card status page (the mockup's
// `dd-MMM-yyyy hh:mm` stamps). Pure string work on the server's `YYYY-MM-DD`
// and `HH:MM:SS` values — no Date object, so nothing ever shifts a day across
// a timezone the way `new Date('2026-09-18')` does before 05:30 IST.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-18` → `18-Sep-2026`. Anything that is not a calendar date comes
 *  back untouched (an ISO timestamp still reads its date part), null → `—`. */
export function fmtJcDate(d: string | null | undefined): string {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${m[3]}-${mon}-${m[1]}` : d;
}

/** `12:26:05` → `12:26`; null / blank → ``. */
export function fmtJcTime(t: string | null | undefined): string {
  if (!t) return '';
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

/** `18-Sep-2026 12:26`, or the date alone when there is no time. */
export function fmtJcStamp(d: string | null | undefined, t?: string | null): string {
  const date = fmtJcDate(d);
  const time = fmtJcTime(t);
  return time ? `${date} ${time}` : date;
}
