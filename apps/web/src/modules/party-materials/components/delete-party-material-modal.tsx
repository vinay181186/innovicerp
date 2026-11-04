// Delete a Party Material (ADR-197) — asks for the reason, which is stored on
// the activity log row. Same shape as the JWSO Move-to-Trash and JW Return
// cancel modals. A row with stock on hand never gets here (its Delete is off).

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/ui/feedback';
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
            e instanceof Error ? e.message : 'Could not delete the Customer Material. Try again.',
          ),
      },
    );
  };

  return (
    <Modal
      title={`⚠ Delete Customer Material ${code}?`}
      onClose={onClose}
      maxWidth="min(520px, 94vw)"
      footer={
        <>
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
        </>
      }
    >
      <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
        {name} will be removed from the Customer Material Master.
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
    </Modal>
  );
}
