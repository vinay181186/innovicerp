// ADR-233 — the Production Order close history the detail page shows.
//
// Most rows are the append-only ledger (production_order_closes, ADR-179).
// Two events never write a ledger row (the ledger refuses qty 0), so they are
// built here from the order's own header fields — never stored twice:
//
//   short_close   status = 'short_closed' → short_closed_at / _by / reason.
//   finish_short  status = 'closed', lost_qty set, and NO live (un-reversed)
//                 Finish Short ledger row — i.e. a Finish Short that put 0
//                 into stock (closeProductionOrder skips the ledger insert
//                 when creditNow = 0). closed_at / closed_by + the reason the
//                 CLOSE_SHORT activity log recorded (the order has no column
//                 for it: close remarks never overwrite the planner Remarks).
//
// Both header rows use the ORDER's id as their id and `reversible: false`.
// They never co-exist: a 0-credit Finish Short row is only built while the
// order is 'closed'. If that order is later Short Closed, only the
// short_close row is built — the Finish Short is then visible in the History
// (activity log) tab, and the short_close row carries the same Short Closed
// Qty and the Lost Qty the Finish Short recorded (shortClose keeps it).
// One id per order on header rows is therefore safe; reverseProductionOrderClose
// refuses the order's own id with a plain message.
//
// Pure — no database — so it is unit-tested (close-history.unit.test.ts).

import type { ProductionOrderClose, ProductionOrderListItem } from './schema';

/** One ledger row as readClosesInTx reads it. */
export interface CloseLedgerRow {
  id: string;
  productionOrderId: string;
  qty: number;
  isReversal: boolean;
  reversesCloseId: string | null;
  lostQty: number | null;
  remarks: string | null;
  /** ISO timestamp. */
  closedAt: string;
  closedBy: string;
  closedByName: string | null;
}

/** The order header fields the header-built rows need. */
export type CloseHistoryOrder = Pick<
  ProductionOrderListItem,
  | 'id'
  | 'status'
  | 'orderQty'
  | 'lostQty'
  | 'shortClosedQty'
  | 'shortClosedAt'
  | 'shortClosedBy'
  | 'shortClosedByName'
  | 'shortCloseReason'
  | 'closedAt'
  | 'closedBy'
  | 'closedByName'
>;

/** True when a Finish Short that put nothing into stock must be built from the
 *  header (see file comment). The caller reads the reason only when this says so. */
export function needsZeroCreditFinishShortRow(
  order: CloseHistoryOrder,
  ledger: CloseLedgerRow[],
): boolean {
  if (order.status !== 'closed' || order.lostQty === null) return false;
  if (!order.closedAt || !order.closedBy) return false;
  const reversed = new Set(
    ledger.filter((r) => r.isReversal && r.reversesCloseId).map((r) => r.reversesCloseId),
  );
  return !ledger.some((r) => !r.isReversal && r.lostQty !== null && !reversed.has(r.id));
}

/** The whole history, newest first. `finishShortReason` is the reason of the
 *  latest CLOSE_SHORT activity entry, read only when the 0-credit Finish Short
 *  row applies (null otherwise / when none was found). */
export function buildCloseHistory(
  order: CloseHistoryOrder,
  ledger: CloseLedgerRow[],
  finishShortReason: string | null,
): ProductionOrderClose[] {
  // Stock Received running total, oldest first, so a Finish Short ledger row
  // states the Short Closed Qty it ended the order with at that moment.
  const chronological = [...ledger].sort((a, b) =>
    a.closedAt < b.closedAt ? -1 : a.closedAt > b.closedAt ? 1 : 0,
  );
  const shortAt = new Map<string, number>();
  let running = 0;
  for (const r of chronological) {
    running += r.isReversal ? -r.qty : r.qty;
    if (!r.isReversal && r.lostQty !== null) {
      shortAt.set(r.id, Math.max(0, order.orderQty - Math.max(0, running)));
    }
  }

  const rows: ProductionOrderClose[] = ledger.map((r) => {
    // A Finish Short that left nothing short (it received every remaining
    // piece) reads as an ordinary close, the same as its plain "Closed" badge.
    const kind: ProductionOrderClose['kind'] = r.isReversal
      ? 'reversal'
      : r.lostQty !== null && (shortAt.get(r.id) ?? 0) > 0
        ? 'finish_short'
        : 'close';
    return {
      id: r.id,
      productionOrderId: r.productionOrderId,
      kind,
      qty: r.qty,
      shortClosedQty: kind === 'finish_short' ? (shortAt.get(r.id) ?? null) : null,
      // A ledger row has a stock entry to undo; the server still refuses a
      // reversal of a reversal and a second reversal of the same close.
      reversible: true,
      isReversal: r.isReversal,
      reversesCloseId: r.reversesCloseId,
      lostQty: r.lostQty,
      remarks: r.remarks,
      closedAt: r.closedAt,
      closedBy: r.closedBy,
      closedByName: r.closedByName,
    };
  });

  if (order.status === 'short_closed' && order.shortClosedAt && order.shortClosedBy) {
    rows.push({
      id: order.id,
      productionOrderId: order.id,
      kind: 'short_close',
      qty: 0,
      shortClosedQty: order.shortClosedQty,
      reversible: false,
      isReversal: false,
      reversesCloseId: null,
      lostQty: order.lostQty,
      remarks: order.shortCloseReason,
      closedAt: order.shortClosedAt,
      closedBy: order.shortClosedBy,
      closedByName: order.shortClosedByName,
    });
  } else if (needsZeroCreditFinishShortRow(order, ledger)) {
    rows.push({
      id: order.id,
      productionOrderId: order.id,
      kind: 'finish_short',
      qty: 0,
      shortClosedQty: order.shortClosedQty,
      reversible: false,
      isReversal: false,
      reversesCloseId: null,
      lostQty: order.lostQty,
      remarks: finishShortReason,
      closedAt: order.closedAt!,
      closedBy: order.closedBy!,
      closedByName: order.closedByName,
    });
  }

  // Newest first (stable: ledger rows keep their read order on a tie).
  return rows.sort((a, b) => (a.closedAt < b.closedAt ? 1 : a.closedAt > b.closedAt ? -1 : 0));
}
