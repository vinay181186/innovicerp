// A Stock Count line while it is being keyed in (ADR-193 phase 2).
import type { StockCountLine } from '@innovic/shared';

/** A line being edited (draft / new). */
export interface DraftLine {
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string | null;
  inStock: number | null;
  countedQty: string;
  reason: string;
  /** Phase C — the Item + Drawing Rev bucket counted: an id, null = the
   *  no-Rev (old stock) bucket, undefined = not chosen / item has no Revs. */
  itemRevisionId?: string | null | undefined;
  /** The saved Drawing Rev text (display only — "ABC/1" on a read-only line). */
  drawingRev?: string | null | undefined;
}

/** One line per Item + Drawing Rev bucket. */
export const lineKey = (l: {
  itemId: string;
  itemRevisionId?: string | null | undefined;
}): string => `${l.itemId}|${l.itemRevisionId ?? ''}`;

/** A saved line back into the editor — with the Rev bucket it was saved
 *  under, so a re-opened draft shows that Rev already picked. */
export const fromServer = (l: StockCountLine): DraftLine => ({
  itemId: l.itemId,
  itemCode: l.itemCode,
  itemName: l.itemName,
  uom: l.uom,
  inStock: l.systemQtyNow,
  countedQty: String(l.countedQty),
  reason: l.reason ?? '',
  ...(l.itemRevisionId !== undefined ? { itemRevisionId: l.itemRevisionId } : {}),
  ...(l.drawingRev ? { drawingRev: l.drawingRev } : {}),
});
