// "Team Day Logs" tab (TeamView board): one day, everyone the viewer may
// see. ONE strip of counts, then User · Department · Right · 09:00–18:00 bar ·
// Logged · Missing · Running now · Day Status · ⋯ (Open day log, and — when
// the server says canManage — Send reminder / Reopen / Mark Leave).
// Read only: a Department Admin never writes someone else's log.

import type { TeamDayLogRow } from '@innovic/shared';
import { DAY_LOG_RULES, fmtDuration } from '@innovic/shared';
import { useState } from 'react';
import { RowMenu, StatStrip, type RowMenuItem } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { useDayLogAdminAction, useRemindDayLog, useTeamDayLogs } from '../api';
import { teamTable } from '../lib/export';
import { DAY_STATUS_BADGE, dayStatusLabel, errText } from '../lib/format';
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

  const rows = team.rows;
  const count = (s: TeamDayLogRow['status']): number => rows.filter((r) => r.status === s).length;
  const missing = rows.filter((r) => r.status === 'open' && r.missingMin > 0).length;

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
        hidden: !team?.canManage || r.status !== 'open' || r.loggedMin > 0 || Boolean(r.runningNow),
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
          { key: 'users', label: 'Users', count: rows.length },
          {
            key: 'submitted',
            label: 'Submitted',
            count: count('submitted'),
            color: 'var(--green2)',
          },
          { key: 'open', label: 'Open', count: count('open') },
          { key: 'leave', label: 'Leave', count: count('leave') },
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
                <th>Department</th>
                <th>Right</th>
                <th title="Logged of Work needed">
                  {DAY_LOG_RULES.workFrom} – {DAY_LOG_RULES.workTo}
                </th>
                <th className="th-num">Logged</th>
                <th>Missing</th>
                <th>Running now</th>
                <th>Day Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No one to show for this day.
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
                  <td
                    title={r.runningNow ?? undefined}
                    style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {r.runningNow ?? '—'}
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
