// Approvals — the shared Reject reason popup: a row reject in the Approvals
// list (approvals-list.tsx), a field / Reject all in the Review panel, and the
// Cancel Request dialog. Modelled on op-entry-reject-dialog.tsx: a
// reject reason is captured in a small dialog, not an inline cell. Built on the
// shared Modal so it sits on the app's z-index ladder and traps focus. Reject
// stays disabled until a reason is typed.

import { useState } from 'react';
import { Button } from '@/ui/core';
import { Modal } from '@/ui/feedback';

export function ApprovalRejectDialog({
  title,
  prompt,
  confirmLabel = 'Reject',
  placeholder = 'The document is left unchanged and this reason is shown to the person who asked.',
  onReject,
  onCancel,
}: {
  /** Dialog title, e.g. "Reject — IN-MPO-00042" or "Reject change — PO Date · …". */
  title: string;
  /** The question above the reason box. */
  prompt?: string | undefined;
  /** Text on the danger button. */
  confirmLabel?: string | undefined;
  /** Hint inside the reason box. */
  placeholder?: string | undefined;
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
      elevated
      title={title}
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
            {...(canSubmit ? {} : { title: 'Type the reason first' })}
            onClick={() => onReject(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="form-grp">
        <label className="form-label" htmlFor="approval-reject-reason">
          {prompt ?? 'Why is this rejected?'}
          <span className="req">★</span>
        </label>
        <textarea
          id="approval-reject-reason"
          className="innovic-input"
          rows={3}
          autoFocus
          value={reason}
          placeholder={placeholder}
          onChange={(e) => setReason(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </div>
    </Modal>
  );
}
