// GRN QC status → legacy .badge .b-* class (UI-002).
// pending=amber (needs QC) → in_progress=amber (under way) → completed=green.

import type { GrnQcStatus } from '@innovic/shared';
import { GRN_QC_STATUS_LABELS } from '../lib/grn-labels';

const CLASSES: Record<GrnQcStatus, string> = {
  pending: 'b-amber',
  in_progress: 'b-amber',
  completed: 'b-green',
};

export function QcStatusBadge(props: { status: GrnQcStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status.
  if (props.draft) {
    return (
      <span className="badge b-grey" title="An edit to this document is waiting for approval">
        Draft
      </span>
    );
  }
  return (
    <span className={`badge ${CLASSES[props.status]}`}>{GRN_QC_STATUS_LABELS[props.status]}</span>
  );
}
