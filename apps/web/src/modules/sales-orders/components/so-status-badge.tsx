// SO status chip — a thin wrapper over the ONE shared map
// (ui/core/StatusBadge.tsx kind="so"), so the colour can never drift from it.
// Owner 2026-11-03: Cancelled red. Words stay SO_STATUS_LABEL.

import type { SoStatus } from '@innovic/shared';
import { StatusBadge } from '@/ui/core';
import { SO_STATUS_LABEL } from '../lib/so-status-label';

export function SoStatusBadge(props: { status: SoStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status
  // (StatusBadge draws the same overlay).
  return (
    <StatusBadge
      kind="so"
      status={props.status}
      label={SO_STATUS_LABEL[props.status]}
      draft={props.draft}
    />
  );
}
