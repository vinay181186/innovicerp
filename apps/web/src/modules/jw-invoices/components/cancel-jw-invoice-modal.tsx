// Cancel JW Invoice (R5, ADR-194) — reverses the billed qty off the JWSO line
// so it can be re-billed, and marks the invoice cancelled (it never prints as a
// live tax document again). A reason is required and stored on the invoice.
// Modelled on the Party GRN cancel modal so both cancel flows read alike.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useCancelJwInvoice } from '../api';

export function CancelJwInvoiceModal({
  id,
  code,
  onClose,
}: {
  id: string;
  code: string;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cancelMut = useCancelJwInvoice();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the cancelled invoice.');
      return;
    }
    cancelMut.mutate(
      { id, reason: reason.trim() },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not cancel the invoice. Try again.'),
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
          ⚠ Cancel {code}
        </div>
        <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          Reverses the billed qty on the JWSO line so it can be invoiced again. The invoice stays on
          record marked <b style={{ color: 'var(--red2)' }}>Cancelled</b> and no longer prints as a
          live tax document.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="jwinv-cancel-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="jwinv-cancel-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong qty billed"
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
              'Cancel Invoice'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
