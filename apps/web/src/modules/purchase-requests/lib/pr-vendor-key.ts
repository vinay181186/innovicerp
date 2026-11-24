// The one-vendor-per-PO tick rule, shared by both tabs of the PR list (the
// Purchase Requests cards and the Outsource Jobs table), so the two "Create PO
// from Selected" buttons refuse the same mixes.

import { isPrVendorTbdText, type PurchaseRequestListItem } from '@innovic/shared';

/** Which vendor a PR belongs to, for the one-vendor-per-PO tick rule — ONE key,
 *  the vendor code: the master's code (vendorCode, resolved by the server from
 *  vendorId or a matching code text) first, the typed code text second
 *  (ADR-015 pair). A linked PR and a text-only PR for the same vendor so get
 *  the same key. Null when the vendor is still TBD. */
export function prVendorKey(pr: PurchaseRequestListItem): string | null {
  const t = (pr.vendorCode ?? pr.vendorCodeText ?? '').trim().toUpperCase();
  // Blank or a TBD placeholder = not chosen yet (shared list, ADR-316).
  if (!isPrVendorTbdText(t)) return t;
  // Linked to a master row whose code did not resolve (deleted vendor): the
  // id is still one vendor.
  return pr.vendorId ? `id:${pr.vendorId}` : null;
}
