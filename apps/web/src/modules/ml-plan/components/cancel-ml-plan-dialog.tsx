// Cancel a Multi-Level Plan — ConfirmDialog with a required Reason (ADR-197:
// the reason is the Reason on the History row). Same pattern as the ml-bom
// delete dialog. Used by the list ⋯ and the detail Actions menu.

import type { MlPlan } from '@innovic/shared';
import { useState } from 'react';
import { ConfirmDialog } from '@/ui/feedback';
import { useCancelMlPlan } from '../api';

interface Props {
  plan: Pick<MlPlan, 'id' | 'code' | 'updatedAt'>;
  onDone: () => void;
  onCancel: () => void;
}

export function CancelMlPlanDialog({ plan, onDone, onCancel }: Props): React.JSX.Element {
  const cancel = useCancelMlPlan();
  const [reason, setReason] = useState('');

  const onConfirm = async (): Promise<void> => {
    const r = reason.trim();
    // Thrown, so ConfirmDialog shows it inside the dialog and stays open.
    if (!r) throw new Error('Reason is required.');
    await cancel.mutateAsync({ id: plan.id, reason: r, expectedUpdatedAt: plan.updatedAt });
    onDone();
  };

  return (
    <ConfirmDialog
      title={`Cancel ${plan.code}?`}
      message={
        <span className="form-grp" style={{ display: 'block' }}>
          <label className="form-label" htmlFor="mlplan-cancel-reason">
            Reason <span className="req">★</span>
          </label>
          <textarea
            id="mlplan-cancel-reason"
            className="innovic-input"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </span>
      }
      confirmLabel="Cancel Plan"
      cancelLabel="Close"
      pendingLabel="Cancelling…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
