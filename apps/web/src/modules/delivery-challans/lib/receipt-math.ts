// Receipt arithmetic shared by every screen that books an OSP delivery challan
// back in: the standalone /delivery-challans/$id/receive page and the GRN
// screen's "Against JWPO / DC" tab. One copy so "how much of this line is
// still out at the vendor" is the same number on both screens.

import type { DeliveryChallanWithLines } from '@innovic/shared';

/** Qty already booked back per DC line id, summed over every receipt on the
 *  challan. Historical receipts may carry a legacy rejected_qty; it counts
 *  toward "already received" so remaining-qty math stays consistent with rows
 *  created before reject-at-receive was removed. */
export function computeReceivedByLine(detail: DeliveryChallanWithLines): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of detail.receipts) {
    for (const rl of r.lines) {
      const prev = out.get(rl.deliveryChallanLineId) ?? 0;
      out.set(
        rl.deliveryChallanLineId,
        prev + Number(rl.receivedQty) + Number(rl.rejectedQty ?? 0),
      );
    }
  }
  return out;
}
