// Dates as people read them in emails: DD-MMM-YYYY (26-Sep-2026), in IST.
//
// A bare calendar date ('2026-09-26', a Postgres DATE) is printed as that day
// with no timezone shift -- it names a day, not an instant. A timestamp (a Date,
// or an ISO string with a time part) is converted to Asia/Kolkata first, so an
// instant just after midnight IST does not print as the previous UTC day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `s` looks like a date or ISO timestamp ('2026-09-26',
 *  '2026-09-26T10:00:00Z', '2026-09-26 10:00:00+00'). */
export function isIsoDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/.test(s);
}

/** DD-MMM-YYYY in IST. Returns '' for null/empty and the input unchanged when
 *  it cannot be read as a date. */
export function fmtDate(d: Date | string | null | undefined): string {
  if (d == null || d === '') return '';
  if (typeof d === 'string') {
    const m = DATE_ONLY.exec(d);
    if (m) {
      const month = MONTHS[Number(m[2]) - 1];
      return month ? `${m[3]}-${month}-${m[1]}` : d;
    }
  }
  const date = typeof d === 'string' ? new Date(d.replace(' ', 'T')) : d;
  if (Number.isNaN(date.getTime())) return typeof d === 'string' ? d : '';
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return `${dd}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()}`;
}
