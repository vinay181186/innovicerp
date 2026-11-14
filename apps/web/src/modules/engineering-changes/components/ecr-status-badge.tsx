// ADR-291 — the ECR Status chip. Words from the shared ECR_STATUS_LABELS;
// colours from the theme (ECR_STATUS_TONE): Cancelled / Rejected red,
// Waiting Approval orange.

import { ECR_STATUS_LABELS, type EcrStatus } from '@innovic/shared';
import { Badge } from '@/ui/core';
import { ECR_STATUS_TONE } from '../lib/ecr-rights';

export function EcrStatusBadge({ status }: { status: EcrStatus }): React.JSX.Element {
  return <Badge tone={ECR_STATUS_TONE[status]}>{ECR_STATUS_LABELS[status]}</Badge>;
}
