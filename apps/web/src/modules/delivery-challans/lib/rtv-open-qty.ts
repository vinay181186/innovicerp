/** How many pieces of one deviation are still to go back to the vendor.
 *
 *  ONE copy, because two screens print this number and their own comments
 *  promise the store reads the identical notice on both: +New DC → Against PO
 *  (routes/create.tsx) and the store's JW DC → New Outward DC modal
 *  (modules/jw-dc/components/new-outward-modal.tsx). Same pattern as
 *  lib/receipt-math.ts, which the GRN forms import from this module for the
 *  same reason.
 *
 *  Reads `openQty` (ADR-219: rejected − recovered − written off) and falls back
 *  to the GROSS `rejectedQty` only when `openQty` is absent — an older API, or
 *  the 409 payload, which carries the gross figure alone.
 *
 *  The emptiness test is on the RAW STRING, never on the number. `Number('0')`
 *  is falsy, so a `Number(openQty) || Number(rejectedQty)` fallback silently
 *  reports the gross figure for a fully recovered deviation — telling the store
 *  to ship pieces that are no longer owed, which is the exact fault this figure
 *  was added to remove. */
export function rtvOpenQty(r: { openQty?: string | null; rejectedQty: string }): number {
  const raw = String(r.openQty ?? '').trim();
  if (raw !== '') {
    const open = Number(raw);
    return Number.isFinite(open) && open > 0 ? open : 0;
  }
  const gross = Number(r.rejectedQty);
  return Number.isFinite(gross) && gross > 0 ? gross : 0;
}
