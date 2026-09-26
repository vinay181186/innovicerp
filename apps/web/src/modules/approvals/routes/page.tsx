// Settings → Approvals (ADR-130) — the things WAITING for a decision.
//
// Distinct from Approval Configuration next to it in the menu, which holds the
// rules (which approvals are on, who may approve, the PO limit). This screen
// holds the queue.
//
// Only Op Entry approvals queue here: PO and PR approvals live on their own
// detail screens, so the old always-disabled PO / PR tabs were removed.

import { createRoute } from '@tanstack/react-router';
import { useSession } from '@/lib/session';
import { usePendingTimeChangeCount } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
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
        <div className="section-hdr">Op Entry Approvals</div>
        <div className="panel">
          <div className="empty-state">
            You do not have permission to approve Op Entry changes. Ask an admin.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-hdr">
        Op Entry Approvals
        {pendingLogEntry ? (
          <span className="badge b-amber" style={{ marginLeft: 6 }}>
            {pendingLogEntry}
          </span>
        ) : null}
      </div>

      <LogEntryApprovals />
    </div>
  );
}
