// ADR-290 — the "Drawing Rev Status" chip of an Item + Drawing Rev. Words from
// the shared REV_RELEASE_STATUS_LABELS (draft reads "Not released"). Colours
// from the theme: Released green; Rejected / Obsolete red; every other state
// (Not released, Under Review, Approved, Unverified, Superseded) orange — work
// either waits for Design or goes ahead with a warning.

import { REV_RELEASE_STATUS_LABELS, type RevReleaseStatus } from '@innovic/shared';
import { Badge, type BadgeTone } from '@/ui/core';

const TONE: Record<RevReleaseStatus, BadgeTone> = {
  unverified: 'amber',
  draft: 'amber',
  under_review: 'amber',
  approved: 'amber',
  released: 'green',
  superseded: 'amber',
  obsolete: 'red',
  rejected: 'red',
};

export function RevStatusBadge({
  status,
  title,
  text,
}: {
  status: RevReleaseStatus;
  title?: string | undefined;
  /** Replaces the plain label (the SO / JWSO line chip spells out the wait). */
  text?: string | undefined;
}): React.JSX.Element {
  return (
    <Badge tone={TONE[status]} {...(title ? { title } : {})}>
      {text ?? REV_RELEASE_STATUS_LABELS[status]}
    </Badge>
  );
}
