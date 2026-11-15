// ADR-291 — "Cancel ECR…": asks the reason, then POST /ecrs/:id/cancel with
// the ECR's updatedAt (§20.4 — 409 when someone acted first). Cancelling lifts
// the holds the ECR put on Job Card operations. Built on the shared reason
// popup of the Approvals page.

import type { Ecr, EcrListRow } from '@innovic/shared';
import { ApprovalRejectDialog } from '@/modules/approvals/components/approval-reject-dialog';
import { useToast } from '@/ui/feedback';
import { useEcrAction } from '../api';

export function EcrCancelDialog({
  ecr,
  onDone,
  onCancel,
}: {
  ecr: Pick<Ecr | EcrListRow, 'id' | 'code' | 'updatedAt'>;
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const cancel = useEcrAction('cancel');
  const toast = useToast();
  return (
    <ApprovalRejectDialog
      title={`Cancel ECR — ${ecr.code}`}
      prompt="Cancel Reason"
      confirmLabel="Cancel ECR"
      placeholder="Holds this ECR put on Job Card operations are lifted."
      onCancel={onCancel}
      onReject={(reason) => {
        onDone();
        cancel
          .mutateAsync({ id: ecr.id, expectedUpdatedAt: ecr.updatedAt, note: reason })
          .then(() => toast.ok(`${ecr.code} cancelled`))
          .catch((e: unknown) =>
            toast.error(`${ecr.code}: ${e instanceof Error ? e.message : 'Could not cancel.'}`),
          );
      }}
    />
  );
}
