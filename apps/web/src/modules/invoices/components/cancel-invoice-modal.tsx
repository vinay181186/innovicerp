// Cancel Invoice (ADR-202 Phase 3) — an invoice is a statutory document, so it is
// never edited or renumbered. A correction is a reason-logged CANCEL (blocked once
// any payment exists) that keeps the INV-#### series intact, mirroring the JW
// invoice cancel. The reason is required and stored on the cancelled invoice.
// Modelled on cancel-jw-invoice-modal.tsx so both cancel flows read alike.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useCancelInvoice } from '../api';

export function CancelInvoiceModal({
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
  const cancelMut = useCancelInvoice(id);

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the cancelled invoice.');
      return;
    }
    cancelMut.mutate(
      { reason: reason.trim() },
      {
        // The hook invalidates the invoice detail, so the page refreshes itself
        // into the cancelled state once this resolves.
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
          The invoice stays on record marked{' '}
          <b style={{ color: 'var(--red2)' }}>Cancelled</b> and no longer prints as a live tax
          document. Its number is not reused — raise a fresh invoice to re-bill.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="inv-cancel-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="inv-cancel-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong amount billed"
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
