// Delete a Party Material (ADR-197) — asks for the reason, which is stored on
// the activity log row. Same shape as the JWSO Move-to-Trash and JW Return
// cancel modals. A row with stock on hand never gets here (its Delete is off).

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useDeletePartyMaterial } from '../api';

export function DeletePartyMaterialModal({
  id,
  code,
  name,
  onClose,
}: {
  id: string;
  code: string;
  name: string;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const deleteMut = useDeletePartyMaterial();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the activity log.');
      return;
    }
    deleteMut.mutate(
      { id, reason: reason.trim() },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(
            e instanceof Error ? e.message : 'Could not delete the Party Material. Try again.',
          ),
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
          ⚠ Delete Party Material {code}?
        </div>
        <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          {name} will be removed from the Party Material Master.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="pm-delete-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="pm-delete-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. created twice, wrong customer"
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
            disabled={deleteMut.isPending}
            onClick={onConfirm}
          >
            {deleteMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Deleting…
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
