// Settings → Approvals (ADR-130) — the things WAITING for a decision.
//
// Distinct from Approval Configuration next to it in the menu, which holds the
// rules (which approvals are on, who may approve, the PO limit). This screen
// holds the queue.
//
// Only Log Entry approvals queue here: PO and PR approvals live on their own
// detail screens, so the old always-disabled PO / PR tabs were removed.

import { createRoute } from '@tanstack/react-router';
import { useSession } from '@/lib/session';
import { usePendingTimeChangeCount } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader } from '@/ui/layout';
import { LogEntryApprovals } from '../components/log-entry-approvals';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

function ApprovalsPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canApprove = me?.role === 'admin' || me?.role === 'manager';
  const pendingLogEntry = usePendingTimeChangeCount(canApprove);

  if (!canApprove) {
    return (
      <div>
        <ListHeader title="Log Entry Approvals" icon="✅" />
        <div className="panel">
          <div className="empty-state">
            Approving is limited to managers and admins. Your changes are sent here for one of them
            to decide.
          </div>
        </div>
      </div>
    );
  }

  return <LogEntryApprovals pendingCount={pendingLogEntry} />;
}
