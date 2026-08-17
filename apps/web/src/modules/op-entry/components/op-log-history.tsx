// Op-log history — legacy chrome (.innovic-table).
//
// Date and time are editable in place (ADR-127). Nothing else is: qty, reject,
// machine and operator are frozen by a DB trigger, not merely by this UI, so
// every machine-wise and completion number stays exactly as recorded.

import type { OpLog } from '@innovic/shared';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { useUpdateOpLogTiming } from '../api';

interface Props {
  logs: OpLog[];
  isLoading: boolean;
}

const TYPE_LABEL: Record<OpLog['logType'], string> = {
  start: 'Start',
  complete: 'Complete',
  qc: 'QC',
};

export function OpLogHistory({ logs, isLoading }: Props): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const retime = useUpdateOpLogTiming();

  function beginEdit(l: OpLog): void {
    setEditingId(l.id);
    setDraftDate(l.logDate);
    setDraftTime(l.startTime ? l.startTime.slice(0, 5) : '');
  }

  function save(id: string): void {
    retime.mutate(
      { id, logDate: draftDate, logTime: draftTime || null },
      { onSuccess: () => setEditingId(null) },
    );
  }

  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Shift</th>
            <th>Type</th>
            <th>Machine</th>
            <th style={{ textAlign: 'center' }}>Qty</th>
            <th style={{ textAlign: 'center' }}>Reject</th>
            <th>Operator</th>
            <th>Remarks</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={10} className="empty-state">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading log…
              </td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan={10} className="empty-state">
                No log entries yet.
              </td>
            </tr>
          ) : (
            logs.map((l) => {
              const editing = editingId === l.id;
              return (
                <tr key={l.id}>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {editing ? (
                      <input
                        className="innovic-input"
                        type="date"
                        aria-label="Entry date"
                        value={draftDate}
                        onChange={(e) => setDraftDate(e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px', width: 130 }}
                      />
                    ) : (
                      l.logDate
                    )}
                  </td>
                  {/* op_log.start_time. Historically only the 'start' marker
                      carried one — completion and QC rows were written with
                      null — so older rows legitimately show a dash. */}
                  <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {editing ? (
                      <input
                        className="innovic-input"
                        type="time"
                        aria-label="Entry time"
                        value={draftTime}
                        onChange={(e) => setDraftTime(e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px', width: 100 }}
                      />
                    ) : l.startTime ? (
                      l.startTime.slice(0, 5)
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    {l.shift}
                  </td>
                  <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    {TYPE_LABEL[l.logType]}
                  </td>
                  {/* 0095: the machine stamped on THIS entry — survives a later
                      machine change on the op, so past qty stays attributed. */}
                  <td className="mono" style={{ fontSize: 11 }}>
                    {l.machineCode ?? l.machineCodeText ?? '—'}
                  </td>
                  <td className="td-ctr mono">{l.qty}</td>
                  <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                    {l.rejectQty || ''}
                  </td>
                  <td style={{ fontSize: 12 }}>{l.operatorName ?? '—'}</td>
                  <td className="text3" style={{ fontSize: 11 }}>
                    {l.remarks ?? ''}
                    {l.timingEditedAt ? (
                      <span
                        className="text3"
                        style={{ fontSize: 10, marginLeft: 4 }}
                        title={`Date/time corrected on ${new Date(l.timingEditedAt).toLocaleString()}. Qty unchanged.`}
                      >
                        (retimed)
                      </span>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => save(l.id)}
                          disabled={retime.isPending || !draftDate}
                          title="Save date/time"
                        >
                          {retime.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditingId(null)}
                          disabled={retime.isPending}
                          title="Cancel"
                          style={{ marginLeft: 4 }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => beginEdit(l)}
                        title="Edit date/time (qty cannot be changed)"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {retime.isError ? (
        <div style={{ color: 'var(--red)', fontSize: 11, padding: '6px 4px' }}>
          {retime.error.message}
        </div>
      ) : null}
    </div>
  );
}
