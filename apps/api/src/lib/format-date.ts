// Dates and times as people read them (emails, messages, Excel/PDF text), in IST.
//
// THE one display format (owner decision 2026-11-03), the same as the web app's
// apps/web/src/lib/date.ts: dates read `03-11-2026` (DD-MM-YYYY), times read
// `02:35 PM` (12-hour, two-digit hour), date + time reads `03-11-2026 02:35 PM`.
// Midnight is `12:15 AM`, noon `12:00 PM`.
//
// A bare calendar date ('2026-09-26', a Postgres DATE) is printed as that day
// with no timezone shift -- it names a day, not an instant. A timestamp (a Date,
// or an ISO string with a time part) is converted to Asia/Kolkata first, so an
// instant just after midnight IST does not print as the previous UTC day.
//
// Display only -- never store these strings, send them as query values or parse
// them back.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `s` looks like a date or ISO timestamp ('2026-09-26',
 *  '2026-09-26T10:00:00Z', '2026-09-26 10:00:00+00'). */
export function isIsoDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/.test(s);
}

const IST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** IST calendar + clock parts of an instant. */
function istParts(date: Date): { y: string; m: string; d: string; hh: string; mi: string } {
  const parts = IST_PARTS.formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mi: get('minute') };
}

/** A Date from the input, or null when it cannot be read as an instant.
 *  Postgres text ('2026-11-03 06:30:00+00') gets its 'T' and a full '+00:00'
 *  offset, which is what `Date` can read. */
// A date + clock with NO offset ('2026-11-03 14:35', e.g. a to_char(... AT TIME ZONE
// 'Asia/Kolkata') report value) is already India wall-clock time: read it as +05:30 so it
// is never shifted again. A short '+00' offset is widened to '+00:00' — only after a clock,
// so a bare '2026-11' is left alone.
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const SHORT_OFFSET = /(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/;
function toInstant(d: Date | string): Date | null {
  let date: Date;
  if (typeof d === 'string') {
    const t = d.trim();
    const s = WALL_CLOCK.test(t)
      ? `${t.replace(' ', 'T')}+05:30`
      : t.replace(' ', 'T').replace(SHORT_OFFSET, '$1$2:00');
    date = new Date(s);
  } else {
    date = d;
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 24-hour `HH` + `MM` on the 12-hour dial: `14`,`35` → `02:35 PM`,
 *  `00`,`15` → `12:15 AM`, `12`,`00` → `12:00 PM`. */
function to12(hh: string | number, mi: string): string {
  const h = Number(hh);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${mi} ${h < 12 ? 'AM' : 'PM'}`;
}

/** DD-MM-YYYY in IST (`03-11-2026`). Returns '' for null/empty and the input
 *  unchanged when it cannot be read as a date. */
export function fmtDate(d: Date | string | null | undefined): string {
  if (d == null || d === '') return '';
  if (typeof d === 'string') {
    const m = DATE_ONLY.exec(d);
    if (m) {
      const month = Number(m[2]);
      return month >= 1 && month <= 12 ? `${m[3]}-${m[2]}-${m[1]}` : d;
    }
  }
  const date = toInstant(d);
  if (!date) return typeof d === 'string' ? d : '';
  const p = istParts(date);
  return `${p.d}-${p.m}-${p.y}`;
}

/** DD-MM-YYYY hh:mm AM/PM in IST, 12-hour (`26-09-2026 03:45 PM`). A bare
 *  calendar date has no time, so it prints as the date alone. '' for null/empty. */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (d == null || d === '') return '';
  if (typeof d === 'string' && DATE_ONLY.test(d)) return fmtDate(d);
  const date = toInstant(d);
  if (!date) return typeof d === 'string' ? d : '';
  const p = istParts(date);
  return `${p.d}-${p.m}-${p.y} ${to12(p.hh, p.mi)}`;
}

/** A stored wall-clock time (`HH:MM[:SS]`, as the log tables keep it) on the
 *  12-hour dial: `14:35:00` → `02:35 PM`. No timezone maths -- it is already
 *  local. null / blank / not a time → `empty`. */
export function fmtClock(time: string | null | undefined, empty = ''): string {
  const m = time ? /^(\d{1,2}):(\d{2})/.exec(time.trim()) : null;
  return m?.[1] && m[2] ? to12(m[1], m[2]) : empty;
}
