// The banner that stops a day before it starts (owner final 2026-10-27):
// blockedBy — the previous calendar day has no saved row → "<date> has no
// entries — fill it first" with "Open <date>". No new rows on the blocked
// day; the blocking day itself takes rows as usual.

import type { DayLogDetail } from '@innovic/shared';
import { Banner } from '@/ui/feedback';
import { fmtDmy, weekday } from '../lib/format';

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
    <Banner
      tone="warn"
      role="alert"
      title={`${fmtDmy(d)} (${weekday(d)}) has no entries — fill it first.`}
    >
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
