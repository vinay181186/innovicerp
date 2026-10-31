// Drawing control for one JWSO line. Since the Item + Drawing Rev register
// (owner model 2026-10-31) it is the shared DrawingRevField driven by the
// line's item and Drawing Rev — the same control the SO line and the Route
// Card use, so ABC/1 holds one drawing whichever document named it first. An
// existing ABC/1 drawing fills in and shows read-only (fixed only via "Replace
// drawing…"); a new Item + Rev takes an upload; a Rev change on a saved line
// offers "Use as is" / "Upload new".
//
// kind="drawing" previews: the link is minted by the server, which checks the
// download permission and logs the access.

import { DrawingRevField } from '@/modules/item-revisions/components/drawing-rev-field';

export function JwLineDrawingCell({
  value,
  onChange,
  itemId,
  itemCode,
  rev,
  savedRev,
  savedPath,
  refCode,
}: {
  value: string | null | undefined;
  onChange: (path: string | undefined) => void;
  itemId?: string | null | undefined;
  itemCode?: string | null | undefined;
  /** The line's Drawing Rev as typed. */
  rev?: string | null | undefined;
  /** Saved line only: the Rev / file it was loaded with. */
  savedRev?: string | null | undefined;
  savedPath?: string | null | undefined;
  /** Access-log reference ("IN-JWSO-… L2"). */
  refCode?: string | undefined;
}): React.JSX.Element {
  return (
    <DrawingRevField
      itemId={itemId}
      itemCode={itemCode}
      rev={rev}
      value={value}
      onChange={(p) => onChange(p ?? undefined)}
      source="jw_line"
      refCode={refCode}
      savedRev={savedRev}
      savedPath={savedPath}
    />
  );
}
