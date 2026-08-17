// Op-log history — legacy chrome (.innovic-table).
//
// Date and time are editable in place (ADR-127). Nothing else is: qty, reject,
// machine and operator are frozen by a DB trigger, not merely by this UI.
//
// Under ADR-130 an operator's edit does not take effect on save — it becomes a
// request and the row keeps showing its ORIGINAL date/time with a ⏳ marker
// until a manager decides. A manager/admin editing here still applies
// immediately (they are the approver), and can decide a pending request from
// this row without walking to Settings → Approvals.

import type { OpLog, OpLogTimeChangeRequest } from '@innovic/shared';
import { Check, Clock, Loader2, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { useDecideOpLogTimeChange, useOpLogTimeChangeRequests, useUpdateOpLogTiming } from '../api';

interface Props {
  logs: OpLog[];
  isLoading: boolean;
  /** Scopes the pending-change lookup to this operation. Omit and no ⏳
   *  markers are fetched — the table still edits normally. */
  jcOpId?: string;
}

const TYPE_LABEL: Record<OpLog['logType'], string> = {
  start: 'Start',
  complete: 'Complete',
  qc: 'QC',
};

const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : '');

function whenLabel(date: string, time: string | null): string {
  return time ? `${date} ${hhmm(time)}` : date;
}

export function OpLogHistory({ logs, isLoading, jcOpId }: Props): React.JSX.Element {
  const { data: me } = useSession();
  const canApprove = me?.role === 'admin' || me?.role === 'manager';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const retime = useUpdateOpLogTiming();
  const decide = useDecideOpLogTimeChange();
  const pending = useOpLogTimeChangeRequests(
    { status: 'pending', ...(jcOpId ? { jcOpId } : {}), limit: 200 },
    { enabled: Boolean(jcOpId) },
  );
  const pendingByLog = new Map<string, OpLogTimeChangeRequest>(
    (pending.data ?? []).map((r) => [r.opLogId, r]),
  );

  function beginEdit(l: OpLog): void {
    setEditingId(l.id);
    setDraftDate(l.logDate);
    setDraftTime(hhmm(l.startTime));
    setReason('');
    setNotice(null);
  }

  function save(id: string): void {
    retime.mutate(
      { id, logDate: draftDate, logTime: draftTime || null, ...(reason ? { reason } : {}) },
      {
        onSuccess: (res) => {
          setEditingId(null);
          setNotice(
            res.applied
              ? null
              : `Sent for approval — the entry still shows ${whenLabel(
                  res.opLog.logDate,
                  res.opLog.startTime,
                )} until a manager approves it.`,
          );
        },
      },
    );
  }

  const busy = retime.isPending || decide.isPending;

  return (
    <div className="tbl-wrap">
      {notice ? (
        <div
          style={{
            background: 'var(--bg3)',
            border: '1px solid var(--amber)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            color: 'var(--amber)',
            marginBottom: 8,
          }}
        >
          ⏳ {notice}
        </div>
      ) : null}
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
              const req = pendingByLog.get(l.id) ?? null;
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
                    ) : (
                      hhmm(l.startTime) || '—'
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
                    {editing ? (
                      <input
                        className="innovic-input"
                        type="text"
                        aria-label="Reason for the change"
                        placeholder={canApprove ? 'Reason (optional)' : 'Why? (shown to approver)'}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px', width: 180 }}
                      />
                    ) : (
                      <>
                        {l.remarks ?? ''}
                        {l.timingEditedAt ? (
                          <span
                            className="text3"
                            style={{ fontSize: 10, marginLeft: 4 }}
                            title={`Date/time corrected on ${new Date(
                              l.timingEditedAt,
                            ).toLocaleString()}. Qty unchanged.`}
                          >
                            (retimed)
                          </span>
                        ) : null}
                        {req ? (
                          <div
                            style={{ fontSize: 10, color: 'var(--amber)', marginTop: 2 }}
                            title={req.reason ?? ''}
                          >
                            <Clock className="mr-1 inline h-3 w-3" />
                            change pending →{' '}
                            <span className="mono">
                              {whenLabel(req.requestedLogDate, req.requestedStartTime)}
                            </span>
                            {req.requestedByName ? ` · asked by ${req.requestedByName}` : ''}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => save(l.id)}
                          disabled={busy || !draftDate}
                          title={canApprove ? 'Save date/time' : 'Send for approval'}
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
                          disabled={busy}
                          title="Cancel"
                          style={{ marginLeft: 4 }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : req && canApprove ? (
                      rejectingId === req.id ? (
                        <>
                          <input
                            className="innovic-input"
                            type="text"
                            aria-label="Reason for rejecting"
                            placeholder="Reason (required)"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            style={{ fontSize: 11, padding: '2px 4px', width: 140 }}
                          />
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            style={{ marginLeft: 4 }}
                            disabled={busy || !rejectReason.trim()}
                            onClick={() =>
                              decide.mutate(
                                {
                                  id: req.id,
                                  decision: 'reject',
                                  decisionReason: rejectReason.trim(),
                                },
                                {
                                  onSuccess: () => {
                                    setRejectingId(null);
                                    setRejectReason('');
                                  },
                                },
                              )
                            }
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ marginLeft: 4 }}
                            disabled={busy}
                            onClick={() => setRejectingId(null)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            title={`Approve change to ${whenLabel(
                              req.requestedLogDate,
                              req.requestedStartTime,
                            )}`}
                            onClick={() => decide.mutate({ id: req.id, decision: 'approve' })}
                          >
                            {decide.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ marginLeft: 4 }}
                            disabled={busy}
                            title="Reject change"
                            onClick={() => {
                              setRejectingId(req.id);
                              setRejectReason('');
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )
                    ) : req ? (
                      <span className="text3" style={{ fontSize: 10 }}>
                        awaiting approval
                      </span>
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
      {retime.isError || decide.isError ? (
        <div style={{ color: 'var(--red)', fontSize: 11, padding: '6px 4px' }}>
          {(retime.error ?? decide.error)?.message}
        </div>
      ) : null}
    </div>
  );
}
