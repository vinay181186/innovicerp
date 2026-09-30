// Cancel Dispatch — asks for the reason before reversing a dispatch (ADR-197:
// a Cancel is refused without one). Same shape as the Production Order Short
// Close dialog: a required Reason box, the button stays off until it is typed,
// and a server error is shown inside the dialog instead of closing it.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/ui/feedback';
import { useCancelDispatch } from '../api';

export function CancelDispatchModal({
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
  const cancel = useCancelDispatch();
  const trimmed = reason.trim();

  const onSubmit = (): void => {
    setErr(null);
    if (!trimmed) {
      setErr('Reason is required.');
      return;
    }
    cancel.mutate(
      { id, reason: trimmed },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not cancel this dispatch. Try again.'),
      },
    );
  };

  return (
    <Modal
      title={`Cancel Dispatch ${code}?`}
      size="sm"
      onClose={() => {
        if (!cancel.isPending) onClose();
      }}
      closeOnOverlayClick={false}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={cancel.isPending}
          >
            Keep
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onSubmit}
            disabled={!trimmed || cancel.isPending}
            title={!trimmed ? 'Type the reason first' : 'Cancel this dispatch'}
          >
            {cancel.isPending ? <Loader2 size={14} className="animate-spin" /> : null}{' '}
            {cancel.isPending ? 'Cancelling…' : 'Cancel Dispatch'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
        Stock will be reversed.
      </div>

      <div className="form-grp" style={{ marginTop: 14 }}>
        <label className="form-label" htmlFor="dispatch-cancel-reason">
          Reason<span className="req">★</span>
        </label>
        <textarea
          id="dispatch-cancel-reason"
          className="innovic-input"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this dispatch being cancelled?"
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
