// NC disposition → legacy .badge .b-* class (UI-002).

import type { NcDisposition } from '@innovic/shared';

const CLASSES: Record<NcDisposition, string> = {
  rework: 'b-cyan',
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
      {props.disposition.replaceAll('_', ' ')}
    </span>
  );
}
