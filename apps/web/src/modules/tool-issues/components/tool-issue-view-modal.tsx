// One tool issue: what went out, what came back, and the two actions —
// Return (bulk: Good / Damaged / Lost / Consumed; serial: a condition per
// instrument) and Cancel (only while nothing was returned). Damaged and Lost
// need a reason and wait for the Store In-charge's write-off decision. Cancel is
// the ONE standard Cancel (ADR-235): the caller opens CancelDocDialog; while a
// request waits for approval the orange "Cancel requested" banner shows here.
import { type InstrumentReturnCondition, type ToolIssueDetail } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { fmtDate } from '@/lib/date';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { Panel } from '@/ui/data';
import { useToolIssue } from '../api';
import { ReturnForm } from './tool-return-form';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
type Mode = 'view' | 'return';
const CONDITION_LABELS: Record<InstrumentReturnCondition, string> = {
  good: 'Good',
  damaged: 'Damaged',
  lost: 'Lost',
};

export function ToolIssueViewModal({
  id,
  canReturn,
  canCancelIssue,
  onCancel,
  onClose,
}: {
  id: string;
  /** toolissue_create advance — Record Return moves the issue on (ADR-231). */
  canReturn: boolean;
  /** toolissue_create Edit OR Approve (ADR-235) — Edit requests, Approve decides. */
  canCancelIssue: boolean;
  /** Opens the standard Cancel dialog for this issue (the caller owns it). */
  onCancel: (t: { id: string; code: string }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { data: t, isLoading, isError, error } = useToolIssue(id);
  const [mode, setMode] = useState<Mode>('view');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const open = t && !t.cancelledAt && t.stillOutQty > 0;
  // State, not permission: nothing returned yet and not already cancelled.
  const cancellable = t && !t.cancelledAt && t.returns.length === 0;

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
              {!t.cancelledAt ? (
                <div style={{ marginTop: 8 }}>
                  <CancelPendingBanner
                    docType="tool_issue"
                    docId={t.id}
                    cancelled={false}
                    {...(canCancelIssue ? { onOpen: () => onCancel(t) } : {})}
                  />
                </div>
              ) : null}
              {mode === 'return' ? (
                <ReturnForm
                  t={t}
                  onDone={(m) => {
                    setMode('view');
                    setMsg(m);
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
              {canCancelIssue && cancellable && t ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ color: 'var(--red2)' }}
                  onClick={() => onCancel(t)}
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
