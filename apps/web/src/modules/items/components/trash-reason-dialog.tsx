// "Move to Trash?" with a required reason (ADR-197) — for the Item, Vendor and
// Customer masters. The shared ConfirmDialog with a reason box in its message,
// exactly as the PR detail page asks it: a blank reason is refused inside the
// dialog (thrown, so the dialog shows it and stays open).

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/feedback';

export function TrashReasonDialog({
  title,
  onConfirm,
  onCancel,
}: {
  /** e.g. "Move Item ITM-0012 to Trash?" */
  title: string;
  /** Return the mutation's promise — the dialog shows its pending state. */
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      title={title}
      message={
        <>
          You can restore it from Trash.
          <textarea
            className="innovic-input"
            aria-label="Reason"
            placeholder="Reason (required)"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 8 }}
          />
        </>
      }
      confirmLabel="Move to Trash"
      pendingLabel="Moving to Trash…"
      tone="danger"
      onCancel={onCancel}
      onConfirm={async () => {
        const r = reason.trim();
        if (!r) throw new Error('Enter a reason to move this to Trash.');
        await onConfirm(r);
      }}
    />
  );
}
