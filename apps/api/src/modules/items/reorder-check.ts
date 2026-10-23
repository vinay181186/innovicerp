// Reorder Level / Reorder Qty — the ONE check on what may be saved (ADR-193
// phase 5, ADR-249 B2). Used by the Item edit writer (updateItemTx — which is
// also what an approved staged edit replays) and by Store → Reorder's staging
// pre-check and direct save (store-inventory/reorder.ts), so the three can
// never disagree.
//
// "Reorderable" is ITEM_TYPE_RULES[type].reorderable — the same source
// store-inventory/reorder-rule.ts REORDERABLE_TYPES is built from. Read here
// directly so this file does not import reorder-rule (which pulls in the
// purchase-request service) into the Item module.

import { ITEM_TYPE_RULES, type ItemType, roundQty } from '@innovic/shared';
import { assertQtyFitsUom } from '../../lib/stock-ledger';
import { ValidationError } from '../../lib/errors';

/** P48 — only reorderable item types carry a Reorder Level. */
export function notReorderableMessage(code: string): string {
  return `${code} is an Assembly — it is built, not reordered`;
}

/**
 * Refuse a Reorder Level / Reorder Qty the item cannot carry. Clearing (0 / 0)
 * is always allowed — it takes a wrongly-set level off. Returns the rounded
 * pair that is to be stored.
 */
export function assertReorderSettable(
  item: { code: string; uom: string; itemType: string },
  reorderLevel: number,
  reorderQty: number,
): { level: number; qty: number } {
  const level = roundQty(reorderLevel);
  const qty = roundQty(reorderQty);
  const reorderable = ITEM_TYPE_RULES[item.itemType as ItemType]?.reorderable === true;
  if ((level > 0 || qty > 0) && !reorderable) {
    throw new ValidationError(notReorderableMessage(item.code));
  }
  if (level > 0) assertQtyFitsUom(item.code, item.uom, level, 'Reorder Level');
  if (qty > 0) assertQtyFitsUom(item.code, item.uom, qty, 'Reorder Qty');
  return { level, qty };
}
