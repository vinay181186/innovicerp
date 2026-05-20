import type { JobCardSourceLink } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

/** Renders a JC's source SO or JW line as a clickable inline label:
 *  "SO-436 ▸ line 6 / JOINT" → links to /sales-orders/:id
 *  "JW-001 ▸ line 1 / FLANGE-75" → links to /job-work-orders/:id
 *  Renders an em-dash when there's no link (source-less JCs are valid per
 *  ADR-012 #4 CHECK num_nonnulls(...) <= 1). */
export function JcSourceLink(props: { sourceLink: JobCardSourceLink | null }): React.JSX.Element {
  const { sourceLink } = props;
  if (!sourceLink) {
    return <span className="text3">—</span>;
  }
  if (sourceLink.type === 'so') {
    return (
      <Link
        to="/sales-orders/$id"
        params={{ id: sourceLink.salesOrderId }}
        className="mono"
        style={{ color: 'var(--cyan)', textDecoration: 'none', fontSize: 11 }}
        onClick={(e) => e.stopPropagation()}
      >
        {sourceLink.code} ▸ line {sourceLink.lineNo}
        {sourceLink.partName ? ` / ${sourceLink.partName}` : null}
      </Link>
    );
  }
  return (
    <Link
      to="/job-work-orders/$id"
      params={{ id: sourceLink.jobWorkOrderId }}
      className="mono"
      style={{ color: 'var(--cyan)', textDecoration: 'none', fontSize: 11 }}
      onClick={(e) => e.stopPropagation()}
    >
      {sourceLink.code} ▸ line {sourceLink.lineNo}
      {sourceLink.partName ? ` / ${sourceLink.partName}` : null}
    </Link>
  );
}
