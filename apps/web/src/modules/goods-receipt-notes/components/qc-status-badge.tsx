// GRN QC status → legacy .badge .b-* class (UI-002).
// pending=amber (needs QC) → in_progress=blue (active) → completed=green.

import type { GrnQcStatus } from '@innovic/shared';

const CLASSES: Record<GrnQcStatus, string> = {
  pending: 'b-amber',
  in_progress: 'b-blue',
  completed: 'b-green',
};

export function QcStatusBadge(props: { status: GrnQcStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{props.status.replaceAll('_', ' ')}</span>;
}
