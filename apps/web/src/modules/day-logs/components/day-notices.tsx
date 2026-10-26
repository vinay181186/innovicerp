// The two banners that stop a day before it starts:
//   blockedBy — an earlier working day is still open → "Open <date>";
//   strayOpen — an entry left Open on an earlier day → "Edit it" opens that
//               day and starts editing that entry.

import type { DayLogDetail } from '@innovic/shared';
import { Banner } from '@/ui/feedback';
import { fmtDmy } from '../lib/format';

export function BlockedNotice({
  day,
  onDate,
}: {
  day: DayLogDetail;
  onDate: (d: string) => void;
}): React.JSX.Element | null {
  if (!day.blockedBy) return null;
  const d = day.blockedBy.date;
  return (
    <Banner tone="warn" role="alert" title={day.blockedBy.reason}>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ marginTop: 6 }}
        onClick={() => onDate(d)}
      >
        Open {fmtDmy(d)}
      </button>
    </Banner>
  );
}

export function StrayOpenNotice({
  day,
  onEdit,
}: {
  day: DayLogDetail;
  /** Open that day and start editing that entry. */
  onEdit: (date: string, entryId: string) => void;
}): React.JSX.Element | null {
  const s = day.strayOpen;
  if (!s || s.date === day.date) return null;
  return (
    <Banner
      tone="warn"
      role="alert"
      title={`${fmtDmy(s.date)} ${s.fromTime} is still open — Edit it and give a Stop time`}
    >
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ marginTop: 6 }}
        onClick={() => onEdit(s.date, s.entryId)}
      >
        Edit it
      </button>
    </Banner>
  );
}
