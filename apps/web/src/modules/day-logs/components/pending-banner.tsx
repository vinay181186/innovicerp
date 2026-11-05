// The orange band on every page (owner 2026-11-05): "N days not entered", then
// EVERY such date as a button that opens that day on My Day Log. It has no close
// button and no limit: it goes when the days are entered. It wraps as dates grow
// and scrolls inside itself past a third of the screen, so the page stays usable.
// Nothing while loading, when there are no days, or for someone whose Day Log
// page is hidden (the link would lead nowhere, §20.5).

import { Link, useRouterState } from '@tanstack/react-router';
import { hrefLink, useCanOpen } from '@/components/shared/action-link';
import { fmtDate } from '@/lib/date';
import { useMyPendingDays } from '../api';
import { weekday } from '../lib/format';

export function PendingBanner(): React.JSX.Element | null {
  const allowed = useCanOpen()('/task-board?view=daylog');
  const { data } = useMyPendingDays(allowed);
  // The date My Day Log is showing is lit.
  const viewing = useRouterState({
    select: (s) => {
      const search = s.location.search as { view?: string; date?: string };
      return s.location.pathname === '/task-board' && search.view === 'daylog' ? search.date : null;
    },
  });
  const dates = data?.dates ?? [];
  if (dates.length === 0) return null;
  return (
    <div className="pending-band" role="status">
      <b>
        {dates.length} {dates.length === 1 ? 'day' : 'days'} not entered
      </b>
      {dates.map((d) => (
        <Link
          key={d}
          {...(hrefLink(`/task-board?view=daylog&date=${d}`) as { to: string })}
          className={d === viewing ? 'pending-date on' : 'pending-date'}
          title={`${weekday(d)} — open this day`}
        >
          {fmtDate(d)}
        </Link>
      ))}
    </div>
  );
}
