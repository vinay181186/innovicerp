// ADR-323 — the "Drawing Rev Status" chip of an Item + Drawing Rev. Words from
// the shared REV_RELEASE_STATUS_LABELS. Colours from the theme: Unverified
// orange (Design has not checked the PDF yet), Verified green, Obsolete red.

import { REV_RELEASE_STATUS_LABELS, type RevReleaseStatus } from '@innovic/shared';
import { Badge, type BadgeTone } from '@/ui/core';

const TONE: Record<RevReleaseStatus, BadgeTone> = {
  unverified: 'amber',
  verified: 'green',
  obsolete: 'red',
};

export function RevStatusBadge({
  status,
  title,
  text,
}: {
  status: RevReleaseStatus;
  title?: string | undefined;
  /** Replaces the plain label. */
  text?: string | undefined;
}): React.JSX.Element {
  return (
    <Badge tone={TONE[status]} {...(title ? { title } : {})}>
      {text ?? REV_RELEASE_STATUS_LABELS[status]}
    </Badge>
  );
}
