// The one-SO-per-PO tick rule (ADR-316), shared by both tabs of the PR list
// (Purchase Requests and Outsource Jobs) and the PO form. The key itself is
// worked out ONCE, by the server (apps/api/src/lib/pr-order-key.ts), and sent on
// every PR row as `orderKey` / `orderCode` — the screens never re-derive it.

import type { PurchaseRequestListItem } from '@innovic/shared';

type OrderFields = Pick<PurchaseRequestListItem, 'orderKey' | 'orderCode'>;

/** The order group a PR belongs to: 'so:<id>' | 'jw:<id>' | 'none'. A PR with
 *  no SO behind it is its own group — it combines only with other no-SO PRs. */
export function prOrderKey(pr: OrderFields): string {
  return pr.orderKey;
}

/** The text shown for an order group: the SO / JWSO No., or "No SO". */
export function prOrderLabel(pr: OrderFields): string {
  const t = (pr.orderCode ?? '').trim();
  return t === '' ? 'No SO' : t;
}

/** Tip on a PR that cannot join the ticked PRs because its SO differs. */
export const PR_DIFFERENT_ORDER_TIP = 'Different SO — one PO takes PRs of one SO only';
