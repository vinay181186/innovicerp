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
