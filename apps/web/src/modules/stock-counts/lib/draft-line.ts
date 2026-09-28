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
}

export const fromServer = (l: StockCountLine): DraftLine => ({
  itemId: l.itemId,
  itemCode: l.itemCode,
  itemName: l.itemName,
  uom: l.uom,
  inStock: l.systemQtyNow,
  countedQty: String(l.countedQty),
  reason: l.reason ?? '',
});
