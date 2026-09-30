// One tool issue: what went out, what came back, and the two actions —
// Return (bulk: Good / Damaged / Lost / Consumed; serial: a condition per
// instrument) and Cancel (only while nothing was returned). Damaged and Lost
// need a reason and wait for the Store In-charge's write-off decision.
import {
  type InstrumentReturnCondition,
  TOOL_REASON_MIN,
  type ToolIssueDetail,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { fmtDate } from '@/lib/date';
import { Panel } from '@/ui/data';
import { useCancelToolIssue, useToolIssue } from '../api';
import { ReturnForm } from './tool-return-form';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
type Mode = 'view' | 'return' | 'cancel';
const CONDITION_LABELS: Record<InstrumentReturnCondition, string> = {
  good: 'Good',
  damaged: 'Damaged',
  lost: 'Lost',
};

export function ToolIssueViewModal({
  id,
  canReturn,
  onClose,
}: {
  id: string;
  canReturn: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { data: t, isLoading, isError, error } = useToolIssue(id);
  const [mode, setMode] = useState<Mode>('view');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const open = t && !t.cancelledAt && t.stillOutQty > 0;
  const canCancel = t && !t.cancelledAt && t.returns.length === 0;

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 820, width: '96vw' }}>
        <div className="modal-hdr">
          <span className="modal-title">Tool Issue {t?.code ?? ''}</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {isLoading ? (
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          ) : isError || !t ? (
            <div style={{ color: 'var(--red2)', fontSize: 12 }}>
              {error instanceof Error ? error.message : 'Could not load the tool issue.'}
            </div>
          ) : (
            <>
              <Facts t={t} />
              {mode === 'return' ? (
                <ReturnForm
                  t={t}
                  onDone={(m) => {
                    setMode('view');
                    setMsg(m);
                  }}
                  onError={setErr}
                />
              ) : mode === 'cancel' ? (
                <CancelForm
                  t={t}
                  onDone={() => {
                    setMode('view');
                    setMsg('Cancelled — the tool is back in stock.');
                  }}
                  onError={setErr}
                />
              ) : (
                <>
                  <History t={t} />
                  <div style={{ marginTop: 10 }}>
                    <Panel title="History" bodyPadding="none">
                      <DocumentHistory entity="ToolIssue" entityId={t.id} refId={t.code} />
                    </Panel>
                  </div>
                </>
              )}
              {msg ? (
                <div className="text2" style={{ marginTop: 10, fontSize: 12 }}>
                  ✓ {msg}
                </div>
              ) : null}
              {err ? (
                <div style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>{err}</div>
              ) : null}
            </>
          )}
        </div>
        <div className="modal-footer">
          {mode === 'view' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
              {canReturn && canCancel ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setErr(null);
                    setMode('cancel');
                  }}
                >
                  Cancel Issue
                </button>
              ) : null}
              {canReturn && open ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setErr(null);
                    setMsg(null);
                    setMode('return');
                  }}
                >
                  Record Return
                </button>
              ) : null}
            </>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>
              Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Facts({ t }: { t: ToolIssueDetail }): React.JSX.Element {
  return (
    <div className="text2" style={{ fontSize: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
      <span>
        Item Code{' '}
        <b className="mono" style={{ color: 'var(--text)' }}>
          {t.itemCode ?? '—'}
        </b>
      </span>
      <span>
        Issue Qty <b className="mono">{r3(t.qty)}</b>
      </span>
      <span>
        Issued To <b>{t.issuedTo || '—'}</b>
      </span>
      <span>
        Issue Date <b>{fmtDate(t.issueDate)}</b>
      </span>
      <span>
        Expected Return <b>{t.expectedReturnDate ? fmtDate(t.expectedReturnDate) : '—'}</b>
      </span>
      {t.jobCardCode ? (
        <span>
          Job Card <b className="mono">{t.jobCardCode}</b>
        </span>
      ) : null}
      <span>
        Still Out <b className="mono">{r3(t.stillOutQty)}</b>
      </span>
      {t.writeoffPendingQty > 0 ? (
        <span style={{ color: 'var(--amber2)' }}>
          Write-off pending <b className="mono">{r3(t.writeoffPendingQty)}</b>
        </span>
      ) : null}
      {t.cancelledAt ? (
        <span style={{ color: 'var(--red)' }}>
          Cancelled {fmtDate(t.cancelledAt.slice(0, 10))} — {t.cancelReason ?? ''}
        </span>
      ) : null}
    </div>
  );
}

function History({ t }: { t: ToolIssueDetail }): React.JSX.Element {
  return (
    <>
      {t.instruments.length > 0 ? (
        <div className="tbl-wrap" style={{ marginTop: 10 }}>
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>Instrument Serial No.</th>
                <th>Returned On</th>
                <th>Return Condition</th>
              </tr>
            </thead>
            <tbody>
              {t.instruments.map((i) => (
                <tr key={i.instrumentId}>
                  <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                    {i.serialNo}
                  </td>
                  <td>{i.returnedOn ? fmtDate(i.returnedOn) : '— still out'}</td>
                  <td>{i.returnCondition ? CONDITION_LABELS[i.returnCondition] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="tbl-wrap" style={{ marginTop: 10 }}>
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Return Date</th>
              <th className="th-num">Good</th>
              <th className="th-num">Damaged</th>
              <th className="th-num">Lost</th>
              <th className="th-num">Consumed</th>
              <th>Reason</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>
            {t.returns.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.returnDate)}</td>
                <td className="mono td-num">{r3(r.goodQty)}</td>
                <td className="mono td-num">{r3(r.damagedQty)}</td>
                <td className="mono td-num">{r3(r.lostQty)}</td>
                <td className="mono td-num">{r3(r.consumedQty)}</td>
                <td className="text3">{r.reason || '—'}</td>
                <td>{r.recordedByName || '—'}</td>
              </tr>
            ))}
            {t.returns.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  Nothing returned yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CancelForm({
  t,
  onDone,
  onError,
}: {
  t: ToolIssueDetail;
  onDone: () => void;
  onError: (m: string | null) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const mut = useCancelToolIssue();
  const save = (): void => {
    onError(null);
    if (reason.trim().length < TOOL_REASON_MIN)
      return onError(`Give a reason (at least ${TOOL_REASON_MIN} characters).`);
    mut.mutate(
      { id: t.id, reason: reason.trim() },
      { onSuccess: onDone, onError: (e) => onError(e.message || 'Could not cancel.') },
    );
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="text2" style={{ fontSize: 12, marginBottom: 8 }}>
        Puts the tool back in stock with an opposite entry. The issue stays on the register, marked
        Cancelled.
      </div>
      <input
        type="text"
        className="innovic-input"
        placeholder="Reason, e.g. issued to the wrong operator"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-primary" disabled={mut.isPending} onClick={save}>
          Cancel Issue
        </button>
      </div>
    </div>
  );
}
