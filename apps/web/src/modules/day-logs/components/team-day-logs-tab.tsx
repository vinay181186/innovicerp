// "Team Day Logs" tab (owner final 2026-10-27): one day, one row a person the
// viewer may see. ONE strip — today: Working · Idle · Not started · Team
// working hours · Edits to approve; a past day: Logged · No entries · Team
// working hours. A count click filters the table to it, a second click shows
// all; "Edits to approve" opens the Approvals tab. Columns: User (link to
// the person page) · Now · First start · Last stop · Working hours · Entries
// · Late (the LATE count — this tab is the admins' only). The table reads
// again every minute (api.ts).

import type { TeamDayLogRow } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { useState } from 'react';
import { StatStrip } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { useDayLogAccess, useDayLogApprovals, useTeamDayLogs } from '../api';
import { teamTable } from '../lib/export';
import { errText, nowChip } from '../lib/format';
import { printTeamDayLogs } from '../lib/print-day-log';
import { DaySelect } from './day-header';
import { PrintExportTools } from './print-export-tools';

const COLS = 7;

/** The strip's status cells, by the Now chip's label. */
const TODAY_CELLS: { label: string; color?: string }[] = [
  { label: 'Working', color: 'var(--blue)' },
  { label: 'Idle', color: 'var(--amber2)' },
  { label: 'Not started' },
];
const PAST_CELLS: typeof TODAY_CELLS = [
  { label: 'Logged', color: 'var(--green2)' },
  { label: 'No entries' },
];

export function NowCell({
  row,
  isToday,
}: {
  row: Pick<TeamDayLogRow, 'currentStatus' | 'currentText' | 'entryCount'>;
  isToday: boolean;
}): React.JSX.Element {
  const c = nowChip(row, isToday);
  const text = isToday ? row.currentText : null;
  return (
    <>
      <span className={`badge ${c.cls}`}>{c.label}</span>
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
  onApprovals,
}: {
  date: string | undefined;
  onDate: (d: string | undefined) => void;
  onOpenPerson: (userId: string, date: string) => void;
  onApprovals: () => void;
}): React.JSX.Element {
  const query = useTeamDayLogs(date);
  const access = useDayLogAccess();
  const canApprove = Boolean(access.data?.canApprove);
  const approvals = useDayLogApprovals(canApprove);
  const team = query.data;
  const [only, setOnly] = useState<string | null>(null);

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
  const labelOf = (r: TeamDayLogRow): string => nowChip(r, isToday).label;
  const filter = cells.find((c) => c.label === only) ?? null;
  const rows = filter ? team.rows.filter((r) => labelOf(r) === filter.label) : team.rows;
  const teamWork = team.rows.reduce((n, r) => n + r.workMin, 0);
  const toApprove = approvals.data?.rows.length ?? 0;

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
            key: c.label,
            label: c.label,
            count: team.rows.filter((r) => labelOf(r) === c.label).length,
            color: c.color,
            active: only === c.label,
            onClick: () => setOnly(only === c.label ? null : c.label),
          })),
          { key: 'hours', label: 'Team working hours', count: fmtDuration(teamWork) },
          ...(isToday && canApprove
            ? [
                {
                  key: 'approve',
                  label: 'Edits to approve',
                  count: toApprove,
                  color: toApprove > 0 ? 'var(--amber2)' : undefined,
                  onClick: onApprovals,
                },
              ]
            : []),
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
                <th>First start</th>
                <th>Last stop</th>
                <th className="th-num">Working hours</th>
                <th className="th-num">Entries</th>
                <th>Late</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="empty-state">
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
                    <NowCell row={r} isToday={isToday} />
                  </td>
                  <td className="mono">{fmt12(r.firstStart)}</td>
                  <td className="mono">{fmt12(r.lastStop)}</td>
                  <td className="td-num mono fw-700">{fmtDuration(r.workMin)}</td>
                  <td className="td-num mono">{r.entryCount}</td>
                  <td>
                    {r.lateCount > 0 ? (
                      <span className="badge b-orange">{r.lateCount} LATE</span>
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
