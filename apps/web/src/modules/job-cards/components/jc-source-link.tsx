import type { JobCardSourceLink } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

/** Renders a JC's source SO or JW line as a clickable inline label:
 *  "SO-436 ▸ line 6 / JOINT" → links to /sales-orders/:id
 *  "JW-001 ▸ line 1 / FLANGE-75" → links to /job-work-orders/:id
 *  Renders an em-dash when there's no link (source-less JCs are valid per
 *  ADR-012 #4 CHECK num_nonnulls(...) <= 1). */
export function JcSourceLink(props: { sourceLink: JobCardSourceLink | null }) {
  const { sourceLink } = props;
  if (!sourceLink) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (sourceLink.type === 'so') {
    return (
      <Link
        to="/sales-orders/$id"
        params={{ id: sourceLink.salesOrderId }}
        className="font-mono text-xs text-primary underline-offset-4 hover:underline"
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
      className="font-mono text-xs text-primary underline-offset-4 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {sourceLink.code} ▸ line {sourceLink.lineNo}
      {sourceLink.partName ? ` / ${sourceLink.partName}` : null}
    </Link>
  );
}
