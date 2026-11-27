// Drawing of one SO line (ADR-323) — read-only. The PDF lives in the Drawing
// Register only; the line shows "📎 View drawing" when the register has one
// for its Item + Drawing Rev, the "latest verified drawing" confirm note and a
// note when the line's Drawing No. differs from the register's. No upload.

import {
  DrawingRevInfo,
  type DrawingRevInfoProps,
} from '@/modules/item-revisions/components/drawing-rev-field';

export function SoLineDrawingCell(props: {
  itemId?: string | null | undefined;
  itemCode?: string | null | undefined;
  /** The line's Drawing Rev as typed. */
  rev?: string | null | undefined;
  /** The line's Drawing No. as typed. */
  drawingNo?: string | null | undefined;
  /** ADR-290 — the "Confirmed" tick, owned by the form's useRevConfirmGate. */
  confirm?: DrawingRevInfoProps['confirm'];
}): React.JSX.Element | null {
  return (
    <DrawingRevInfo
      itemId={props.itemId}
      itemCode={props.itemCode}
      rev={props.rev}
      drawingNo={props.drawingNo ?? null}
      confirm={props.confirm}
    />
  );
}
