// NC status → .badge .b-* class, on the app status colours: blue = raised /
// disposed, waiting for the next step; amber = recovery under way (rework,
// repair, at vendor, QC Pending); green = Rework Completed / Closed. Text comes
// from NC_STATUS_LABELS so the badge, the list filter and the document read
// the same words.

import { NC_STATUS_LABELS, type NcStatus } from '@innovic/shared';

const CLASSES: Record<NcStatus, string> = {
  pending: 'b-blue',
  disposed: 'b-blue',
  under_rework: 'b-amber',
  under_repair: 'b-amber',
  sent_to_vendor: 'b-amber',
  received_qc_pending: 'b-amber',
  rework_done: 'b-green',
  closed: 'b-green',
};

export function NcStatusBadge(props: { status: NcStatus }) {
  return <span className={`badge ${CLASSES[props.status]}`}>{NC_STATUS_LABELS[props.status]}</span>;
}
