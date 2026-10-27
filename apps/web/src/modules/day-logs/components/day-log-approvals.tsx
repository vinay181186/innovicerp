// Task Board tab "Approvals · Day Log (N)" (owner final 2026-10-27), shown
// only when GET /day-logs/access says canApprove (§20.5). One row per staged
// edit (GET /day-logs/approvals): User · Day · Change (Was: struck through /
// New: in green) · ✓ Approve · ✗ Reject. Reject asks for a reason first.
// The server decides who may approve whom (never one's own) and answers 409
// when someone else already decided — the message shows above the table.

import type { DayLogApprovalRow } from '@innovic/shared';
import { useState } from 'react';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { useApproveDayLogEdit, useDayLogApprovals, useRejectDayLogEdit } from '../api';
import { errText, fmtDmy, weekday } from '../lib/format';
import { spanText } from '../lib/sheet';

function changeText(v: DayLogApprovalRow['current'] | DayLogApprovalRow['proposed']): string {
  return [spanText(v.fromTime, v.toTime), v.orderCode, v.description].filter(Boolean).join(' · ');
}

export function DayLogApprovals(): React.JSX.Element {
  const query = useDayLogApprovals();
  const approve = useApproveDayLogEdit();
  const reject = useRejectDayLogEdit();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<DayLogApprovalRow | null>(null);
  const [reason, setReason] = useState('');
  const [rejectErr, setRejectErr] = useState<string | null>(null);

  if (!query.data) {
    return (
      <div
        className="empty-state"
        style={{ padding: 40, color: query.isError ? 'var(--red2)' : undefined }}
      >
        {query.isError ? errText(query.error, 'Could not load the edits to approve.') : 'Loading…'}
      </div>
    );
  }
  const rows = query.data.rows;

  const doApprove = async (r: DayLogApprovalRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.entryId);
    setMsg(null);
    try {
      await approve.mutateAsync(r.entryId);
      setMsg({ ok: true, text: `Approved — ${r.userName}'s row now shows the new values.` });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async (): Promise<void> => {
    if (!rejecting) return;
    const r = rejecting;
    if (reason.trim().length < 3) {
      setRejectErr('Give a reason');
      return;
    }
    setBusyId(r.entryId);
    try {
      await reject.mutateAsync({ id: r.entryId, reason: reason.trim() });
      setRejecting(null);
      setMsg({
        ok: true,
        text: `Rejected — the row stays as it was; ${r.userName} sees the reason.`,
      });
    } catch (e) {
      setRejectErr(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <strong>Day Log edits waiting for approval</strong>
        {query.isFetching ? <span className="text3">⟳ Updating…</span> : null}
      </div>
      {msg ? <Banner tone={msg.ok ? 'success' : 'error'}>{msg.text}</Banner> : null}
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Day</th>
                <th>Change</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    No edits waiting.
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => {
                const busy = busyId === r.entryId;
                return (
                  <tr key={r.entryId}>
                    <td className="fw-700">{r.userName}</td>
                    <td className="mono">
                      {fmtDmy(r.date)} <span className="text3">{weekday(r.date)}</span>
                    </td>
                    <td className="td-left" style={{ whiteSpace: 'pre-wrap', minWidth: 320 }}>
                      <div style={{ color: 'var(--text3)', textDecoration: 'line-through' }}>
                        Was: {changeText(r.current)}
                      </div>
                      <div style={{ color: 'var(--green2)', fontWeight: 600 }}>
                        New: {changeText(r.proposed)}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busyId !== null}
                          onClick={() => void doApprove(r)}
                        >
                          {busy && !rejecting ? 'Approving…' : '✓ Approve'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busyId !== null}
                          onClick={() => {
                            setMsg(null);
                            setReason('');
                            setRejectErr(null);
                            setRejecting(r);
                          }}
                        >
                          ✗ Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {rejecting ? (
        <ConfirmDialog
          title={`Reject ${rejecting.userName}'s edit?`}
          message={
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="text3">Reason * — {rejecting.userName} sees it on the row</span>
              <textarea
                className="innovic-textarea"
                aria-label="Reason"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          }
          confirmLabel="✗ Reject"
          pendingLabel="Rejecting…"
          tone="danger"
          errorText={rejectErr}
          elevated={false}
          onCancel={() => setRejecting(null)}
          onConfirm={doReject}
        />
      ) : null}
    </div>
  );
}
