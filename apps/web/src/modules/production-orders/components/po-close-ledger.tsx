// The close ledger (ADR-179): every partial close and every reversal, newest
// first. Each real close can be REVERSED — that writes a compensating stock-out
// and a reversal row (never deletes). The server refuses a reversal when the
// pieces have already been dispatched; that message flows back to the toast/
// error line here. A reversal row is shown as "Reversal of …" and cannot itself
// be reversed; a close already undone by a reversal offers no Reverse button.

import type { ProductionOrderClose, ProductionOrderDetail } from '@innovic/shared';
import { Loader2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { useReverseProductionOrderClose } from '../api';

interface PoCloseLedgerProps {
  po: ProductionOrderDetail;
  /** True when the user may reverse a close (same edit gate as close). */
  canReverse: boolean;
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function PoCloseLedger({ po, canReverse }: PoCloseLedgerProps): React.JSX.Element {
  const reverseMut = useReverseProductionOrderClose();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Which original closes have already been undone → no Reverse button for them.
  const reversedIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of po.closes) if (c.isReversal && c.reversesCloseId) s.add(c.reversesCloseId);
    return s;
  }, [po.closes]);

  // For a reversal row, describe the close it undoes.
  const byId = useMemo(() => {
    const m = new Map<string, ProductionOrderClose>();
    for (const c of po.closes) m.set(c.id, c);
    return m;
  }, [po.closes]);

  const onReverse = (closeId: string): void => {
    setError(null);
    reverseMut.mutate(
      { id: po.id, input: { closeId, ...(reason.trim() ? { remarks: reason.trim() } : {}) } },
      {
        onSuccess: () => {
          setOpenId(null);
          setReason('');
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'Reversal failed.'),
      },
    );
  };

  if (po.closes.length === 0) {
    return (
      <div className="empty-state" style={{ fontSize: 12 }}>
        Nothing closed yet.
      </div>
    );
  }

  return (
    <div>
      {error ? (
        <div
          role="alert"
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Meta band — whose pieces these closes belong to. POL is the line
          number printed on the CUSTOMER's own purchase order, shown before the
          item code; '—' when no sales order sits behind this order. */}
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text3)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <span>
          POL{' '}
          <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
            {po.clientPoLineNo ?? '—'}
          </span>
        </span>
        <span>·</span>
        <span className="td-code" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(po.itemCodeText, po.itemRevision)}
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Qty</th>
              <th>By</th>
              <th>Note</th>
              <th>Reversal?</th>
              {canReverse ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {po.closes.map((c) => {
              const reversedOriginal =
                c.isReversal && c.reversesCloseId ? byId.get(c.reversesCloseId) : undefined;
              const alreadyReversed = reversedIds.has(c.id);
              const showReverse = canReverse && !c.isReversal && !alreadyReversed;
              return (
                <tr key={c.id}>
                  <td className="mono">{fmtDate(c.closedAt)}</td>
                  <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                    {c.isReversal ? `−${c.qty}` : c.qty}
                    {c.lostQty ? (
                      <span className="text3" style={{ fontSize: 11 }}>
                        {' '}
                        (+{c.lostQty} lost)
                      </span>
                    ) : null}
                  </td>
                  <td>{c.closedByName ?? '—'}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span title={c.remarks ?? undefined}>{c.remarks ?? '—'}</span>
                  </td>
                  <td>
                    {c.isReversal ? (
                      <span className="badge b-red" title="Reverses an earlier close">
                        Reversal
                        {reversedOriginal ? ` of ${reversedOriginal.qty}` : ''}
                      </span>
                    ) : alreadyReversed ? (
                      <span className="badge b-grey">reversed</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  {canReverse ? (
                    <td>
                      {showReverse ? (
                        openId === c.id ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: 6,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <input
                              className="innovic-input"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Reason (optional)"
                              style={{ width: 160, fontSize: 12 }}
                            />
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={reverseMut.isPending}
                              onClick={() => onReverse(c.id)}
                            >
                              {reverseMut.isPending ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                'Confirm'
                              )}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={reverseMut.isPending}
                              onClick={() => {
                                setOpenId(null);
                                setReason('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setOpenId(c.id);
                              setReason('');
                              setError(null);
                            }}
                            title="Undo this close (blocked if the pieces are already dispatched)"
                          >
                            <Undo2 size={12} /> Reverse
                          </button>
                        )
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
