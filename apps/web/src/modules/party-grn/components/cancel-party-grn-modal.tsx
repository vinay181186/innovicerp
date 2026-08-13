// Cancel Party GRN (ADR-102) — reverses the receipt off party-material stock.
// Split out of routes/list.tsx (969 lines, over the 400-line rule).
//
// Styling only: overlay z-index 100 → 200 to match the SO Master dialogs, the
// hand-rolled label swapped for `.form-grp`/`.form-label`/`.req`, and the error
// box moved to SO Master's recipe. The reason check, the mutation call and every
// word of copy are unchanged.

import type { PartyGrnListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useCancelPartyGrn } from '../api';

export function CancelPartyGrnModal({
  row,
  onClose,
}: {
  row: PartyGrnListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cancelMut = useCancelPartyGrn();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the cancelled GRN.');
      return;
    }
    cancelMut.mutate(
      { id: row.id, reason: reason.trim() },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to cancel'),
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
          This takes <b style={{ color: 'var(--green)' }}>{row.totalReceivedQty}</b> back off party
          material stock for <b>{row.jwCodeText ?? 'this JWSO'}</b>, and lowers how much production
          that JWSO line is allowed to start. It cannot be undone.
          <br />
          If some of this material has already been issued to a Job Card, the cancel will be
          refused — reverse the issue first.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="pgrn-cancel-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="pgrn-cancel-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. entered twice by mistake"
            autoFocus
          />
        </div>
        {err ? (
          <div
            style={{
              marginTop: 12,
              color: 'var(--red)',
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
              'Cancel GRN'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
