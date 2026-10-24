// Per-row ⋯ menu for the Purchase Request FIT table (ADR-199). Shared RowActions
// `items`, in the menu's fixed order:
//   Preview · Download PDF (the PR sheet, use-pr-print.ts)
//   Workflow: Approve (L4 Approver, open PRs) · Create PO (while quantity is
//             left and the PR is convertible)
//   Assign Task (not for the read-only viewer role — POST /tasks refuses it)
//   ─ Reject · Cancel PR (red, last)
// Cancel PR is the ONE standard Cancel (ADR-235): Edit or Approve tick, not
// cancelled, not short-closed; the caller opens CancelDocDialog, which reads the
// server's preview (what blocks it — a live PO — and what it will do).
// Reject follows the server (rejectPurchaseRequest): any PR that is not
// cancelled (incl. 'PO created' whose PO was cancelled — nothing ordered),
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
  canCancel,
  prApprovalOn,
  approving,
  rejecting,
  onApprove,
  onReject,
  onAssign,
  onCancel,
  onPrint,
}: {
  pr: PurchaseRequestListItem;
  canApprove: boolean;
  canCreatePo: boolean;
  canAssign: boolean;
  /** pr_create Edit OR Approve tick (ADR-235). */
  canCancel: boolean;
  prApprovalOn: boolean;
  approving: boolean;
  rejecting: boolean;
  onApprove: (pr: PurchaseRequestListItem) => void | Promise<void>;
  onReject: (pr: PurchaseRequestListItem) => void | Promise<void>;
  onAssign: (pr: PurchaseRequestListItem) => void;
  onCancel: (pr: PurchaseRequestListItem) => void;
  onPrint: (action: 'preview' | 'download', pr: PurchaseRequestListItem) => Promise<void>;
}): React.JSX.Element {
  const bal = prOrderBalance(pr);
  return (
    <RowActions
      renderLink={renderRowMenuLink}
      items={[
        {
          key: 'preview',
          label: 'Preview',
          icon: 'eye',
          onSelect: () => void onPrint('preview', pr),
        },
        {
          key: 'download',
          label: 'Download PDF',
          icon: 'download',
          onSelect: () => onPrint('download', pr),
        },
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
          hidden: !canApprove || pr.status === 'cancelled',
          disabledReason: bal.ordered > 0 ? 'Already on a PO' : rejecting ? 'Working…' : undefined,
          onSelect: () => onReject(pr),
        },
        {
          key: 'cancel',
          label: 'Cancel PR',
          icon: 'x',
          group: 'danger',
          hidden: !canCancel || pr.status === 'cancelled' || bal.closed,
          onSelect: () => onCancel(pr),
        },
      ]}
    />
  );
}
