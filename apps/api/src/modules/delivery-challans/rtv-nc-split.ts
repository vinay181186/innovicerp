// 0237 — one return-to-vendor DC may carry SEVERAL NCs of one SO, one DC line
// per NC. The header nc_id stays the FIRST NC and only marks "this is a return
// DC"; every per-NC action reads the LINE's NC. The rule, in one place:
//
//   line NC = line.nc_id ?? header.nc_id   (old rows are backfilled; the
//                                            header is only a safety net)
//
// Pure helpers — the receive (book pieces back per NC) and the cancel (send
// every NC back to Disposed) both call them, so the two cannot disagree.

import { roundQty } from '@innovic/shared';

/** The NC a challan line carries: its own, else the header's (old rows). */
export function lineNcId(line: { ncId: string | null }, headerNcId: string | null): string | null {
  return line.ncId ?? headerNcId;
}

/**
 * This receipt's received qty per NC — never summed across NCs. Lines with no
 * NC (an ordinary DC) or 0 received are skipped. Sorted by NC id so two
 * receipts lock NC rows in the same order.
 */
export function receivedQtyByNc(
  lines: ReadonlyArray<{ ncId: string | null; receivedQty: number }>,
  headerNcId: string | null,
): Array<{ ncId: string; qty: number }> {
  const byNc = new Map<string, number>();
  for (const l of lines) {
    const ncId = lineNcId(l, headerNcId);
    const qty = roundQty(l.receivedQty);
    if (!ncId || !(qty > 0)) continue;
    byNc.set(ncId, roundQty((byNc.get(ncId) ?? 0) + qty));
  }
  return [...byNc.keys()].sort().map((ncId) => ({ ncId, qty: byNc.get(ncId)! }));
}

/**
 * Every NC a return DC carries — the header NC (the first) plus each line's —
 * distinct, sorted by id (the cancel's lock order). [] for an ordinary DC.
 */
export function returnDcNcIds(
  headerNcId: string | null,
  lines: ReadonlyArray<{ ncId: string | null }>,
): string[] {
  if (!headerNcId) return [];
  return [
    ...new Set([headerNcId, ...lines.map((l) => lineNcId(l, headerNcId) ?? headerNcId)]),
  ].sort();
}
