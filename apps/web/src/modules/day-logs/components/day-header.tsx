// The ONE thin summary line of a Day Log day (server figures). Every Day Log
// screen picks its day with a native date box (ADR-255).

import type { DayLogSummaryOut } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { Fragment } from 'react';
import '../day-log-sheet.css';

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
