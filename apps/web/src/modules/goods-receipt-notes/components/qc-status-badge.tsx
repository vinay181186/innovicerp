// GRN QC status chip — a thin wrapper over the ONE shared map
// (ui/core/StatusBadge.tsx kind="grnqc"): pending = orange (QC-waiting, owner
// 2026-11-03) → in_progress amber → completed green. Words stay
// GRN_QC_STATUS_LABELS.

import type { GrnQcStatus } from '@innovic/shared';
import { StatusBadge } from '@/ui/core';
import { GRN_QC_STATUS_LABELS } from '../lib/grn-labels';

export function QcStatusBadge(props: { status: GrnQcStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status
  // (StatusBadge draws the same overlay).
  return (
    <StatusBadge
      kind="grnqc"
      status={props.status}
      label={GRN_QC_STATUS_LABELS[props.status]}
      draft={props.draft}
    />
  );
}
