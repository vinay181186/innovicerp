// PRs waiting for THIS user's approval — the PR half of GET /approvals/inbox
// (ADR-189). The rules are approvePurchaseRequest's own: Approve on Purchase
// Requests in the Access Control matrix, PR Status Open, and not raised by the
// caller (segregation of duty, 0100). Nothing else gates a PR approval today.

import type { ApprovalInboxRow } from '@innovic/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { items, purchaseRequests, users, vendors } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice, hasFormAccess } from '../../lib/access';

export async function listPrApprovalInbox(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
): Promise<ApprovalInboxRow[]> {
  if (!(await hasFormAccess(user, 'pr_create', 'approve'))) return [];
  const showMoney = await canSeeFormPrice(user, 'pr_create');

  const rows = await tx
    .select({
      id: purchaseRequests.id,
      code: purchaseRequests.code,
      vendorName: vendors.name,
      vendorCodeText: purchaseRequests.vendorCodeText,
      itemCode: items.code,
      itemCodeText: purchaseRequests.itemCodeText,
      itemName: purchaseRequests.itemName,
      qty: purchaseRequests.qty,
      estCost: purchaseRequests.estCost,
      createdAt: purchaseRequests.createdAt,
      createdByName: users.fullName,
    })
    .from(purchaseRequests)
    .leftJoin(vendors, eq(vendors.id, purchaseRequests.vendorId))
    .leftJoin(items, eq(items.id, purchaseRequests.itemId))
    .leftJoin(users, eq(users.id, purchaseRequests.createdBy))
    .where(
      and(
        eq(purchaseRequests.companyId, companyId),
        isNull(purchaseRequests.deletedAt),
        eq(purchaseRequests.status, 'open'),
        ne(purchaseRequests.createdBy, user.id),
      ),
    )
    .orderBy(purchaseRequests.createdAt);

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    vendorName: r.vendorName ?? r.vendorCodeText ?? null,
    itemCode: r.itemCode ?? r.itemCodeText ?? null,
    itemName: r.itemName ?? null,
    qty: r.qty,
    // Est. Rate is per piece (the form labels it ₹/pc).
    amount: showMoney ? r.qty * Number(r.estCost ?? 0) : null,
    createdByName: r.createdByName ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    navPage: `/purchase-requests/${r.id}`,
  }));
}
