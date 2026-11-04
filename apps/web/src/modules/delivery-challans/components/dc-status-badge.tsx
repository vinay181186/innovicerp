// DC status chip — a thin wrapper over the ONE shared map
// (ui/core/StatusBadge.tsx kind="dc"): issued amber (awaiting receipt) →
// received green → cancelled red (owner 2026-11-03). Words stay DC_STATUS_LABEL.

import type { DcStatus } from '@innovic/shared';
import { StatusBadge } from '@/ui/core';
import { DC_STATUS_LABEL } from '../lib/dc-status-label';

export function DcStatusBadge(props: { status: DcStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status
  // (StatusBadge draws the same overlay).
  return (
    <StatusBadge
      kind="dc"
      status={props.status}
      label={DC_STATUS_LABEL[props.status]}
      draft={props.draft}
    />
  );
}
