// What the ▸ row reveals under a Customer Material Issue (ADR-199 fit table):
// the Remarks, which do not earn a column of their own. Every value is already
// on the list row, so no extra fetch.

import type { PartyMaterialIssueListItem } from '@innovic/shared';

export function PartyMaterialIssueExpand({
  it,
}: {
  it: PartyMaterialIssueListItem;
}): React.JSX.Element {
  return (
    <div
      className="text3"
      style={{
        padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      <span>
        <b>Remarks:</b> {it.remarks ?? '—'}
      </span>
    </div>
  );
}
