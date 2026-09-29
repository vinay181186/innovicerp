// ADR-196 — a Sales Order's fulfilment status, the ERPNext way.
//
// ERPNext's Sales Order carries two progress figures, per_delivered and
// per_billed, and derives its status from them (erpnext/selling/doctype/
// sales_order/sales_order.py + controllers/status_updater.py):
//
//   "To Deliver and Bill" · "To Deliver" · "To Bill" · "Completed" · "Closed"
//
// This is READ-TIME only. The stored `so_status` enum (draft / open / closed /
// dispatched / cancelled) is untouched: it records what the order is (a draft,
// cancelled, produced), while this answers "what is still to do on it?".
//
// Rules, per live (not cancelled) SO line:
//   - to deliver: the line is NOT short-closed and Dispatched < Order Qty.
//     A short-closed line's undelivered qty counts as done (ADR-196 Close).
//   - to bill:    Billed < Dispatched. Invoices here follow dispatches (an
//     invoice can bill only what was dispatched — invoices/service.ts), so
//     "To Bill" is the dispatched qty not yet invoiced; goods not yet shipped
//     are "To Deliver", not "To Bill". This is where it departs from ERPNext's
//     per_billed (which measures against the ordered amount): IN-SO-00419,
//     ordered 10, dispatched 8, billed 8 reads "To Deliver", not "To Deliver
//     and Bill".
//   - closed:     nothing left to do AND every live line is short-closed —
//     the result of the header Close (ERPNext's Closed). A mix of fully
//     delivered and short-closed lines with nothing left reads "Completed".
//
// Draft and cancelled orders (and an order with no live line) have no
// fulfilment status: null. Their own status badge already says it all.

export const SO_FULFILMENT_STATUSES = [
  'to_deliver_and_bill',
  'to_deliver',
  'to_bill',
  'completed',
  'closed',
] as const;

export type SoFulfilmentStatus = (typeof SO_FULFILMENT_STATUSES)[number];

/** The words the user reads — ERPNext's own labels. */
export const SO_FULFILMENT_STATUS_LABEL: Record<SoFulfilmentStatus, string> = {
  to_deliver_and_bill: 'To Deliver and Bill',
  to_deliver: 'To Deliver',
  to_bill: 'To Bill',
  completed: 'Completed',
  closed: 'Closed',
};

/** What the rule needs from the order's live (not cancelled) lines. The API
 *  builds it in SQL for the list and from the lines for the detail. */
export interface SoFulfilmentFacts {
  /** so_status of the header. */
  soStatus: string;
  /** Live (not cancelled, not deleted) line count. */
  liveLineCount: number;
  /** Any live line not short-closed with Dispatched < Order Qty. */
  anyToDeliver: boolean;
  /** Any live line with Billed < Dispatched. */
  anyToBill: boolean;
  /** Every live line is short-closed. */
  allShortClosed: boolean;
}

export function deriveSoFulfilmentStatus(f: SoFulfilmentFacts): SoFulfilmentStatus | null {
  if (f.soStatus === 'draft' || f.soStatus === 'cancelled') return null;
  if (f.liveLineCount <= 0) return null;
  if (f.anyToDeliver && f.anyToBill) return 'to_deliver_and_bill';
  if (f.anyToDeliver) return 'to_deliver';
  if (f.anyToBill) return 'to_bill';
  return f.allShortClosed ? 'closed' : 'completed';
}

/** One SO line as the rule sees it. */
export interface SoFulfilmentLine {
  status: string;
  orderQty: number;
  dispatchedQty: number;
  billedQty: number;
  shortClosedAt: string | null;
}

/** Build the facts from a detail read's lines (the list builds them in SQL). */
export function soFulfilmentFactsFromLines(
  soStatus: string,
  lines: readonly SoFulfilmentLine[],
): SoFulfilmentFacts {
  const live = lines.filter((l) => l.status !== 'cancelled');
  return {
    soStatus,
    liveLineCount: live.length,
    anyToDeliver: live.some((l) => !l.shortClosedAt && l.dispatchedQty < l.orderQty),
    anyToBill: live.some((l) => l.billedQty < l.dispatchedQty),
    allShortClosed: live.length > 0 && live.every((l) => Boolean(l.shortClosedAt)),
  };
}
