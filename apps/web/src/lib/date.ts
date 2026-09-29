/** Local (IST/browser-local) calendar date as YYYY-MM-DD — safe for date-input
 *  defaults. Unlike new Date().toISOString().slice(0,10) it does NOT shift to
 *  UTC (which defaults to "yesterday" before ~05:30 IST). */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's calendar date IN IST as `YYYY-MM-DD`, whatever the browser's own
 *  timezone happens to be.
 *
 *  This is the upper bound on every Op Entry date box. `todayLocal()` is the
 *  browser's day, which is right on a shop-floor PC set to IST and wrong on a
 *  laptop that is not -- and the server records and validates in IST, so a
 *  browser-local bound would either offer a day IST has not reached or refuse
 *  one it has. `en-CA` is used only because it formats as YYYY-MM-DD. */
export function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** A `YYYY-MM-DD` calendar date split into its three numbers, or null when the
 *  string is not one. Blank, half-typed and malformed dates all return null so
 *  callers can treat "no usable date" as one case. */
function parseYmd(date: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Add (or subtract) whole days to a `YYYY-MM-DD` calendar date and return the
 * same shape. `''` for an unusable input, so a half-typed date never produces a
 * wrong one.
 *
 * The arithmetic runs on `Date.UTC`, NOT on a local-midnight `Date`. That is
 * deliberate and it is the opposite of a "UTC round trip": nothing here is ever
 * converted between zones — the Y/M/D that goes in is the Y/M/D that comes back.
 * Doing the sum on local midnights is what breaks it: on a DST boundary a day is
 * 23 or 25 hours long, so "+10 days" silently lands on day 9 or day 11. UTC days
 * are all exactly 86,400,000 ms, so the count is always the count.
 */
export function addDaysLocal(date: string, days: number): string {
  const p = parseYmd(date);
  if (!p || !Number.isFinite(days)) return '';
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + Math.trunc(days) * 86_400_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/**
 * Whole days from one `YYYY-MM-DD` to another — `to` minus `from`, so a `to`
 * that falls EARLIER is negative. Null when either date is unusable.
 *
 * The exact inverse of `addDaysLocal`, on the same UTC-day arithmetic, so
 * `daysBetweenLocal(a, addDaysLocal(a, n)) === n` for every n.
 */
export function daysBetweenLocal(from: string, to: string): number | null {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b) return null;
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000,
  );
}

// ── Display formatting ─────────────────────────────────────────────────────
// THE one web display format (owner decision): dates read `26-Sep-2026`,
// date + time reads `26-Sep-2026 14:05` (24-hour, IST). Display only — never
// feed these strings back into an input, a query param or an API payload.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A plain calendar date: `YYYY-MM-DD` with nothing after it. */
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** IST calendar parts of an instant, or null when it is not a valid instant. */
function istParts(v: string): { y: string; m: number; d: string; hh: string; mi: string } | null {
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(dt);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return {
    y: get('year'),
    m: Number(get('month')),
    d: get('day'),
    hh: get('hour'),
    mi: get('minute'),
  };
}

/**
 * `2026-09-26` → `26-Sep-2026`. A plain `YYYY-MM-DD` is read as a calendar date
 * (pure string work, no timezone shift); a timestamp is shown as its IST date.
 * null / blank → `empty` (default `—`); anything unparseable comes back as-is.
 */
export function fmtDate(v: string | null | undefined, empty = '—'): string {
  if (!v || !v.trim()) return empty;
  const s = v.trim();
  const plain = PLAIN_DATE.exec(s);
  if (plain) {
    const mon = MONTHS[Number(plain[2]) - 1];
    return mon ? `${plain[3]}-${mon}-${plain[1]}` : s;
  }
  const p = istParts(s);
  const mon = p ? MONTHS[p.m - 1] : undefined;
  return p && mon ? `${p.d}-${mon}-${p.y}` : s;
}

/**
 * Timestamp → `26-Sep-2026 14:05` in IST (24-hour). A plain `YYYY-MM-DD` has
 * no time, so it shows as the date alone. null / blank → `empty`.
 */
export function fmtDateTime(v: string | null | undefined, empty = '—'): string {
  if (!v || !v.trim()) return empty;
  const s = v.trim();
  if (PLAIN_DATE.test(s)) return fmtDate(s, empty);
  const p = istParts(s);
  const mon = p ? MONTHS[p.m - 1] : undefined;
  return p && mon ? `${p.d}-${mon}-${p.y} ${p.hh}:${p.mi}` : s;
}

/**
 * A stored calendar date plus an optional wall-clock time (`HH:MM[:SS]`, as
 * the log tables keep them) → `26-Sep-2026 14:05`, or the date alone when
 * there is no time. No timezone maths — both parts are already local.
 */
export function fmtDateAndTime(
  date: string | null | undefined,
  time?: string | null,
  empty = '—',
): string {
  const d = fmtDate(date, empty);
  const m = time ? /^(\d{1,2}):(\d{2})/.exec(time.trim()) : null;
  return m && date ? `${d} ${m[1]!.padStart(2, '0')}:${m[2]}` : d;
}
