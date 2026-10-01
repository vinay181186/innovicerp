// Per-row action cluster for the Purchase Request FIT table (ADR-199). Uses the
// shared RowActions `extra` slot — Approve / Reject (L4 Approver, open PRs),
// Create PO (while quantity is left and the PR is convertible), Assign Task.
// Reuses the module's existing handlers / targets; no hand-rolled icon buttons.

import type { PurchaseRequestListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { RowActions } from '@/ui/layout';
import { prOrderBalance } from '../lib/pr-balance';
import { prConvertible } from '../lib/pr-convertible';

export function PrListRowActions({
  pr,
  canApprove,
  canCreatePo,
  prApprovalOn,
  approving,
  rejecting,
  onApprove,
  onReject,
}: {
  pr: PurchaseRequestListItem;
  canApprove: boolean;
  canCreatePo: boolean;
  prApprovalOn: boolean;
  approving: boolean;
  rejecting: boolean;
  onApprove: (pr: PurchaseRequestListItem) => void;
  onReject: (pr: PurchaseRequestListItem) => void;
}): React.JSX.Element {
  const bal = prOrderBalance(pr);
  return (
    <RowActions
      extra={
        <>
          {canApprove && pr.status === 'open' ? (
            <>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={approving}
                onClick={() => onApprove(pr)}
              >
                ✓ Approve
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={rejecting}
                onClick={() => onReject(pr)}
              >
                ✕ Reject
              </button>
            </>
          ) : null}
          {canCreatePo && prConvertible(pr, prApprovalOn) && bal.balance > 0 ? (
            <Link
              to="/purchase-orders/from-pr"
              search={{ prId: pr.id }}
              className="btn btn-sm btn-primary"
            >
              Create PO
            </Link>
          ) : null}
          {pr.status !== 'cancelled' && pr.status !== 'po_created' ? (
            <AssignTaskButton
              linkedRef={{
                type: 'purchase_request',
                id: pr.id,
                display: `PR ${pr.code}`,
                navPage: `/purchase-requests/${pr.id}`,
              }}
              suggestedTitle={
                pr.status === 'open' ? `Review & approve ${pr.code}` : `Convert ${pr.code} to PO`
              }
              label=""
            />
          ) : null}
        </>
      }
    />
  );
}
