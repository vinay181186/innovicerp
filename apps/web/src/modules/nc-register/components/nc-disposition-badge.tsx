// NC disposition → legacy .badge .b-* class (UI-002). Text comes from
// NC_DISPOSITION_LABELS (the QC document's vocabulary — `scrap` reads
// "Reject / Scrap"), so the badge matches the dispose panel's choices.

import { NC_DISPOSITION_LABELS, type NcDisposition } from '@innovic/shared';

const CLASSES: Record<NcDisposition, string> = {
  rework: 'b-cyan',
  // Same mechanics as rework (a child JC), so the same colour family.
  repair: 'b-cyan',
  scrap: 'b-red',
  use_as_is: 'b-green',
  return_to_vendor: 'b-orange',
  make_fresh: 'b-blue',
};

export function NcDispositionBadge(props: { disposition: NcDisposition | null }) {
  if (!props.disposition) {
    return <span className="text3">—</span>;
  }
  return (
    <span className={`badge ${CLASSES[props.disposition]}`}>
      {NC_DISPOSITION_LABELS[props.disposition]}
    </span>
  );
}
