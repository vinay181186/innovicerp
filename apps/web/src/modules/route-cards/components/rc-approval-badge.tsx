// ADR-253 — a Route Card's "RC Status" chip: Pending Approval / Approved /
// Rejected. Words from the shared ROUTE_CARD_APPROVAL_LABEL; tone follows the
// app palette — waiting = amber, usable = green, refused = red.

import { ROUTE_CARD_APPROVAL_LABEL, type RouteCardApprovalStatus } from '@innovic/shared';
import { Badge, type BadgeTone } from '@/ui/core';

const TONE: Record<RouteCardApprovalStatus, BadgeTone> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
};

export function RcApprovalBadge({
  status,
  title,
}: {
  status: RouteCardApprovalStatus;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <Badge tone={TONE[status]} title={title}>
      {ROUTE_CARD_APPROVAL_LABEL[status]}
    </Badge>
  );
}
