// One Item Issue slip: its lines with Issue Qty / Returned / Still Out, plus the
// two ways back — Return (leftovers, any qty up to Still Out, the slip stays) and
// Reverse (the whole slip, only while nothing was returned from it).
import { ISSUE_AGAINST_LABELS, STORE_ISSUE_REVERSE_REASON_MIN } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { fmtDate } from '@/lib/date';
import { Panel } from '@/ui/data';
import { useReturnStoreIssue, useReverseStoreIssue, useStoreIssue } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

type Mode = 'view' | 'return' | 'reverse';

export function IssueViewModal({
  issueId,
  canReturn,
  canReverse,
  onClose,
}: {
  issueId: string;
  canReturn: boolean;
  canReverse: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { data: iss, isLoading, isError, error } = useStoreIssue(issueId);
  const [mode, setMode] = useState<Mode>('view');
  const [retQty, setRetQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const returnMut = useReturnStoreIssue();
  const reverseMut = useReverseStoreIssue();

  const anyReturned = (iss?.lines ?? []).some((l) => l.returnedQty > 0);
  const anyUnused = (iss?.lines ?? []).some((l) => l.qty - l.returnedQty > 0);
  const busy = returnMut.isPending || reverseMut.isPending;

  const start = (m: Mode): void => {
    setMode(m);
    setErr(null);
    setMsg(null);
    setReason('');
    setRetQty({});
  };

  const doReturn = (): void => {
    if (!iss) return;
    setErr(null);
    const lines: Array<{ issueLineId: string; qty: number }> = [];
    for (const l of iss.lines) {
      const t = (retQty[l.id] ?? '').trim();
      if (!t) continue;
      const q = Number(t);
      const unused = r3(l.qty - l.returnedQty);
      if (!Number.isFinite(q) || q <= 0)
        return setErr(`${l.itemCode}: Return Qty must be more than 0.`);
      if (r3(q) !== q) return setErr(`${l.itemCode}: Return Qty allows at most 3 decimals.`);
      if (q > unused)
        return setErr(`${l.itemCode}: only ${unused} is still out — cannot return ${q}.`);
      lines.push({ issueLineId: l.id, qty: q });
    }
    if (lines.length === 0) return setErr('Enter a Return Qty on at least one line.');
    if (reason.trim().length < STORE_ISSUE_REVERSE_REASON_MIN)
      return setErr(`Give a reason (at least ${STORE_ISSUE_REVERSE_REASON_MIN} characters).`);
    returnMut.mutate(
      { id: iss.id, lines, reason: reason.trim() },
      {
        onSuccess: () => {
          setMode('view');
          setMsg('Returned — stock updated.');
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not return. Try again.'),
      },
    );
  };

  const doReverse = (): void => {
    if (!iss) return;
    setErr(null);
    if (reason.trim().length < STORE_ISSUE_REVERSE_REASON_MIN)
      return setErr(`Give a reason (at least ${STORE_ISSUE_REVERSE_REASON_MIN} characters).`);
    reverseMut.mutate(
      { id: iss.id, reason: reason.trim() },
      {
        onSuccess: () => {
          setMode('view');
          setMsg('Reversed — every line is back in stock.');
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not reverse. Try again.'),
      },
    );
  };

  const ref = iss
    ? iss.issueAgainst === 'job_card'
      ? iss.jobCardCode
      : iss.issueAgainst === 'assembly_so'
        ? iss.salesOrderCode
        : (iss.department ?? iss.legacyReference)
    : null;

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 860, width: '96vw' }}>
        <div className="modal-hdr">
          <span className="modal-title">Item Issue {iss?.code ?? ''}</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {isLoading ? (
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          ) : isError || !iss ? (
            <div style={{ color: 'var(--red2)', fontSize: 12 }}>
              {error instanceof Error ? error.message : 'Could not load the issue.'}
            </div>
          ) : (
            <>
              <div
                className="text2"
                style={{ fontSize: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}
              >
                <span>
                  Issue Date <b>{fmtDate(iss.issueDate)}</b>
                </span>
                <span>
                  {ISSUE_AGAINST_LABELS[iss.issueAgainst]} <b className="mono">{ref || '—'}</b>
                </span>
                <span>
                  Issued To <b>{iss.issuedTo || '—'}</b>
                </span>
                <span>
                  Purpose <b>{iss.purpose || '—'}</b>
                </span>
                <span>
                  Issued By <b>{iss.issuedByName || '—'}</b>
                </span>
              </div>
              {iss.reversedAt ? (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>
                  Reversed {fmtDate(iss.reversedAt.slice(0, 10))} — {iss.reversalReason ?? ''}
                </div>
              ) : null}

              <div className="tbl-wrap" style={{ marginTop: 10 }}>
                <table className="innovic-table tbl-grid">
                  <thead>
                    <tr>
                      <th>Item Code</th>
                      <th>Item Name</th>
                      <th>UOM</th>
                      <th className="th-num">Issue Qty</th>
                      <th className="th-num">Returned</th>
                      <th className="th-num">Still Out</th>
                      {mode === 'return' ? <th className="th-num">Return Qty</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {iss.lines.map((l) => {
                      const unused = r3(l.qty - l.returnedQty);
                      return (
                        <tr key={l.id}>
                          <td>
                            <span className="td-code mono fw-700" style={{ color: 'var(--text)' }}>
                              {l.itemCode}
                            </span>
                          </td>
                          <td>{l.itemName || '—'}</td>
                          <td className="text3">{l.uom || '—'}</td>
                          <td
                            className="mono fw-700 td-num"
                            style={{
                              textDecoration: iss.reversedAt ? 'line-through' : undefined,
                            }}
                          >
                            {r3(l.qty)}
                          </td>
                          <td className="mono td-num">{r3(l.returnedQty)}</td>
                          <td className="mono td-num">{iss.reversedAt ? 0 : unused}</td>
                          {mode === 'return' ? (
                            <td className="td-num">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                className="innovic-input mono"
                                style={{ width: 100, textAlign: 'right' }}
                                disabled={unused <= 0}
                                value={retQty[l.id] ?? ''}
                                onChange={(e) =>
                                  setRetQty((s) => ({ ...s, [l.id]: e.target.value }))
                                }
                                onWheel={(e) => e.currentTarget.blur()}
                                aria-label={`Return Qty for ${l.itemCode}`}
                              />
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {mode !== 'view' ? (
                <div className="form-grp form-full" style={{ marginTop: 10 }}>
                  <label className="form-label">Reason ★</label>
                  <input
                    type="text"
                    className="innovic-input"
                    placeholder={
                      mode === 'return'
                        ? 'e.g. 2 pcs left over after the job'
                        : 'e.g. issued against the wrong job card'
                    }
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  {mode === 'reverse' ? (
                    <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                      Puts every line back into stock with an opposite entry. The slip stays on the
                      register, marked Reversed. This cannot be undone.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <Panel title="History" bodyPadding="none">
                    <DocumentHistory entity="StoreIssue" entityId={iss.id} refId={iss.code} />
                  </Panel>
                </div>
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
              {iss && !iss.reversedAt && canReverse && !anyReturned ? (
                <button type="button" className="btn btn-ghost" onClick={() => start('reverse')}>
                  Reverse
                </button>
              ) : null}
              {iss && !iss.reversedAt && canReturn && anyUnused ? (
                <button type="button" className="btn btn-primary" onClick={() => start('return')}>
                  Return
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => start('view')}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={mode === 'return' ? doReturn : doReverse}
              >
                {busy ? (
                  <>
                    <Loader2 size={14} className="inline animate-spin" /> Saving…
                  </>
                ) : mode === 'return' ? (
                  'Save Return'
                ) : (
                  'Reverse'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
