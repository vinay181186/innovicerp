// How an item code is written wherever a drawing revision belongs with it:
// `CODE/REV` — "IN-IT-0007/B".
//
// The revision is the CUSTOMER'S drawing revision, typed on the Sales Order line
// (migration 0119). It is a fact about one order's drawing, not about the item,
// so it appears ONLY where the row on screen traces back to an SO line. An Items
// Master row, a purchase document, a vendor's GRN and a job-work line have no SO
// behind them and must keep showing the bare code — `items.revision` is a
// different column with a different meaning and the two must never be mixed.
//
// One helper so the separator and the empty cases cannot drift between screens.

/** `CODE/REV`, degrading gracefully. A missing revision leaves the code alone
 *  rather than printing a bare slash, and a missing code gives the caller's
 *  dash — a row whose item is unknown does not become "/B". */
export function itemCodeWithRev(
  code: string | null | undefined,
  revision: string | null | undefined,
  fallback = '—',
): string {
  const c = code?.trim();
  if (!c) return fallback;
  const r = revision?.trim();
  return r ? `${c}/${r}` : c;
}
