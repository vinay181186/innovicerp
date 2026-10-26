// The day's entries, in order: #, From, To, Time, Work done, Work Status, ⋯.
// Breaks are greyed and unnumbered; the running entry is highlighted. Row ⋯
// (owner, day open — from the server's canWrite): Change status · ▶ Continue
// (unfinished work: fills the work box, the user presses Start) · Remove
// (last work entry).

import type { DayLogDetail, DayLogEntry, DayLogWorkStatus } from '@innovic/shared';
import { useState } from 'react';
import { RowMenu, type RowMenuItem } from '@/ui/data';
import { useRemoveDayLogEntry, useSetDayLogEntryStatus, type DayQuery } from '../api';
import { entryDuration, errText, workStatusLabel, WORK_STATUS_BADGE } from '../lib/format';
import { StatusPickDialog } from './day-dialogs';

export function EntriesTable({
  day,
  q,
  canContinue,
  onContinue,
}: {
  day: DayLogDetail;
  q: DayQuery;
  /** ▶ Continue is offered only where the work box is (today, own day). */
  canContinue: boolean;
  onContinue: (e: DayLogEntry) => void;
}): React.JSX.Element {
  const setStatus = useSetDayLogEntryStatus(q);
  const remove = useRemoveDayLogEntry(q);
  const [editing, setEditing] = useState<DayLogEntry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const work = day.entries.filter((e) => e.kind === 'work');
  const lastWorkId = work[work.length - 1]?.id;
  const showMenu = day.canWrite;

  async function pick(s: DayLogWorkStatus): Promise<void> {
    if (!editing) return;
    try {
      await setStatus.mutateAsync({ id: editing.id, status: s, updatedAt: editing.updatedAt });
      setEditing(null);
    } catch (x) {
      setErr(errText(x));
    }
  }

  function menu(e: DayLogEntry): RowMenuItem[] {
    const closed = Boolean(e.toTime);
    return [
      {
        key: 'status',
        label: 'Change status',
        icon: 'pencil',
        hidden: !closed,
        onSelect: () => {
          setErr(null);
          setEditing(e);
        },
      },
      {
        key: 'continue',
        label: '▶ Continue',
        group: 'workflow',
        hidden: !canContinue || !closed || e.status === 'completed',
        onSelect: () => onContinue(e),
      },
      {
        key: 'remove',
        label: 'Remove',
        icon: 'trash-2',
        group: 'danger',
        hidden: e.id !== lastWorkId,
        onSelect: async () => {
          setErr(null);
          try {
            await remove.mutateAsync(e.id);
          } catch (x) {
            setErr(errText(x));
          }
        },
      },
    ];
  }

  let n = 0;
  return (
    <div className="panel" style={{ padding: 0, marginBottom: 10 }}>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th className="th-num">#</th>
              <th>From</th>
              <th>To</th>
              <th className="th-num">Time</th>
              <th>Work done</th>
              <th>Work Status</th>
              {showMenu ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {day.entries.length === 0 ? (
              <tr>
                <td colSpan={showMenu ? 7 : 6} className="empty-state">
                  Nothing logged for this day yet.
                </td>
              </tr>
            ) : null}
            {day.entries.map((e) => {
              const isBreak = e.kind === 'break';
              if (!isBreak) n += 1;
              const isRunning = !isBreak && !e.toTime;
              const rowStyle: React.CSSProperties = isBreak
                ? { color: 'var(--text3)', background: 'var(--bg3)' }
                : isRunning
                  ? { background: 'var(--blue3)' }
                  : {};
              const badge = isBreak
                ? 'b-grey'
                : isRunning
                  ? 'b-blue'
                  : e.status
                    ? WORK_STATUS_BADGE[e.status]
                    : 'b-grey';
              return (
                <tr key={e.id} style={rowStyle}>
                  <td className="td-num">{isBreak ? '' : n}</td>
                  <td className="mono">{e.fromTime}</td>
                  <td className="mono">{e.toTime ?? '…'}</td>
                  <td className="td-num mono">{entryDuration(e)}</td>
                  <td
                    title={e.description}
                    style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {e.description}
                  </td>
                  <td>
                    <span className={`badge ${badge}`}>{workStatusLabel(e)}</span>
                  </td>
                  {showMenu ? <td>{isBreak ? null : <RowMenu items={menu(e)} />}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {err ? (
        <p
          role="alert"
          style={{ color: 'var(--red2)', margin: 0, padding: '8px 14px', fontSize: 13 }}
        >
          {err}
        </p>
      ) : null}
      {editing ? (
        <StatusPickDialog
          title={`Work Status — ${editing.fromTime} – ${editing.toTime ?? ''}`}
          current={editing.status}
          busy={setStatus.isPending}
          error={err}
          onPick={(s) => void pick(s)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
