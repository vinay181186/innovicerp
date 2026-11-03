// NC status chip — a thin wrapper over the ONE shared map
// (ui/core/StatusBadge.tsx kind="nc"): blue = raised / disposed / rework
// completed, waiting for the next step; amber = recovery under way (rework,
// repair, at vendor, QC Pending); green = Closed. Text comes from
// NC_STATUS_LABELS so the badge, the list filter and the document read the
// same words.

import { NC_STATUS_LABELS, type NcStatus } from '@innovic/shared';
import { StatusBadge } from '@/ui/core';

export function NcStatusBadge(props: { status: NcStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status
  // (StatusBadge draws the same overlay).
  return (
    <StatusBadge
      kind="nc"
      status={props.status}
      label={NC_STATUS_LABELS[props.status]}
      draft={props.draft}
    />
  );
}
