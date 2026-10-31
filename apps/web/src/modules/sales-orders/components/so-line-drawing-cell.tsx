// Drawing control for one SO line. Since the Item + Drawing Rev register
// (owner model 2026-10-31) it is the shared DrawingRevField driven by the
// line's item and Drawing Rev: an existing ABC/1 drawing fills in by itself and
// shows read-only (fixed only via "Replace drawing…"), a new Item + Rev takes an
// upload, and a Rev change on a saved line offers "Use as is" / "Upload new".
//
// The preview opens in `drawing` mode: the link comes from the server, the look
// is logged, and Download shows only for people who hold the drawing-download
// tick.

import { DrawingRevField } from '@/modules/item-revisions/components/drawing-rev-field';

export function SoLineDrawingCell({
  value,
  onChange,
  refCode,
  itemId,
  itemCode,
  rev,
  savedRev,
  savedPath,
}: {
  value: string | null | undefined;
  onChange: (path: string | undefined) => void;
  /** What the access log should call this line — the SO code plus line number
   *  where the form knows them. Optional: on a brand-new SO there is no code
   *  yet, and the log falls back to the storage path. */
  refCode?: string;
  itemId?: string | null | undefined;
  itemCode?: string | null | undefined;
  /** The line's Drawing Rev as typed. */
  rev?: string | null | undefined;
  /** Saved line only: the Rev / file it was loaded with. */
  savedRev?: string | null | undefined;
  savedPath?: string | null | undefined;
}): React.JSX.Element {
  return (
    <DrawingRevField
      itemId={itemId}
      itemCode={itemCode}
      rev={rev}
      value={value}
      onChange={(p) => onChange(p ?? undefined)}
      source="so_line"
      refCode={refCode}
      savedRev={savedRev}
      savedPath={savedPath}
    />
  );
}
