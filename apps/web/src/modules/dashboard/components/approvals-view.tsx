// ADR-264 — Approvals on the home: the Approval inbox (PR / PO / Route Card
// (New) / Op Entry, Approve / Reject already guarded), plus links with counts
// to the other places something waits for the caller today — staged edits,
// Cancel Requests and Day Log edits — only those the caller can open.
// Labels are the ones those pages already use (DOCUMENT_EDIT_LABEL, "Cancel
// Requests", "Approvals · Day Log").

import {
  type AccessFormKey,
  CANCEL_DOC_FORM_KEY,
  DOCUMENT_EDIT_LABEL,
  type HomeResponse,
} from '@innovic/shared';
import { ActionLink, useCanOpen } from '@/components/shared/action-link';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useCancelRequests } from '@/modules/cancel-requests/api';
import { useDayLogAccess, useDayLogApprovals } from '@/modules/day-logs/api';
import { useDocumentEditCounts } from '@/modules/document-edits/api';
import { EmptyState } from '@/ui/data';
import { ApprovalInbox } from './approval-inbox';
import { linkProps } from './dash-text';
import { ViewHead } from './view-head';

const CANCEL_FORM_KEYS = [...new Set(Object.values(CANCEL_DOC_FORM_KEY))] as AccessFormKey[];
const DAY_LOG_APPROVALS_HREF = '/task-board?view=approvals';

export interface OtherApproval {
  key: string;
  label: string;
  count: number;
  href: string;
}

/** Waiting items outside the inbox, each only when the caller may open its page. */
export function useOtherApprovals(): OtherApproval[] {
  const canOpen = useCanOpen();
  const { data: eff } = useMyAccess();
  const canApprovals = canOpen('/approvals');
  const canDecideCancel =
    canApprovals && CANCEL_FORM_KEYS.some((k) => effectiveFormPerms(eff, k).approve);
  const canDayLogApprovals = canOpen(DAY_LOG_APPROVALS_HREF);

  const edits = useDocumentEditCounts({ enabled: canApprovals });
  const cancels = useCancelRequests(
    { status: 'pending', toDecide: 'true', limit: 1, offset: 0 },
    canDecideCancel,
  );
  const dayAccess = useDayLogAccess(canDayLogApprovals);
  const dayApprovals = useDayLogApprovals(canDayLogApprovals && !!dayAccess.data?.canApprove);

  const out: OtherApproval[] = [];
  if (canApprovals) {
    for (const c of edits.data?.counts ?? []) {
      if (c.pending > 0)
        out.push({
          key: `edit:${c.entity}`,
          label: DOCUMENT_EDIT_LABEL[c.entity],
          count: c.pending,
          href: '/approvals',
        });
    }
  }
  const cancelTotal = canDecideCancel ? (cancels.data?.total ?? 0) : 0;
  if (cancelTotal > 0)
    out.push({ key: 'cancel', label: 'Cancel Requests', count: cancelTotal, href: '/approvals' });
  const dayWaiting = dayAccess.data?.canApprove ? (dayApprovals.data?.rows.length ?? 0) : 0;
  if (dayWaiting > 0)
    out.push({
      key: 'daylog',
      label: 'Approvals · Day Log',
      count: dayWaiting,
      href: DAY_LOG_APPROVALS_HREF,
    });
  return out;
}

export function inboxTotal(a: HomeResponse['approvals']): number {
  if (!a) return 0;
  // PRs need no approval (owner rule 2026-10-31) — counts.pr is not counted,
  // the same total the inbox heading shows (approval-inbox.tsx).
  return a.counts.po + (a.counts.rc ?? 0) + a.counts.logEntry;
}

export function ApprovalsView({
  home,
  others,
}: {
  home: HomeResponse;
  others: OtherApproval[];
}): React.JSX.Element {
  return (
    <>
      <ViewHead title="Approvals" hint="Documents waiting for my tick" />
      <div className="dh-body">
        {others.length > 0 ? (
          <div className="dh-otherap" aria-label="Also waiting">
            {others.map((o) => (
              <ActionLink key={o.key} {...linkProps(o.href)} check={o.href} className="dh-link">
                {o.label} ({o.count})
              </ActionLink>
            ))}
          </div>
        ) : null}
        {home.approvals ? (
          <ApprovalInbox approvals={home.approvals} />
        ) : others.length === 0 ? (
          <EmptyState>Nothing waiting for your approval.</EmptyState>
        ) : null}
      </div>
    </>
  );
}
