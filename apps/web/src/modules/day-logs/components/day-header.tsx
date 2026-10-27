// Shared bits of the Day Log screens: the "Day" select (today + earlier
// days, newest first) and the ONE thin summary line of a day (server figures).

import type { DayLogSummaryOut } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { Fragment } from 'react';
import { fmtDmy, recentDays, weekday } from '../lib/format';
import '../day-log-sheet.css';

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

/** Working hours · First start · Last stop · Entries (server figures) —
 *  one thin line (owner "Option B", 2026-10-27). */
export function DaySummaryStrip({ s }: { s: DayLogSummaryOut }): React.JSX.Element {
  const items: [string, string | number][] = [
    ['Working hours', fmtDuration(s.workMin)],
    ['First start', fmt12(s.firstStart)],
    ['Last stop', fmt12(s.lastStop)],
    ['Entries', s.entryCount],
  ];
  return (
    <div className="dl-sum">
      {items.map(([k, v], i) => (
        <Fragment key={k}>
          {i > 0 ? <span className="dl-sep" aria-hidden /> : null}
          <span>
            <span className="dl-k">{k}</span>
            <span className="dl-v">{v}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}
