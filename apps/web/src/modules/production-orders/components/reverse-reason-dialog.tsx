// "Reverse close?" with a required reason — the Production Order close
// ledger's ⋯ Reverse close item (ADR-179 reversal, reason kept as remarks for
// the ADR-197 audit trail). The shared ConfirmDialog with a reason box in its
// message, the same pattern as items/components/trash-reason-dialog.tsx: a
// blank reason is refused inside the dialog (thrown, so the dialog shows it
// and stays open), and a server refusal (pieces already dispatched, plan
// over-cover) shows inside the dialog too because onConfirm rejects.

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/feedback';

export function ReverseReasonDialog({
  title,
  onConfirm,
  onCancel,
}: {
  /** e.g. "Reverse close of 40 on 12-Sep-2026?" */
  title: string;
  /**
   * Return the mutation's promise (`mutateAsync`) — the dialog shows its
   * pending state, and a rejection's message is shown inside it.
   */
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      title={title}
      message={
        <>
          Writes a stock-out and a reversal row. Blocked if the pieces are already dispatched.
          <textarea
            className="innovic-input"
            aria-label="Reason"
            placeholder="Reason (required)"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 8 }}
          />
        </>
      }
      confirmLabel="Reverse close"
      pendingLabel="Reversing…"
      tone="danger"
      onCancel={onCancel}
      onConfirm={async () => {
        const r = reason.trim();
        if (!r) throw new Error('Type the reason for reversing this close.');
        await onConfirm(r);
      }}
    />
  );
}
