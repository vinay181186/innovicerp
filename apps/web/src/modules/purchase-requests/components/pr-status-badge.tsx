// PR status chip — a thin wrapper over the ONE shared map
// (ui/core/StatusBadge.tsx kind="pr"): Open / Approved blue → PO Created green
// → Cancelled red (owner 2026-11-03). Words stay PR_STATUS_LABELS.

import type { PrStatus } from '@innovic/shared';
import { StatusBadge } from '@/ui/core';
import { PR_STATUS_LABELS } from '../lib/pr-labels';

export function PrStatusBadge(props: { status: PrStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status
  // (StatusBadge draws the same overlay).
  return (
    <StatusBadge
      kind="pr"
      status={props.status}
      label={PR_STATUS_LABELS[props.status]}
      draft={props.draft}
    />
  );
}
