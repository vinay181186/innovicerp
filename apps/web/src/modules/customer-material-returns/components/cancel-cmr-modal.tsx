// Cancel Customer Material Return (ADR-203) — reverses every line: good
// material goes back onto the customer-material register, rejected pieces go
// back to "held" on their Party GRN line. A reason is required and stored on
// the return. Same recipe as the Party GRN / JW Return cancel modals.

import type { CustomerMaterialReturn } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useCancelCustomerMaterialReturn } from '../api';

export function CancelCmrModal({
  row,
  onClose,
}: {
  row: CustomerMaterialReturn;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cancelMut = useCancelCustomerMaterialReturn();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the cancelled return.');
      return;
    }
    cancelMut.mutate(
      { id: row.id, reason: reason.trim() },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not cancel the return. Try again.'),
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
          ⚠ Cancel {row.code}
        </div>
        <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          Brings <b style={{ color: 'var(--green2)' }}>{row.totalQty}</b> back into the store for{' '}
          <b>{row.jwCode ?? 'this JWSO'}</b>: good material returns to the customer-material
          register, rejected pieces go back to held on their Party GRN. Cannot be undone.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="cmr-cancel-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="cmr-cancel-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. entered twice by mistake"
            maxLength={500}
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
            Keep it
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={cancelMut.isPending}
            onClick={onConfirm}
          >
            {cancelMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Cancelling…
              </>
            ) : (
              'Cancel Return'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
