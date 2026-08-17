// Op-log history — CARD layout (no horizontal scroll). One card per log entry
// so it fits the narrow Recent-log sidebar; the old .innovic-table version ran
// 10 columns wide and scrolled sideways.
//
// Date and time are editable in place (ADR-127). Nothing else is: qty, reject,
// machine and operator are frozen by a DB trigger, not merely by this UI.
//
// Under ADR-130 an operator's edit does not take effect on save — it becomes a
// request and the row keeps showing its ORIGINAL date/time with a ⏳ marker
// until a manager decides. A manager/admin editing here still applies
// immediately (they are the approver), and can decide a pending request from
// this card without walking to Settings → Approvals.

import type { OpLog, OpLogTimeChangeRequest } from '@innovic/shared';
import { Check, Clock, Loader2, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { useDecideOpLogTimeChange, useOpLogTimeChangeRequests, useUpdateOpLogTiming } from '../api';

interface Props {
  logs: OpLog[];
  isLoading: boolean;
  /** Scopes the pending-change lookup to this operation. Omit and no ⏳
   *  markers are fetched — the cards still edit normally. */
  jcOpId?: string;
}

const TYPE_LABEL: Record<OpLog['logType'], string> = {
  start: 'Start',
  complete: 'Complete',
  qc: 'QC',
};

// Card type-badge palette — tokens only (no hard-coded hex).
const TYPE_STYLE: Record<OpLog['logType'], { bg: string; fg: string }> = {
  start: { bg: 'var(--amber3)', fg: 'var(--amber)' },
  complete: { bg: 'var(--green3)', fg: 'var(--green)' },
  qc: { bg: 'var(--bg4)', fg: 'var(--cyan)' },
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
    <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {notice ? (
        <div
          style={{
            background: 'var(--bg3)',
            border: '1px solid var(--amber)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            color: 'var(--amber)',
          }}
        >
          ⏳ {notice}
        </div>
      ) : null}

      {isLoading ? (
        <div className="empty-state">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading log…
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">No log entries yet.</div>
      ) : (
        logs.map((l) => {
          const editing = editingId === l.id;
          const req = pendingByLog.get(l.id) ?? null;
          const ts = TYPE_STYLE[l.logType];
          return (
            <div
              key={l.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius2)',
                background: 'var(--bg2)',
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {/* Header: type badge + when (left) · qty/reject + row action (right) */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      background: ts.bg,
                      color: ts.fg,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '2px 7px',
                      borderRadius: 999,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {TYPE_LABEL[l.logType]}
                  </span>
                  {editing ? (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <input
                        className="innovic-input"
                        type="date"
                        aria-label="Entry date"
                        value={draftDate}
                        onChange={(e) => setDraftDate(e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px', width: 130 }}
                      />
                      <input
                        className="innovic-input"
                        type="time"
                        aria-label="Entry time"
                        value={draftTime}
                        onChange={(e) => setDraftTime(e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px', width: 100 }}
                      />
                    </div>
                  ) : (
                    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                      {l.logDate}
                      {hhmm(l.startTime) ? ` · ${hhmm(l.startTime)}` : ''}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 12 }} title="Qty done / rejected">
                    {l.qty}
                    {l.rejectQty ? <span style={{ color: 'var(--red)' }}> · rej {l.rejectQty}</span> : null}
                  </span>
                  {/* Row action — edit / approve / reject. Logic preserved from
                      the table version. */}
                  {editing ? null : req && canApprove ? (
                    rejectingId === req.id ? null : (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
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
                          disabled={busy}
                          title="Reject change"
                          onClick={() => {
                            setRejectingId(req.id);
                            setRejectReason('');
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
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
                </div>
              </div>

              {/* Meta: machine · operator · shift */}
              <div
                className="text3"
                style={{ fontSize: 11, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
              >
                <span className="mono">{l.machineCode ?? l.machineCodeText ?? '—'}</span>
                <span>·</span>
                <span style={{ color: 'var(--text2)' }}>{l.operatorName ?? '—'}</span>
                <span>·</span>
                <span style={{ textTransform: 'uppercase' }}>{l.shift}</span>
              </div>

              {/* Remarks + retimed marker (display only, not while editing) */}
              {!editing && (l.remarks || l.timingEditedAt) ? (
                <div
                  className="text3"
                  style={{ fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-word' }}
                >
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
                </div>
              ) : null}

              {/* Pending-change line */}
              {!editing && req ? (
                <div
                  style={{ fontSize: 10, color: 'var(--amber)', wordBreak: 'break-word' }}
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

              {/* Edit panel: reason + save / cancel */}
              {editing ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    className="innovic-input"
                    type="text"
                    aria-label="Reason for the change"
                    placeholder={canApprove ? 'Reason (optional)' : 'Why? (shown to approver)'}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{ fontSize: 11, padding: '2px 6px', flex: '1 1 160px', minWidth: 120 }}
                  />
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
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}

              {/* Reject panel: reason + reject / cancel (manager rejecting a request) */}
              {!editing && req && canApprove && rejectingId === req.id ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    className="innovic-input"
                    type="text"
                    aria-label="Reason for rejecting"
                    placeholder="Reason (required)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    style={{ fontSize: 11, padding: '2px 6px', flex: '1 1 140px', minWidth: 120 }}
                  />
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy || !rejectReason.trim()}
                    onClick={() =>
                      decide.mutate(
                        { id: req.id, decision: 'reject', decisionReason: rejectReason.trim() },
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
                    disabled={busy}
                    onClick={() => setRejectingId(null)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })
      )}

      {retime.isError || decide.isError ? (
        <div style={{ color: 'var(--red)', fontSize: 11, padding: '6px 4px' }}>
          {(retime.error ?? decide.error)?.message}
        </div>
      ) : null}
    </div>
  );
}
