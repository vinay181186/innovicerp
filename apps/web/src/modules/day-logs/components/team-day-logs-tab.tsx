// "Team Day Logs" tab (TeamView board): one day, everyone the viewer may
// see. ONE strip of counts by Current Status (a click filters the table to
// that status, a second click shows all), then User · Current Status ·
// Department · Right · 09:00–18:00 bar · Logged · Missing · Day Status · ⋯
// (Open day log, and — when the server says canManage — Send reminder /
// Reopen / Mark Leave). A row click opens that person's day, read only.
// A Department Admin never writes someone else's log.

import type { DayLogCurrentStatus, TeamDayLogRow } from '@innovic/shared';
import {
  DAY_LOG_CURRENT_STATUS_LABELS,
  DAY_LOG_CURRENT_STATUSES,
  DAY_LOG_RULES,
  fmtDuration,
  hhmmToMin,
} from '@innovic/shared';
import { useEffect, useState } from 'react';
import { RowMenu, StatStrip, type RowMenuItem } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { useDayLogAdminAction, useRemindDayLog, useTeamDayLogs } from '../api';
import { teamTable } from '../lib/export';
import {
  CURRENT_STATUS_BADGE,
  DAY_STATUS_BADGE,
  dayStatusLabel,
  errText,
  liveNowMin,
} from '../lib/format';
import { printTeamDayLogs } from '../lib/print-day-log';
import { ReasonDialog } from './day-dialogs';
import { DateStepper } from './day-header';
import { PrintExportTools } from './print-export-tools';

function LoggedBar({ row }: { row: TeamDayLogRow }): React.JSX.Element {
  const pct = row.requiredMin > 0 ? Math.min(100, (row.loggedMin / row.requiredMin) * 100) : 0;
  return (
    <div
      title={`${fmtDuration(row.loggedMin)} of ${fmtDuration(row.requiredMin)}`}
      style={{
        width: 140,
        height: 10,
        borderRadius: 5,
        background: 'var(--amber3)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        margin: '0 auto',
      }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--blue)' }} />
    </div>
  );
}

const TICK_MS = 30_000;

const STRIP_COLOR: Partial<Record<DayLogCurrentStatus, string>> = {
  working: 'var(--blue)',
  idle: 'var(--amber2)',
  submitted: 'var(--green2)',
};

const OUTLINE: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text3)',
};

function CurrentStatusCell({
  row,
  nowMin,
}: {
  row: TeamDayLogRow;
  /** null = not today: no live elapsed. */
  nowMin: number | null;
}): React.JSX.Element {
  const s = row.currentStatus;
  const cls = CURRENT_STATUS_BADGE[s];
  const elapsed =
    s === 'working' && row.runningSince && nowMin !== null
      ? fmtDuration(Math.max(0, nowMin - hhmmToMin(row.runningSince)))
      : null;
  const text = [row.currentText, elapsed].filter(Boolean).join(' · ');
  return (
    <td
      title={text || undefined}
      style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      <span className={`badge ${cls}`} style={cls ? undefined : OUTLINE}>
        {DAY_LOG_CURRENT_STATUS_LABELS[s]}
      </span>
      {text ? <span style={{ marginLeft: 6 }}>{text}</span> : null}
    </td>
  );
}

export function TeamDayLogsTab({
  date,
  onDate,
  onOpenDay,
}: {
  date: string | undefined;
  onDate: (d: string | undefined) => void;
  onOpenDay: (userId: string, date: string) => void;
}): React.JSX.Element {
  const query = useTeamDayLogs(date);
  const team = query.data;
  const remind = useRemindDayLog();
  const [ask, setAsk] = useState<{ kind: 'reopen' | 'leave'; row: TeamDayLogRow } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const reopen = useDayLogAdminAction('reopen', { date: team?.date, userId: ask?.row.userId });
  const leave = useDayLogAdminAction('leave', { date: team?.date, userId: ask?.row.userId });
  const [only, setOnly] = useState<DayLogCurrentStatus | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const anyWorking = Boolean(team?.rows.some((r) => r.currentStatus === 'working'));

  // The Working chips' elapsed time moves on every 30 s while someone works.
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

  const all = team.rows;
  const rows = only ? all.filter((r) => r.currentStatus === only) : all;
  const count = (s: DayLogCurrentStatus): number => all.filter((r) => r.currentStatus === s).length;
  const missing = all.filter((r) => r.status === 'open' && r.missingMin > 0).length;
  const nowMin =
    team.date === team.today ? liveNowMin(team.nowTime, query.dataUpdatedAt, tick) : null;

  function menu(r: TeamDayLogRow): RowMenuItem[] {
    const d = team?.date ?? '';
    return [
      { key: 'open', label: 'Open day log', icon: 'eye', onSelect: () => onOpenDay(r.userId, d) },
      {
        key: 'remind',
        label: 'Send reminder',
        group: 'workflow',
        hidden: !team?.canManage || r.status !== 'open',
        onSelect: async () => {
          setNote(null);
          try {
            await remind.mutateAsync({ userId: r.userId, date: d });
            setNote({ ok: true, text: `Reminder sent to ${r.userName}.` });
          } catch (e) {
            setNote({ ok: false, text: errText(e) });
          }
        },
      },
      {
        key: 'reopen',
        label: 'Reopen day',
        group: 'workflow',
        hidden: !team?.canManage || r.status === 'open',
        onSelect: () => setAsk({ kind: 'reopen', row: r }),
      },
      {
        key: 'leave',
        label: 'Mark Leave',
        group: 'workflow',
        hidden:
          !team?.canManage ||
          r.status !== 'open' ||
          r.loggedMin > 0 ||
          r.currentStatus === 'working',
        onSelect: () => setAsk({ kind: 'leave', row: r }),
      },
    ];
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <DateStepper date={team.date} today={team.today} onDate={onDate} />
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
          ...DAY_LOG_CURRENT_STATUSES.map((s) => ({
            key: s,
            label: DAY_LOG_CURRENT_STATUS_LABELS[s],
            count: count(s),
            color: STRIP_COLOR[s],
            active: only === s,
            onClick: () => setOnly(only === s ? null : s),
          })),
          {
            key: 'missing',
            label: 'Missing time',
            count: missing,
            color: missing > 0 ? 'var(--amber2)' : undefined,
          },
        ]}
      />
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      {note ? (
        <Banner tone={note.ok ? 'success' : 'error'} onDismiss={() => setNote(null)}>
          {note.text}
        </Banner>
      ) : null}
      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Current Status</th>
                <th>Department</th>
                <th>Right</th>
                <th title="Logged of Work needed">
                  {DAY_LOG_RULES.workFrom} – {DAY_LOG_RULES.workTo}
                </th>
                <th className="th-num">Logged</th>
                <th>Missing</th>
                <th>Day Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    {only
                      ? `No one is ${DAY_LOG_CURRENT_STATUS_LABELS[only]} — click the count again to show all.`
                      : 'No one to show for this day.'}
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr
                  key={r.userId}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onOpenDay(r.userId, team.date)}
                >
                  <td className="fw-700" title={r.userName}>
                    {r.userName}
                  </td>
                  <CurrentStatusCell row={r} nowMin={nowMin} />
                  <td>{r.deptLabel ?? '—'}</td>
                  <td>{r.tierLabel ?? '—'}</td>
                  <td>
                    <LoggedBar row={r} />
                  </td>
                  <td className="td-num mono">{fmtDuration(r.loggedMin)}</td>
                  <td
                    className="mono"
                    style={r.missingFrom ? { color: 'var(--amber2)', fontWeight: 700 } : undefined}
                  >
                    {r.missingFrom ?? '—'}
                  </td>
                  <td>
                    <span className={`badge ${DAY_STATUS_BADGE[r.status]}`}>
                      {dayStatusLabel(r.status)}
                    </span>
                  </td>
                  <td>
                    <div onClick={(e) => e.stopPropagation()}>
                      <RowMenu items={menu(r)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {ask ? (
        <ReasonDialog
          title={
            ask.kind === 'reopen'
              ? `Reopen ${ask.row.userName}'s day`
              : `Mark ${ask.row.userName} on Leave`
          }
          message={
            ask.kind === 'reopen'
              ? `The day opens again so ${ask.row.userName} can correct it.`
              : 'The day is recorded as Leave — no time is required.'
          }
          confirmLabel={ask.kind === 'reopen' ? 'Reopen' : 'Mark Leave'}
          onConfirm={(reason) =>
            (ask.kind === 'reopen' ? reopen : leave).mutateAsync({
              userId: ask.row.userId,
              date: team.date,
              reason,
            })
          }
          onClose={() => setAsk(null)}
        />
      ) : null}
    </div>
  );
}
