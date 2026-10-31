// May a PO be raised from this Purchase Request right now? (ADR-189)
//
// A mirror of the server's `assertPrConvertible` (apps/api purchase-orders
// service) so a screen never offers "Create PO" for a PR the API will refuse.
// PRs have no approval step (owner rule 2026-10-31): a PR is ready for a PO
// as soon as it is raised. Only a Cancelled PR is refused. Old PRs stored as
// 'approved' are as ready as 'open' ones.

interface PrConvertSource {
  status: string;
}

/** True when the server would accept a PO raised from this PR (status-wise;
 *  the quantity-left check is the caller's, via `prOrderBalance`). */
export function prConvertible(pr: PrConvertSource): boolean {
  return pr.status !== 'cancelled';
}
