// Move a JWSO to Trash (ADR-197) — asks for the reason, which is stored on the
// JWSO's History row. Modelled on the JW Return / Party GRN cancel modals so the
// reason-required dialogs of the job-work chain read alike.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/ui/feedback';
import { useSoftDeleteJobWorkOrder } from '../api';

export function DeleteJwsoModal({
  id,
  code,
  onClose,
  onDeleted,
}: {
  id: string;
  code: string;
  onClose: () => void;
  /** Runs after the JWSO is in Trash (the detail page navigates away). */
  onDeleted?: (() => void) | undefined;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const deleteMut = useSoftDeleteJobWorkOrder();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the JWSO History.');
      return;
    }
    deleteMut.mutate(
      { id, reason: reason.trim() },
      {
        onSuccess: () => {
          onClose();
          onDeleted?.();
        },
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not move the JWSO to Trash. Try again.'),
      },
    );
  };

  return (
    <Modal
      title={<>⚠ Move JWSO {code} to Trash?</>}
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
                <Loader2 size={14} className="inline animate-spin" /> Moving to Trash…
              </>
            ) : (
              'Move to Trash'
            )}
          </button>
        </>
      }
    >
      <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
        You can restore it from Trash.
      </div>
      <div className="form-grp">
        <label className="form-label" htmlFor="jwso-delete-reason">
          Reason<span className="req">★</span>
        </label>
        <input
          id="jwso-delete-reason"
          type="text"
          className="innovic-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. entered twice, customer withdrew the order"
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
