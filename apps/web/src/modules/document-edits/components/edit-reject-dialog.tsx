// Edit-approval (ADR-202) — the per-change Reject reason popup. Modelled on
// op-entry-reject-dialog.tsx: a reject reason is captured in a small dialog, not
// an inline cell. Built on the shared Modal so it sits on the app's z-index
// ladder and traps focus. Reject stays disabled until a reason is typed.

import { useState } from 'react';
import { Button } from '@/ui/core';
import { Modal } from '@/ui/feedback';

export function EditRejectDialog({
  docCode,
  fieldLabel,
  onReject,
  onCancel,
}: {
  /** The document whose change is being rejected, e.g. IN-MPO-00042. */
  docCode: string;
  /** The screen label of the single change being rejected, e.g. "PO Date". */
  fieldLabel: string;
  /** Fire with the typed reason (already trimmed). */
  onReject: (reason: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const canSubmit = reason.trim().length > 0;

  return (
    <Modal
      open
      size="sm"
      role="alertdialog"
      title={`Reject change — ${fieldLabel} · ${docCode}`}
      onClose={onCancel}
      showClose={false}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!canSubmit}
            onClick={() => onReject(reason.trim())}
          >
            Reject change
          </Button>
        </>
      }
    >
      <div className="form-grp">
        <label className="form-label" htmlFor="edit-reject-reason">
          Why is this change rejected?
          <span className="req">★</span>
        </label>
        <textarea
          id="edit-reject-reason"
          className="innovic-input"
          rows={3}
          autoFocus
          value={reason}
          placeholder="The current value is kept and this reason is shown to the person who asked."
          onChange={(e) => setReason(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </div>
    </Modal>
  );
}
