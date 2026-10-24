// ADR-235 — the standard Cancel on a Plan (Phase C). Kept in its own file so the
// Plans list and detail each gain only a few additive lines.
//
// Cancel Plan: the Edit tick raises the request, the Approve tick decides it
// (plan_create). Not on a cancelled or completed plan; a plan with Production
// Orders / Job Cards / PRs is refused by the server's preview, which lists what
// to cancel first.

import type { PlanStatus } from '@innovic/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { OrderCancelledBanner } from '@/modules/sales-orders/components/order-cancelled-banner';
import type { RowMenuItem } from '@/ui/data';

type PlanPerms = { edit: boolean; approve: boolean };
type CancelTarget = { id: string; code: string };
type PlanLike = CancelTarget & {
  planStatus: PlanStatus;
  cancelReason: string | null;
  cancelledAt: string | null;
};

export function canCancelPlan(perms: PlanPerms, status: PlanStatus): boolean {
  return (perms.edit || perms.approve) && status !== 'cancelled' && status !== 'complete';
}

/** The row ⋯ "Cancel Plan" item (empty when it may not be offered). */
export function planCancelMenuItems(
  row: PlanLike,
  perms: PlanPerms,
  onCancel: (t: CancelTarget) => void,
): RowMenuItem[] {
  if (!canCancelPlan(perms, row.planStatus)) return [];
  return [
    {
      key: 'cancel',
      label: 'Cancel Plan',
      icon: 'x',
      group: 'danger',
      onSelect: () => onCancel({ id: row.id, code: row.code }),
    },
  ];
}

/** The open Cancel dialog for one plan, or nothing. */
export function PlanCancelDialog({
  target,
  onClose,
}: {
  target: CancelTarget | null;
  onClose: () => void;
}): React.JSX.Element | null {
  if (!target) return null;
  return (
    <CancelDocDialog docType="plan" docId={target.id} docCode={target.code} onClose={onClose} />
  );
}

/** Plan detail: the header button, the pending / cancelled banners and the
 *  dialog — each placed where the page wants it. Called before the page's early
 *  returns (hooks rule), so `plan` may still be loading. */
export function usePlanCancel(
  plan: PlanLike | undefined,
  perms: PlanPerms,
): { button: React.ReactNode; banners: React.ReactNode; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  if (!plan) return { button: null, banners: null, dialog: null };
  const cancelled = plan.planStatus === 'cancelled';
  const canCancel = canCancelPlan(perms, plan.planStatus);
  const onOpen = (): void => setOpen(true);
  return {
    button: canCancel ? (
      <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
        <X size={13} /> Cancel Plan
      </button>
    ) : null,
    banners: (
      <>
        <CancelPendingBanner
          docType="plan"
          docId={plan.id}
          cancelled={cancelled}
          {...(canCancel ? { onOpen } : {})}
        />
        <OrderCancelledBanner
          cancelled={cancelled}
          docLabel="Plan"
          reason={plan.cancelReason}
          cancelledAt={plan.cancelledAt}
        />
      </>
    ),
    dialog: <PlanCancelDialog target={open ? plan : null} onClose={() => setOpen(false)} />,
  };
}
