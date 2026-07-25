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
