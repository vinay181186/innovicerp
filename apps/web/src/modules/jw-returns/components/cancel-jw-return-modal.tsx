// Cancel JW Return Challan (R10, ADR-194) — reverses returned_qty so the goods
// can be returned again. Blocked server-side while an uncancelled JW invoice
// still covers the returned qty. A reason is required and stored on the challan.
// Modelled on the Party GRN / JW Invoice cancel modals so all three read alike.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useCancelJwReturn } from '../api';

export function CancelJwReturnModal({
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
  const cancelMut = useCancelJwReturn();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the cancelled return.');
      return;
    }
    cancelMut.mutate(
      { id, reason: reason.trim() },
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
          ⚠ Cancel {code}
        </div>
        <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          The returned qty goes back to Pending on the JWSO line. Refused if an uncancelled JW
          invoice still covers it.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="jwret-cancel-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="jwret-cancel-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. dispatched against the wrong line"
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
