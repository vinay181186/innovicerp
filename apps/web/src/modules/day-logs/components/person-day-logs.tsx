// Person page (Team Day Logs → a name, owner final 2026-10-27): one
// person's days over From – To (default the 7 days ending on the team date).
// ONE strip from the server's totals (Days logged · Working hours · Avg per
// day · Late entries), then one row a day: Date · First start · Last stop ·
// Working hours · Entries · Late · SO / JWSO worked on. A click on a date
// opens that day's entries under it (Start · Stop with LATE / "⏳ Edit
// pending" · SO / JWSO · Time, and the Working on line); the team date opens
// expanded.

import { todayIst } from '@/lib/date';
import { DAY_LOG_RULES, fmt12, fmtDuration } from '@innovic/shared';
import { Fragment, useState } from 'react';
import { StatStrip } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { useDayLog, usePersonDayLogs } from '../api';
import { errText, fmtDmy, shiftDate, weekday } from '../lib/format';
import { DaySelect } from './day-header';
import { EntriesTable } from './entries-table';

/** Default range length, days. */
const DEFAULT_DAYS = 7;
const COLS = 7;

function DayEntries({ userId, date }: { userId: string; date: string }): React.JSX.Element {
  const q = useDayLog({ userId, date });
  if (!q.data) {
    return (
      <div className="empty-state" style={{ color: q.isError ? 'var(--red2)' : undefined }}>
        {q.isError ? errText(q.error, 'Could not load the day.') : 'Loading…'}
      </div>
    );
  }
  return <EntriesTable date={date} entries={q.data.entries} compact />;
}

export function PersonDayLogs({
  userId,
  date,
  from,
  to,
  onRange,
  onBack,
}: {
  userId: string;
  /** The team date the page was opened from. */
  date: string | undefined;
  from: string | undefined;
  to: string | undefined;
  onRange: (from: string, to: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const anchor = date ?? todayIst();
  const rangeTo = to ?? anchor;
  const rangeFrom = from ?? shiftDate(rangeTo, -(DEFAULT_DAYS - 1));
  const query = usePersonDayLogs(userId, rangeFrom, rangeTo);
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [anchor]: true }));
  const p = query.data;
  if (!p) {
    return (
      <div
        className="empty-state"
        style={{ padding: 40, color: query.isError ? 'var(--red2)' : undefined }}
      >
        {query.isError ? errText(query.error, "Could not load this person's days.") : 'Loading…'}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Team Day Logs
        </button>
        <strong style={{ fontSize: 'var(--fs-md)' }}>{p.userName}</strong>
        {p.deptLabel ? <span className="text3">{p.deptLabel}</span> : null}
        <span style={{ flex: 1 }} />
        <label className="text3" htmlFor="dl-from">
          From
        </label>
        <DaySelect
          id="dl-from"
          ariaLabel="From"
          value={rangeFrom}
          today={p.today}
          days={DAY_LOG_RULES.maxRangeDays}
          onChange={(f) => onRange(f, f > rangeTo ? f : rangeTo)}
        />
        <label className="text3" htmlFor="dl-to">
          To
        </label>
        <DaySelect
          id="dl-to"
          ariaLabel="To"
          value={rangeTo}
          today={p.today}
          days={DAY_LOG_RULES.maxRangeDays}
          onChange={(t) => onRange(t < rangeFrom ? t : rangeFrom, t)}
        />
      </div>
      <StatStrip
        style={{ marginBottom: 10 }}
        items={[
          { key: 'days', label: 'Days logged', count: p.totals.daysLogged },
          { key: 'work', label: 'Working hours', count: fmtDuration(p.totals.workMin) },
          { key: 'avg', label: 'Avg per day', count: fmtDuration(p.totals.avgWorkMin) },
          {
            key: 'late',
            label: 'Late entries',
            count: p.totals.lateCount,
            color: p.totals.lateCount > 0 ? 'var(--amber2)' : undefined,
          },
        ]}
      />
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>First start</th>
                <th>Last stop</th>
                <th className="th-num">Working hours</th>
                <th className="th-num">Entries</th>
                <th>Late</th>
                <th>SO / JWSO worked on</th>
              </tr>
            </thead>
            <tbody>
              {p.days.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="empty-state">
                    No days in this range.
                  </td>
                </tr>
              ) : null}
              {p.days.map((d) => {
                const isOpen = Boolean(open[d.date]);
                const codes = d.orderCodes.join(', ');
                return (
                  <Fragment key={d.date}>
                    <tr
                      aria-expanded={isOpen}
                      style={{
                        cursor: 'pointer',
                        ...(isOpen ? { background: 'var(--blue3)' } : {}),
                      }}
                      onClick={() => setOpen((o) => ({ ...o, [d.date]: !o[d.date] }))}
                    >
                      <td className="mono">
                        <span className="text3">{isOpen ? '▾' : '▸'}</span> <b>{fmtDmy(d.date)}</b>{' '}
                        <span className="text3">{weekday(d.date)}</span>
                      </td>
                      <td className="mono">{fmt12(d.firstStart)}</td>
                      <td className="mono">{fmt12(d.lastStop)}</td>
                      <td className="td-num mono fw-700">{fmtDuration(d.workMin)}</td>
                      <td className="td-num mono">{d.entryCount}</td>
                      <td>
                        {d.lateCount > 0 ? (
                          <span className="badge b-orange">{d.lateCount} LATE</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className="mono"
                        title={codes || undefined}
                        style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {codes || '—'}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td
                          colSpan={COLS}
                          style={{ background: 'var(--bg3)', padding: '8px 10px 12px 28px' }}
                        >
                          <DayEntries userId={userId} date={d.date} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
