// Day Log header: ← date →, whose day it is, the Day Status chip, ONE strip
// of counts from the server's summary (Work needed · Logged · After 18:00 ·
// Missing), and the green "09:00 – 18:00 fully logged" chip.

import type { DayLogDetail } from '@innovic/shared';
import { fmtDuration } from '@innovic/shared';
import { fmtDateTime } from '@/lib/date';
import { StatStrip } from '@/ui/data';
import { DAY_STATUS_BADGE, dayStatusLabel, fmtDayTitle, shiftDate } from '../lib/format';

export function DateStepper({
  date,
  today,
  onDate,
}: {
  date: string;
  today: string;
  onDate: (d: string | undefined) => void;
}): React.JSX.Element {
  const go = (d: string): void => onDate(d === today ? undefined : d);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label="Previous day"
        onClick={() => go(shiftDate(date, -1))}
      >
        ←
      </button>
      <input
        type="date"
        className="innovic-input mono"
        aria-label="Day"
        value={date}
        max={today}
        onChange={(e) => {
          if (e.target.value) go(e.target.value);
        }}
        style={{ width: '16ch', minWidth: 140 }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label="Next day"
        disabled={date >= today}
        onClick={() => go(shiftDate(date, 1))}
      >
        →
      </button>
      {date !== today ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDate(undefined)}>
          Today
        </button>
      ) : null}
    </div>
  );
}

export function DayHeader({
  day,
  onDate,
  tools,
}: {
  day: DayLogDetail;
  onDate: (d: string | undefined) => void;
  tools?: React.ReactNode;
}): React.JSX.Element {
  const s = day.summary;
  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <DateStepper date={day.date} today={day.today} onDate={onDate} />
        <strong style={{ fontSize: 15 }}>
          {day.userName} · {fmtDayTitle(day.date)}
        </strong>
        {day.deptLabel ? <span className="text3">{day.deptLabel}</span> : null}
        <span className={`badge ${DAY_STATUS_BADGE[day.status]}`}>
          {dayStatusLabel(day.status)}
        </span>
        {!day.isOwner ? <span className="badge b-grey">Read only</span> : null}
        {!day.workingDay ? (
          <span className="badge b-grey">{day.holidayName ?? 'Not a working day'}</span>
        ) : null}
        {day.workingDay && s.missingMin === 0 ? (
          <span className="badge b-green">
            {day.workFrom} – {day.workTo} fully logged
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {tools}
      </div>
      <StatStrip
        style={{ marginBottom: 10 }}
        items={[
          { key: 'need', label: 'Work needed', count: fmtDuration(s.requiredMin) },
          { key: 'breaks', label: 'Breaks', count: fmtDuration(s.breakMin) },
          { key: 'logged', label: 'Logged', count: fmtDuration(s.loggedMin) },
          { key: 'after', label: `After ${day.workTo}`, count: fmtDuration(s.afterMin) },
          {
            key: 'missing',
            label: 'Missing',
            count: fmtDuration(s.missingMin),
            color: s.missingMin > 0 ? 'var(--amber2)' : 'var(--green2)',
            sub: s.missingMin > 0 ? `from ${s.nextFrom}` : undefined,
          },
        ]}
      />
      {day.submittedAt || day.reopenedAt ? (
        <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 8 }}>
          {day.submittedAt ? (
            <span>
              Submitted {fmtDateTime(day.submittedAt)}
              {day.submittedByName ? ` by ${day.submittedByName}` : ''}.{' '}
            </span>
          ) : null}
          {day.reopenedAt ? (
            <span>
              Reopened {fmtDateTime(day.reopenedAt)}
              {day.reopenedByName ? ` by ${day.reopenedByName}` : ''}
              {day.reopenReason ? ` — “${day.reopenReason}”` : ''}.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
