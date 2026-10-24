import { sql, type SQL } from 'drizzle-orm';
import type { RouteCardApprovalStatus } from '@innovic/shared';
import { ConflictError } from './errors';

// ADR-253 — ONE rule for "may this Route Card drive work?": only an APPROVED
// card may raise a Production Order or an ML-plan order, feed raw material to
// plans, or make a plan read "Gen production order". A Pending Approval or
// Rejected card exists but is not usable yet. Every reader uses this file —
// never a hand-written `approval_status = 'approved'`.

/** SQL predicate on a route_cards alias already in the query, e.g.
 *  `WHERE rc.deleted_at IS NULL AND ${routeCardUsableSql('rc')}`. */
export function routeCardUsableSql(alias: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`routeCardUsableSql: bad alias "${alias}"`);
  return sql.raw(`${alias}.approval_status = 'approved'`);
}

export function isRouteCardUsable(status: RouteCardApprovalStatus | string): boolean {
  return status === 'approved';
}

/** Throw the user-facing refusal when the card is not approved. Call it INSIDE
 *  the transaction that uses the card, after reading the card row (§20.3). */
export function assertRouteCardUsable(card: {
  code: string;
  approvalStatus: RouteCardApprovalStatus | string;
}): void {
  if (card.approvalStatus === 'approved') return;
  throw new ConflictError(
    card.approvalStatus === 'rejected'
      ? `Route Card ${card.code} was rejected. Correct it and send it for approval again before using it.`
      : `Route Card ${card.code} is waiting for approval. It can be used once it is approved.`,
  );
}
