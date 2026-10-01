// Op Entry approval — the Reject reason popup (ADR-199 decision: a reject reason
// is captured in a small dialog, not an inline cell on the row). Built on the
// shared Modal so it sits on the app's z-index ladder and traps focus like every
// other dialog. Reject stays disabled until a reason is typed; the dialog shows
// its own pending / error state while the mutation is in flight.

import { useState } from 'react';
import { opSrNo, type OpLogTimeChangeRequest } from '@innovic/shared';
import { Button } from '@/ui/core';
import { Modal } from '@/ui/feedback';

export function OpEntryRejectDialog({
  req,
  busy,
  onReject,
  onCancel,
}: {
  req: OpLogTimeChangeRequest;
  busy: boolean;
  /** Fire the reject mutation with the typed reason (already trimmed). */
  onReject: (reason: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const canSubmit = reason.trim().length > 0 && !busy;

  return (
    <Modal
      open
      size="sm"
      role="alertdialog"
      title={`Reject correction — ${req.jobCardCode} Op ${opSrNo(req.opSeq)}`}
      onClose={onCancel}
      showClose={false}
      closeOnOverlayClick={!busy}
      closeOnEscape={!busy}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            disabled={!canSubmit}
            onClick={() => onReject(reason.trim())}
          >
            {busy ? 'Rejecting…' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="form-grp">
        <label className="form-label" htmlFor="op-entry-reject-reason">
          Why is this rejected?
          <span className="req">★</span>
        </label>
        <textarea
          id="op-entry-reject-reason"
          className="innovic-input"
          rows={3}
          autoFocus
          value={reason}
          disabled={busy}
          placeholder="The entry is left unchanged and this reason is shown to the person who asked."
          onChange={(e) => setReason(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </div>
    </Modal>
  );
}
