// Display formatting shared by the SO detail page and its sub-components.
//
// Lives here rather than inside detail.tsx because the Drawing History tab
// needs the same timestamp format and importing it from a route file would
// close an import cycle (detail → history → detail).

/** Format a stored UTC timestamp as IST date + time (e.g. "16 Jun 2026, 02:30 PM"). */
export function fmtIstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
