// DC status → legacy .badge .b-* class (UI-002).
// issued=amber (awaiting receipt) → received=green (terminal good)
// → cancelled=grey.

import type { DcStatus } from '@innovic/shared';
import { DC_STATUS_LABEL } from '../lib/dc-status-label';

const CLASSES: Record<DcStatus, string> = {
  issued: 'b-amber',
  received: 'b-green',
  cancelled: 'b-grey',
};

export function DcStatusBadge(props: { status: DcStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status.
  if (props.draft) {
    return (
      <span className="badge b-grey" title="An edit to this document is waiting for approval">
        Draft
      </span>
    );
  }
  return <span className={`badge ${CLASSES[props.status]}`}>{DC_STATUS_LABEL[props.status]}</span>;
}
