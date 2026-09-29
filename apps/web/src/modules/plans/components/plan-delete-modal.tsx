// Move a plan to Trash — asks for the reason first (ADR-197: a Delete is
// refused without one). Same shape as the Production Order Short Close dialog:
// a required Reason box, the button stays off until it is typed, and a server
// refusal (e.g. "has Production Order(s)") is shown inside the dialog.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/ui/feedback';
import { useSoftDeletePlan } from '../api';

export function PlanDeleteModal({
  id,
  code,
  onClose,
  onDeleted,
}: {
  id: string;
  code: string;
  onClose: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const softDelete = useSoftDeletePlan();
  const trimmed = reason.trim();

  const onSubmit = (): void => {
    setErr(null);
    if (!trimmed) {
      setErr('Reason is required.');
      return;
    }
    softDelete.mutate(
      { id, reason: trimmed },
      {
        onSuccess: () => onDeleted(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not move this plan to Trash. Try again.'),
      },
    );
  };

  return (
    <Modal
      title={`Move Plan ${code} to Trash?`}
      size="sm"
      onClose={() => {
        if (!softDelete.isPending) onClose();
      }}
      closeOnOverlayClick={false}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={softDelete.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onSubmit}
            disabled={!trimmed || softDelete.isPending}
            title={!trimmed ? 'Type the reason first' : 'Move this plan to Trash'}
          >
            {softDelete.isPending ? <Loader2 size={14} className="animate-spin" /> : null}{' '}
            {softDelete.isPending ? 'Moving to Trash…' : 'Move to Trash'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
        You can restore it from Trash.
      </div>

      <div className="form-grp" style={{ marginTop: 14 }}>
        <label className="form-label" htmlFor="plan-delete-reason">
          Reason<span className="req">★</span>
        </label>
        <textarea
          id="plan-delete-reason"
          className="innovic-input"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this plan being deleted?"
        />
      </div>

      {err ? (
        <div role="alert" className="form-error" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
