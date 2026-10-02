// Design Work Log — date helpers, category colours and the Tracker badge shared
// by the five tabs. Split out of routes/list.tsx (was 1122 lines, ADR-203);
// byte-for-byte the helpers that lived there.

import { todayIst } from '@/lib/date';

// Legacy _dpWlEntry catColors (HTML L7975). Categories outside this map
// ('Client Support', 'Testing/FEA', 'Other') fall back to --text3, as in legacy.
const CAT_COLORS: Record<string, string> = {
  Design: 'var(--blue)',
  Review: 'var(--purple)',
  Rework: 'var(--red)',
  'Issue Resolution': 'var(--orange)',
  Meeting: 'var(--amber)',
  Documentation: 'var(--green)',
};

export function catColor(cat: string): string {
  return CAT_COLORS[cat] ?? 'var(--text3)';
}

export function todayStr(): string {
  return todayIst();
}

/** A local Date → YYYY-MM-DD from its LOCAL parts. `toISOString()` is UTC, so
 *  a local midnight in IST (UTC+5:30) came back as the previous day. */
export function localYmd(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

export function dayName(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
}

/** ADR-188 — time logged on the Design Tracker now lands in the Work Log as a
 *  row that carries its tracker id. The badge tells engineers where it came
 *  from; hand-entered rows (null) show nothing. */
export function TrackerBadge(props: { designTrackerId: string | null }): React.JSX.Element | null {
  if (!props.designTrackerId) return null;
  return (
    <span className="badge b-blue" title="Logged from the Design Tracker" style={{ marginLeft: 4 }}>
      Tracker
    </span>
  );
}

/** The category word in its legacy colour. */
export function CategoryText({ category }: { category: string }): React.JSX.Element {
  return <span style={{ color: catColor(category), fontWeight: 600 }}>{category}</span>;
}
