// Outsource Jobs — the two QUANTITY questions the tab asks of each OSP request,
// shared by the view (status counts + tick-box gate) and the row actions column
// (per-row Create PO). Split out of outsource-jobs-view.tsx so the view and its
// columns file can both read them without one file growing past the ceiling.
//
// Both ask the balance (ADR-152 phase 2/4), not the status: an OSP request for
// 100 with a PO for 10 still has 90 to buy, so it stays orderable and in the
// "Open PR" band — the same helper the PR card, PR detail and PO picker use.

import type { PurchaseRequestListItem } from '@innovic/shared';

import { prHasBalanceToOrder, prOrderBalance } from '@/modules/purchase-requests/lib/pr-balance';

/** May this request go on a NEW purchase order? The QUANTITY question, through
 *  the one balance helper — the same test the API makes in
 *  `assertPrCanTakeAnotherPo`, so the tick box and the server agree. Out:
 *  cancelled, short-closed, fully ordered, over-ordered. IN: anything with
 *  quantity still owed, INCLUDING a part-ordered request. */
export function ospCanOrder(pr: PurchaseRequestListItem): boolean {
  if (pr.status === 'cancelled') return false;
  return prHasBalanceToOrder(prOrderBalance(pr));
}

/** Which band a request belongs in — the QUANTITY question, not the status one.
 *  "Open PR" = there is still something to buy (exactly the rows that carry a
 *  tick box). "PO Created" = the buying is finished, because every piece is on a
 *  purchase order or the buyer short-closed the remainder. A cancelled request
 *  is in neither. */
export function ospBand(pr: PurchaseRequestListItem): 'open' | 'po_created' | null {
  if (pr.status === 'cancelled') return null;
  return ospCanOrder(pr) ? 'open' : 'po_created';
}
