// A day's entries, in time order: Start · Stop (LATE) · Time · Type ·
// Working on · SO / JWSO · Status (Open / Closed) · actions. The remark sits
// on its own line under its entry. Break rows are greyed, the Open row and
// the row being edited are tinted. Actions (■ Stop on Open, Edit, Remove)
// only when the caller says so — from the server's canWrite. Remove only on
// the LAST entry (strict order, owner 2026-10-26). Times show as 09:00 AM.

import type { DayLogEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDmy } from '../lib/format';

export interface EntryActions {
  busy: boolean;
  editingId: string | null;
  /** The day's last entry (latest start) — the only one that may be removed. */
  lastId: string | null;
  /** null = no ■ Stop (not today — fix an earlier Open entry through Edit). */
  onStop: ((e: DayLogEntry) => void) | null;
  onEdit: (e: DayLogEntry) => void;
  onRemove: (e: DayLogEntry) => void;
}

function rowTint(e: DayLogEntry, editing: boolean): React.CSSProperties {
  if (editing) return { background: 'var(--amber3)' };
  if (!e.toTime) return { background: 'var(--blue3)' };
  if (e.kind === 'break') return { background: 'var(--bg3)', color: 'var(--text3)' };
  return {};
}

export function EntriesTable({
  date,
  entries,
  actions,
  compact = false,
}: {
  date: string;
  entries: readonly DayLogEntry[];
  /** null = read-only (past / submitted day, someone else's day). */
  actions: EntryActions | null;
  /** Nested inside the person page's day row. */
  compact?: boolean;
}): React.JSX.Element {
  const cols = actions ? 8 : 7;
  const list = [...entries].sort((a, b) => a.fromTime.localeCompare(b.fromTime));
  return (
    <div className={compact ? 'tbl-wrap tbl-nofreeze' : 'tbl-wrap'}>
      <table className={compact ? 'innovic-table tbl-compact' : 'innovic-table'}>
        <thead>
          <tr>
            <th>Start</th>
            <th>Stop</th>
            <th className="th-num">Time</th>
            <th>Type</th>
            <th>Working on</th>
            <th>SO / JWSO</th>
            <th>Status</th>
            {actions ? <th aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={cols} className="empty-state">
                Nothing logged on {fmtDmy(date)}.
              </td>
            </tr>
          ) : null}
          {list.map((e) => {
            const open = !e.toTime;
            const tint = rowTint(e, actions?.editingId === e.id);
            return [
              <tr key={e.id} style={tint}>
                <td className="mono">{fmt12(e.fromTime)}</td>
                <td className="mono">
                  {open ? '● now' : fmt12(e.toTime)}
                  {e.late ? (
                    <span
                      className="badge b-orange"
                      style={{ marginLeft: 4 }}
                      title="Saved more than an hour after its stop time"
                    >
                      Late
                    </span>
                  ) : null}
                </td>
                <td className="td-num mono">{fmtDuration(e.minutes)}</td>
                <td>{e.kind === 'break' ? <i>Break</i> : 'Work'}</td>
                <td
                  title={e.description}
                  style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {e.description}
                </td>
                <td className="td-code">{e.order?.code ?? '—'}</td>
                <td>
                  <span className={`badge ${open ? 'b-blue' : 'b-green'}`}>
                    {open ? 'Open' : 'Closed'}
                  </span>
                </td>
                {actions ? (
                  <td>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      {open && actions.onStop ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={actions.busy}
                          onClick={() => actions.onStop?.(e)}
                        >
                          ■ Stop
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={actions.busy}
                        onClick={() => actions.onEdit(e)}
                      >
                        Edit
                      </button>
                      {e.id === actions.lastId ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={actions.busy}
                          onClick={() => actions.onRemove(e)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>,
              e.remarks ? (
                <tr key={`${e.id}-remark`} style={tint}>
                  <td />
                  <td
                    colSpan={cols - 1}
                    className="td-left"
                    style={{ color: 'var(--text2)', whiteSpace: 'pre-wrap' }}
                  >
                    <b>Remark:</b> {e.remarks}
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
