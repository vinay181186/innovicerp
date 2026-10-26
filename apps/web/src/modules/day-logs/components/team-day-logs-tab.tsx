// "Team Day Logs" tab: one day, one row a person the viewer may see.
// ONE strip — today: Working · On break · Idle · Not started · Submitted;
// a past day: Submitted · Not submitted · No entries — plus Team working
// hours. A count click filters the table to it, a second click shows all.
// Columns: User (link to the person page) · Now · Working on (latest) ·
// First start · Last stop · Working hours · Break · Leave · Entries · Late. The
// Working chip ticks its elapsed time from runningSince on the server clock;
// the table reads again every minute (api.ts).

import type { DayLogCurrentStatus, TeamDayLogRow } from '@innovic/shared';
import { DAY_LOG_CURRENT_STATUS_LABELS, fmt12, fmtDuration, hhmmToMin } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { StatStrip } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { useTeamDayLogs } from '../api';
import { teamTable } from '../lib/export';
import { CURRENT_STATUS_BADGE, errText, liveNowMin, PAST_STATUS_LABEL } from '../lib/format';
import { printTeamDayLogs } from '../lib/print-day-log';
import { DaySelect } from './day-header';
import { PrintExportTools } from './print-export-tools';

const TICK_MS = 30_000;

/** The strip's cells: which statuses each counts. */
const TODAY_CELLS: { key: string; label: string; of: DayLogCurrentStatus[]; color?: string }[] = [
  { key: 'working', label: 'Working', of: ['working'], color: 'var(--blue)' },
  { key: 'break', label: 'On break', of: ['break'] },
  { key: 'idle', label: 'Idle', of: ['idle'], color: 'var(--amber2)' },
  { key: 'not_started', label: 'Not started', of: ['not_started'] },
  { key: 'submitted', label: 'Submitted', of: ['submitted'], color: 'var(--green2)' },
  { key: 'leave', label: 'Leave', of: ['leave'] },
];
const PAST_CELLS: typeof TODAY_CELLS = [
  { key: 'submitted', label: 'Submitted', of: ['submitted'], color: 'var(--green2)' },
  { key: 'idle', label: 'Not submitted', of: ['idle', 'working', 'break'], color: 'var(--amber2)' },
  { key: 'not_started', label: 'No entries', of: ['not_started'] },
  { key: 'leave', label: 'Leave', of: ['leave'] },
];

export function NowCell({
  row,
  nowMin,
}: {
  row: Pick<TeamDayLogRow, 'currentStatus' | 'currentText' | 'runningSince'>;
  /** null = not today: the past day's label, no live elapsed. */
  nowMin: number | null;
}): React.JSX.Element {
  const s = row.currentStatus;
  const elapsed =
    s === 'working' && row.runningSince && nowMin !== null
      ? fmtDuration(Math.max(0, nowMin - hhmmToMin(row.runningSince)))
      : null;
  const text = nowMin === null ? '' : [row.currentText, elapsed].filter(Boolean).join(' · ');
  return (
    <>
      <span className={`badge ${CURRENT_STATUS_BADGE[s]}`}>
        {nowMin === null ? PAST_STATUS_LABEL[s] : DAY_LOG_CURRENT_STATUS_LABELS[s]}
      </span>
      {text ? (
        <span className="text3" style={{ marginLeft: 6 }}>
          {text}
        </span>
      ) : null}
    </>
  );
}

const LINK: React.CSSProperties = {
  border: 0,
  background: 'none',
  padding: 0,
  font: 'inherit',
  fontWeight: 700,
  color: 'var(--blue)',
  cursor: 'pointer',
  textDecoration: 'underline',
};

export function TeamDayLogsTab({
  date,
  onDate,
  onOpenPerson,
}: {
  date: string | undefined;
  onDate: (d: string | undefined) => void;
  onOpenPerson: (userId: string, date: string) => void;
}): React.JSX.Element {
  const query = useTeamDayLogs(date);
  const team = query.data;
  const [only, setOnly] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const anyWorking = Boolean(team?.rows.some((r) => r.currentStatus === 'working'));

  // The Working chips' elapsed time moves on while someone works.
  useEffect(() => {
    if (!anyWorking) return undefined;
    const id = window.setInterval(() => setTick(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [anyWorking]);

  if (!team) {
    return (
      <div
        className="empty-state"
        style={{ padding: 40, color: query.isError ? 'var(--red2)' : undefined }}
      >
        {query.isError ? errText(query.error, 'Could not load the team day logs.') : 'Loading…'}
      </div>
    );
  }

  const isToday = team.date === team.today;
  const cells = isToday ? TODAY_CELLS : PAST_CELLS;
  const filter = cells.find((c) => c.key === only) ?? null;
  const rows = filter ? team.rows.filter((r) => filter.of.includes(r.currentStatus)) : team.rows;
  const nowMin = isToday ? liveNowMin(team.nowTime, query.dataUpdatedAt, tick) : null;
  const teamWork = team.rows.reduce((n, r) => n + r.workMin, 0);

  return (
    <div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <label className="text3" htmlFor="dl-team-day">
          Day
        </label>
        <DaySelect
          id="dl-team-day"
          value={team.date}
          today={team.today}
          onChange={(d) => {
            setOnly(null);
            onDate(d === team.today ? undefined : d);
          }}
        />
        {!team.workingDay ? <span className="badge b-grey">Not a working day</span> : null}
        {query.isFetching ? <span className="text3">⟳ Updating…</span> : null}
        <span style={{ flex: 1 }} />
        <PrintExportTools
          table={teamTable(team)}
          fileName={`team-day-logs-${team.date}`}
          sheetName="Team Day Logs"
          onPrint={(company) => printTeamDayLogs(team, company)}
        />
      </div>
      <StatStrip
        style={{ marginBottom: 10 }}
        items={[
          ...cells.map((c) => ({
            key: c.key,
            label: c.label,
            count: team.rows.filter((r) => c.of.includes(r.currentStatus)).length,
            color: c.color,
            active: only === c.key,
            onClick: () => setOnly(only === c.key ? null : c.key),
          })),
          { key: 'hours', label: 'Team working hours', count: fmtDuration(teamWork) },
        ]}
      />
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Now</th>
                <th>Working on (latest)</th>
                <th>First start</th>
                <th>Last stop</th>
                <th className="th-num">Working hours</th>
                <th className="th-num">Break</th>
                <th className="th-num">Leave</th>
                <th className="th-num">Entries</th>
                <th>Late</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">
                    {filter
                      ? `No one is ${filter.label} — click the count again to show all.`
                      : 'No one to show for this day.'}
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr
                  key={r.userId}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onOpenPerson(r.userId, team.date)}
                >
                  <td title={r.userName}>
                    <button
                      type="button"
                      style={LINK}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPerson(r.userId, team.date);
                      }}
                    >
                      {r.userName}
                    </button>
                  </td>
                  <td
                    title={r.currentText ?? undefined}
                    style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    <NowCell row={r} nowMin={nowMin} />
                  </td>
                  <td
                    title={r.latestWork?.description}
                    style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {r.latestWork ? (
                      <>
                        {r.latestWork.description}
                        {r.latestWork.orderCode ? (
                          <span className="mono fw-700" style={{ marginLeft: 6 }}>
                            {r.latestWork.orderCode}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="mono">{fmt12(r.firstStart)}</td>
                  <td className="mono">{fmt12(r.lastStop)}</td>
                  <td className="td-num mono fw-700">{fmtDuration(r.workMin)}</td>
                  <td className="td-num mono">{r.breakMin} min</td>
                  <td className="td-num mono">{r.leaveMin > 0 ? fmtDuration(r.leaveMin) : '—'}</td>
                  <td className="td-num mono">{r.entryCount}</td>
                  <td>
                    {r.lateCount > 0 ? (
                      <span className="badge b-orange">{r.lateCount} Late</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
