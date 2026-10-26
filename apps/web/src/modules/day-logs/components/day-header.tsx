// Shared bits of the Day Log screens: the "Day" select (today + earlier
// days, newest first) and the ONE summary strip of a day (server figures).

import type { DayLogSummaryOut } from '@innovic/shared';
import { fmtDuration } from '@innovic/shared';
import { StatStrip } from '@/ui/data';
import { fmtDmy, recentDays, weekday } from '../lib/format';

/** How many days the Day select offers. */
export const DAY_SELECT_DAYS = 31;

export function DaySelect({
  value,
  today,
  onChange,
  days = DAY_SELECT_DAYS,
  ariaLabel = 'Day',
  id,
}: {
  value: string;
  today: string;
  onChange: (d: string) => void;
  days?: number;
  ariaLabel?: string;
  id?: string;
}): React.JSX.Element {
  const list = recentDays(today, days);
  // A day outside the list (an old link) still shows as picked.
  if (!list.includes(value)) list.push(value);
  return (
    <select
      id={id}
      className="innovic-select mono"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 'auto' }}
    >
      {list.map((d) => (
        <option key={d} value={d}>
          {fmtDmy(d)} ({weekday(d)}){d === today ? ' · today' : ''}
        </option>
      ))}
    </select>
  );
}

/** Working hours · Break · First start · Last stop · Late entries. */
export function DaySummaryStrip({ s }: { s: DayLogSummaryOut }): React.JSX.Element {
  return (
    <StatStrip
      style={{ marginBottom: 10 }}
      items={[
        { key: 'work', label: 'Working hours', count: fmtDuration(s.workMin) },
        { key: 'break', label: 'Break', count: `${s.breakMin} min` },
        { key: 'first', label: 'First start', count: s.firstStart ?? '—' },
        { key: 'last', label: 'Last stop', count: s.lastStop ?? '—' },
        {
          key: 'late',
          label: 'Late entries',
          count: s.lateCount,
          color: s.lateCount > 0 ? 'var(--amber2)' : undefined,
        },
      ]}
    />
  );
}
