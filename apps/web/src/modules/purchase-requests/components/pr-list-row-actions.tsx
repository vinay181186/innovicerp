// Per-row ⋯ menu for the Purchase Request FIT table (ADR-199). Shared RowActions
// `items`, in the menu's fixed order:
//   Workflow: Approve (L4 Approver, open PRs) · Create PO (while quantity is
//             left and the PR is convertible)
//   Assign Task (not for the read-only viewer role — POST /tasks refuses it)
//   ─ Reject (red, last)
// Reject follows the server (rejectPurchaseRequest): an Open OR Approved PR,
// greyed with the reason once any of it is on a live PO. Reuses the module's
// existing handlers / targets; Approve / Reject return the mutation's Promise
// so the row's ⋯ shows busy, and grey out on every row while one is in flight.

import type { PurchaseRequestListItem } from '@innovic/shared';
import { renderRowMenuLink } from '@/ui/data';
import { RowActions } from '@/ui/layout';
import { prOrderBalance } from '../lib/pr-balance';
import { prConvertible } from '../lib/pr-convertible';

export function PrListRowActions({
  pr,
  canApprove,
  canCreatePo,
  canAssign,
  prApprovalOn,
  approving,
  rejecting,
  onApprove,
  onReject,
  onAssign,
}: {
  pr: PurchaseRequestListItem;
  canApprove: boolean;
  canCreatePo: boolean;
  canAssign: boolean;
  prApprovalOn: boolean;
  approving: boolean;
  rejecting: boolean;
  onApprove: (pr: PurchaseRequestListItem) => void | Promise<void>;
  onReject: (pr: PurchaseRequestListItem) => void | Promise<void>;
  onAssign: (pr: PurchaseRequestListItem) => void;
}): React.JSX.Element {
  const bal = prOrderBalance(pr);
  return (
    <RowActions
      renderLink={renderRowMenuLink}
      items={[
        {
          key: 'approve',
          label: 'Approve',
          icon: 'check',
          group: 'workflow',
          hidden: !canApprove || pr.status !== 'open',
          disabledReason: approving ? 'Working…' : undefined,
          onSelect: () => onApprove(pr),
        },
        {
          key: 'create-po',
          label: 'Create PO',
          icon: 'plus',
          group: 'workflow',
          to: `/purchase-orders/from-pr?prId=${encodeURIComponent(pr.id)}`,
          hidden: !(canCreatePo && prConvertible(pr, prApprovalOn) && bal.balance > 0),
        },
        {
          key: 'assign',
          label: 'Assign Task',
          icon: 'user-round',
          group: 'assign',
          hidden: !canAssign || pr.status === 'cancelled' || pr.status === 'po_created',
          onSelect: () => onAssign(pr),
        },
        {
          key: 'reject',
          label: 'Reject',
          icon: 'x',
          group: 'danger',
          hidden: !canApprove || (pr.status !== 'open' && pr.status !== 'approved'),
          disabledReason:
            bal.ordered > 0 ? 'Already on a PO' : rejecting ? 'Working…' : undefined,
          onSelect: () => onReject(pr),
        },
      ]}
    />
  );
}
