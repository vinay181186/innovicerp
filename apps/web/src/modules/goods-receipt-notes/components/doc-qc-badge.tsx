// ADR-303 — the ONE QC status of a receipt (GRN, Party GRN), rolled up by the
// server from its lines: Pending (grey) · Partly done (orange) · Done (green).
// A pending edit overlays grey "Draft" (ADR-202), as every status chip does.

import type { DocQcStatus } from '@innovic/shared';
import { Badge, type BadgeTone } from '@/ui/core';

export const DOC_QC_LABELS: Record<DocQcStatus, string> = {
  pending: 'Pending',
  partly_done: 'Partly done',
  done: 'Done',
};

const DOC_QC_TONE: Record<DocQcStatus, BadgeTone> = {
  pending: 'grey',
  partly_done: 'amber',
  done: 'green',
};

/** Sort & Filter tick list (server mode): stored code → label shown. */
export const DOC_QC_OPTIONS = (Object.keys(DOC_QC_LABELS) as DocQcStatus[]).map((value) => ({
  value,
  label: DOC_QC_LABELS[value],
}));

export function DocQcBadge({
  status,
  draft,
}: {
  /** null = no QC status (a Cancelled receipt): a dash. */
  status: DocQcStatus | null | undefined;
  draft?: boolean | undefined;
}): React.JSX.Element {
  if (draft) {
    return (
      <Badge tone="grey" title="An edit to this document is waiting for approval">
        Draft
      </Badge>
    );
  }
  if (!status) return <span className="text3">—</span>;
  return <Badge tone={DOC_QC_TONE[status]}>{DOC_QC_LABELS[status]}</Badge>;
}
