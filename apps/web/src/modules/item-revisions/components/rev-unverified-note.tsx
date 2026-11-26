// ADR-323 — the orange note on a NEW Plan / Production Order / Job Card when
// its Item + Drawing Rev is still Unverified. It never blocks the save (only an
// Obsolete Rev is refused, by the server). Reads the Rev through the same
// look-up the other forms use (Item + Rev), or by record id when that is all
// the form holds.

import { REV_WORK_WARN, revUnverifiedWarning } from '@innovic/shared';
import { useItemRevision, useItemRevisionLookup } from '../api';
import { Banner } from '@/ui/feedback';

export function RevUnverifiedNote({
  itemId,
  rev,
  itemRevisionId,
}: {
  itemId?: string | null | undefined;
  /** The Drawing Rev as the form holds it ("1", "A"). */
  rev?: string | null | undefined;
  /** Used only when the form has no Item + Rev text. */
  itemRevisionId?: string | null | undefined;
}): React.JSX.Element | null {
  const byText = Boolean(itemId && rev);
  const lookup = useItemRevisionLookup(byText ? itemId : null, byText ? rev : null);
  const byId = useItemRevision(!byText && itemRevisionId ? itemRevisionId : undefined);
  const record = byText ? (lookup.data?.revision ?? null) : (byId.data ?? null);
  if (!record || !REV_WORK_WARN.includes(record.releaseStatus)) return null;
  return (
    <Banner tone="warn" role="status">
      {revUnverifiedWarning(record.label)}
    </Banner>
  );
}
