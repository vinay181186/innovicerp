// SO status → legacy .badge .b-* class (UI-002).
// Mapping per docs/STYLE_GUIDE.md "SO (Sales Order) status → badge class".

import type { SoStatus } from '@innovic/shared';
import { SO_STATUS_LABEL } from '../lib/so-status-label';

const CLASSES: Record<SoStatus, string> = {
  draft: 'b-grey',
  open: 'b-blue',
  closed: 'b-green',
  dispatched: 'b-green',
  cancelled: 'b-grey',
};

export function SoStatusBadge(props: { status: SoStatus; draft?: boolean | undefined }) {
  // ADR-202 — a pending edit overlays grey "Draft" in place of the real status.
  if (props.draft) {
    return (
      <span className="badge b-grey" title="An edit to this document is waiting for approval">
        Draft
      </span>
    );
  }
  return <span className={`badge ${CLASSES[props.status]}`}>{SO_STATUS_LABEL[props.status]}</span>;
}
