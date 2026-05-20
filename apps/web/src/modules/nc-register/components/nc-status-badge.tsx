// NC status → legacy .badge .b-* class (UI-002).
// pending=amber (needs attention) → disposed=blue (action taken, in-flight)
// → rework_done=cyan (intermediate good) → closed=green (terminal good).

import type { NcStatus } from '@innovic/shared';

const CLASSES: Record<NcStatus, string> = {
  pending: 'b-amber',
  disposed: 'b-blue',
  rework_done: 'b-cyan',
  closed: 'b-green',
};

export function NcStatusBadge(props: { status: NcStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{props.status.replaceAll('_', ' ')}</span>;
}
