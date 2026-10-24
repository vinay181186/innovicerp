// NEW Route Cards waiting for THIS user's approval — the RC half of GET
// /approvals/inbox (ADR-253, modelled on purchase-requests/approval-inbox.ts).
// The rules are approveRouteCard's own: Approve on Route Card Master and the
// card Pending Approval. The creator's own cards are INCLUDED — self-approval
// is allowed (owner, 2026-10-24). A Route Card carries no qty, value or vendor.

import type { ApprovalInboxRow } from '@innovic/shared';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { items, routeCards, users } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';

/** The caller's Access Control answer for the RC inbox. Read BEFORE opening
 *  the inbox transaction (each check opens its own). */
export interface RcInboxAccess {
  canApprove: boolean;
  /** No money on a Route Card — always false, kept for the shared inbox shape. */
  showMoney: boolean;
}

export async function loadRcInboxAccess(user: AuthContext): Promise<RcInboxAccess> {
  return { canApprove: await hasFormAccess(user, 'routecard_create', 'approve'), showMoney: false };
}

/** Where a waiting card opens. */
export const rcNavPage = (id: string): string => `/route-cards/${id}`;

export async function listRcApprovalInbox(
  tx: DbTransaction,
  companyId: string,
  access: RcInboxAccess,
): Promise<ApprovalInboxRow[]> {
  if (!access.canApprove) return [];
  const rows = await tx
    .select({
      id: routeCards.id,
      code: routeCards.code,
      itemCode: items.code,
      itemName: items.name,
      createdAt: routeCards.createdAt,
      createdByName: users.fullName,
      createdByEmail: users.email,
    })
    .from(routeCards)
    .leftJoin(items, eq(items.id, routeCards.itemId))
    .leftJoin(users, eq(users.id, routeCards.createdBy))
    .where(
      and(
        eq(routeCards.companyId, companyId),
        isNull(routeCards.deletedAt),
        eq(routeCards.approvalStatus, 'pending'),
      ),
    )
    .orderBy(routeCards.createdAt);

  return rows.map((r) => ({
    id: r.id,
    docCode: r.code,
    vendorName: null,
    itemCode: r.itemCode ?? null,
    itemName: r.itemName ?? null,
    docQty: null,
    docAmount: null,
    createdByName: r.createdByName?.trim() || r.createdByEmail?.split('@')[0] || null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    navPage: rcNavPage(r.id),
  }));
}

/** The same rows as the `t` row set approvals/inbox-list.ts pages over. */
export function rcInboxRowsSql(companyId: string): SQL {
  return sql`
    SELECT rc.id, rc.code AS doc_code,
      NULL::text AS vendor_name,
      i.code AS item_code, i.name AS item_name,
      NULL::float AS doc_qty, NULL::float AS doc_amount,
      COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1)) AS created_by_name,
      rc.created_at
    FROM public.route_cards rc
    LEFT JOIN public.items i ON i.id = rc.item_id
    LEFT JOIN public.users u ON u.id = rc.created_by
    WHERE rc.company_id = ${companyId}::uuid
      AND rc.deleted_at IS NULL
      AND rc.approval_status = 'pending'`;
}
