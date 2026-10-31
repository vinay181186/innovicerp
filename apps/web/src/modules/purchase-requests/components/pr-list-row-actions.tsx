// Per-row ⋯ menu for the Purchase Request FIT table (ADR-199). Shared RowActions
// `items`, in the menu's fixed order:
//   Preview · Download PDF (the PR sheet, use-pr-print.ts)
//   Workflow: Create PO (while quantity is left and the PR is convertible)
//   Assign Task (not for the read-only viewer role — POST /tasks refuses it)
//   ─ Cancel PR (red, last)
// PRs have no approval (owner rule 2026-10-31), so there is no Approve / Reject.
// Cancel PR is the ONE standard Cancel (ADR-235), one step for a PR: Edit
// tick, not cancelled, not short-closed; the caller opens
// CancelDocDialog, which reads the server's preview (what blocks it — a live
// PO — and what it will do).

import type { PurchaseRequestListItem } from '@innovic/shared';
import { renderRowMenuLink } from '@/ui/data';
import { RowActions } from '@/ui/layout';
import { prOrderBalance } from '../lib/pr-balance';
import { prConvertible } from '../lib/pr-convertible';

export function PrListRowActions({
  pr,
  canCreatePo,
  canAssign,
  canCancel,
  onAssign,
  onCancel,
  onPrint,
}: {
  pr: PurchaseRequestListItem;
  canCreatePo: boolean;
  canAssign: boolean;
  /** pr_create Edit tick (one-step cancel, owner rule 2026-10-31). */
  canCancel: boolean;
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
          key: 'create-po',
          label: 'Create PO',
          icon: 'plus',
          group: 'workflow',
          to: `/purchase-orders/from-pr?prId=${encodeURIComponent(pr.id)}`,
          hidden: !(canCreatePo && prConvertible(pr) && bal.balance > 0),
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
