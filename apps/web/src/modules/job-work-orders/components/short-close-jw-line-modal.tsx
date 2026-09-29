// Short-close ONE JWSO line (R6, ADR-194) — close the line with its balance
// left unmet (the customer will not send / take the rest). Status stays
// 'closed'; the unmet balance + reason are stamped on the line. A reason is
// required. Modelled on the other JWSO cancel modals so they all read alike.

import type { JobWorkOrderLine } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useShortCloseJobWorkOrderLine } from '../api';

export function ShortCloseJwLineModal({
  jwId,
  line,
  onClose,
}: {
  jwId: string;
  line: JobWorkOrderLine;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useShortCloseJobWorkOrderLine(jwId);
  const balance = Math.max(0, line.orderQty - line.returnedQty);

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the short-closed line.');
      return;
    }
    mut.mutate(
      { lineId: line.id, reason: reason.trim() },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not short-close the line. Try again.'),
      },
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(520px, 94vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>
          ⚠ Short-close L{line.lineNo} — {line.partName}
        </div>
        <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          Closes this line with{' '}
          <b style={{ color: 'var(--amber2)' }}>{balance}</b> of{' '}
          <b>{line.orderQty}</b> still unmet. The line is marked{' '}
          <b>Short-closed</b> and takes no more work.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="jwline-sc-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="jwline-sc-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer cancelled the balance"
            autoFocus
          />
        </div>
        {err ? (
          <div
            style={{
              marginTop: 12,
              color: 'var(--red2)',
              background: 'var(--red3)',
              border: '1px solid var(--red)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Keep it open
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={mut.isPending}
            onClick={onConfirm}
          >
            {mut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Short-closing…
              </>
            ) : (
              'Short-close Line'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
