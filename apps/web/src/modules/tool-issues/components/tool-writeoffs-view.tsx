// Tool write-offs (ADR-193 phase 4b, owner decision Q4): Damaged / Lost from
// a return, or Scrap of an in-store instrument, wait here for the Store
// In-charge (approve tier). The person who recorded one cannot decide it.
// Approve → the tool is written off; Reject → Damaged goes back to stock as
// Good, Lost goes back to "still with the operator".
import {
  type ToolWriteoffKind,
  type ToolWriteoffRow,
  type ToolWriteoffStatus,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { useSession } from '@/lib/session';
import { useDecideToolWriteoff, useToolWriteoffs } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const KIND_LABELS: Record<ToolWriteoffKind, string> = {
  damaged: 'Damaged',
  lost: 'Lost',
  scrap: 'Scrap',
};
const STATUS_LABELS: Record<ToolWriteoffStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function ToolWriteoffsView({ canDecide }: { canDecide: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<ToolWriteoffStatus | ''>('pending');
  const { data, isLoading, isError, error } = useToolWriteoffs(
    { ...(status ? { status } : {}), limit: 100, offset: 0 },
    true,
  );
  const [deciding, setDeciding] = useState<ToolWriteoffRow | null>(null);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <select
          className="innovic-select"
          aria-label="Write-off Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ToolWriteoffStatus | '')}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      <div className="panel">
        {isLoading ? (
          <div className="panel-body text3" style={{ fontSize: 12 }}>
            <Loader2 size={14} className="inline animate-spin" /> Loading…
          </div>
        ) : isError || !data ? (
          <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load write-offs.'}
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table tbl-grid">
              <thead>
                <tr>
                  <th>Write-off Kind</th>
                  <th>Item Code</th>
                  <th>Instrument Serial No.</th>
                  <th className="th-num">Write-off Qty</th>
                  <th>Issue No.</th>
                  <th>Issued To</th>
                  <th>Reason</th>
                  <th>Requested By</th>
                  <th>Write-off Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((w) => (
                  <tr key={w.id}>
                    <td>{KIND_LABELS[w.kind]}</td>
                    <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                      {w.itemCode}
                    </td>
                    <td className="mono">{w.serialNo || '—'}</td>
                    <td className="mono td-num">{r3(w.qty)}</td>
                    <td className="td-code">{w.toolIssueCode || '—'}</td>
                    <td>{w.holder || '—'}</td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {w.reason}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {w.requestedByName || '—'}
                      <div className="text3">{fmtDate(w.requestedAt.slice(0, 10))}</div>
                    </td>
                    <td>
                      {STATUS_LABELS[w.status]}
                      {w.decidedByName ? (
                        <div className="text3" style={{ fontSize: 11 }}>
                          {w.decidedByName}
                          {w.decisionRemarks ? ` — ${w.decisionRemarks}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {canDecide && w.status === 'pending' ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setDeciding(w)}
                        >
                          Decide
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-state">
                      No write-offs here.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {deciding ? <DecideModal w={deciding} onClose={() => setDeciding(null)} /> : null}
    </div>
  );
}

function DecideModal({
  w,
  onClose,
}: {
  w: ToolWriteoffRow;
  onClose: () => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useDecideToolWriteoff();
  const own = me?.id === w.requestedBy;
  const decide = (decision: 'approve' | 'reject'): void => {
    setErr(null);
    mut.mutate(
      { id: w.id, decision, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) },
      { onSuccess: onClose, onError: (e) => setErr(e.message || 'Could not save the decision.') },
    );
  };
  const rejectMeans =
    w.kind === 'damaged'
      ? 'Reject = it goes back to stock as Good.'
      : w.kind === 'lost'
        ? 'Reject = it is still with the holder (Still Out again).'
        : 'Reject = the instrument stays in store.';
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">
            Write-off — {w.itemCode}
            {w.serialNo ? ` · ${w.serialNo}` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="text2" style={{ fontSize: 12, marginBottom: 8 }}>
            {KIND_LABELS[w.kind]} · qty {r3(w.qty)} · reason: {w.reason}
          </div>
          <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
            Approve = written off. {rejectMeans}
          </div>
          {own ? (
            <div style={{ color: 'var(--amber2)', fontSize: 12, marginBottom: 8 }}>
              You recorded this write-off — another Store In-charge must decide it.
            </div>
          ) : null}
          <input
            type="text"
            className="innovic-input"
            placeholder="Remarks (optional)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          {err ? (
            <div style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>{err}</div>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={own || mut.isPending}
            onClick={() => decide('reject')}
          >
            Reject
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={own || mut.isPending}
            onClick={() => decide('approve')}
          >
            Approve Write-off
          </button>
        </div>
      </div>
    </div>
  );
}
