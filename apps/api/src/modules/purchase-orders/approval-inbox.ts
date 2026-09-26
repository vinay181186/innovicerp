// POs waiting for THIS user's approval — the PO half of GET /approvals/inbox
// (ADR-189). Every rule is the approve endpoint's own (approvePurchaseOrder):
//   - Approve on Purchase Orders in the Access Control matrix, and a write role
//   - on approval_config.po_approvers (admins always) — loadApprovalContext
//   - PO Status Draft
//   - not raised by the caller (assertNotSelfApproval's rule)
//   - PO value (Σ qty × rate, no tax) within the caller's approval ceiling
// so every row listed is one the Approve button would accept.

import type { ApprovalInboxRow } from '@innovic/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { purchaseOrderLines, purchaseOrders, users, vendors } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice, hasFormAccess } from '../../lib/access';
import { isWriteRole } from '../../lib/auth';
import { loadApprovalContext } from './service';

/** The caller's Access Control answers for the PO inbox. Read BEFORE opening
 *  the inbox transaction — each check opens its own, and nesting them inside
 *  an open one holds two pool connections per request. */
export interface PoInboxAccess {
  canApprove: boolean;
  showMoney: boolean;
}

export async function loadPoInboxAccess(user: AuthContext): Promise<PoInboxAccess> {
  const canApprove = isWriteRole(user) && (await hasFormAccess(user, 'po_create', 'approve'));
  const showMoney = canApprove ? await canSeeFormPrice(user, 'po_create') : false;
  return { canApprove, showMoney };
}

export async function listPoApprovalInbox(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  access: PoInboxAccess,
): Promise<ApprovalInboxRow[]> {
  if (!access.canApprove) return [];
  const { isApprover, isAdmin, approvalCeiling } = await loadApprovalContext(
    tx,
    companyId,
    user.id,
    user.role,
  );
  if (!isApprover) return [];
  const { showMoney } = access;

  const rows = await tx
    .select({
      id: purchaseOrders.id,
      code: purchaseOrders.code,
      vendorName: vendors.name,
      vendorCodeText: purchaseOrders.vendorCodeText,
      createdAt: purchaseOrders.createdAt,
      createdByName: users.fullName,
      qty: sql<number>`coalesce(sum(${purchaseOrderLines.qty}), 0)::float`,
      poValue: sql<number>`coalesce(sum(${purchaseOrderLines.qty} * ${purchaseOrderLines.rate}), 0)::float`,
    })
    .from(purchaseOrders)
    .leftJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .leftJoin(
      purchaseOrderLines,
      and(
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id),
        isNull(purchaseOrderLines.deletedAt),
      ),
    )
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        isNull(purchaseOrders.deletedAt),
        eq(purchaseOrders.status, 'draft'),
        ne(purchaseOrders.createdBy, user.id),
      ),
    )
    .groupBy(purchaseOrders.id, vendors.name, users.fullName)
    .orderBy(purchaseOrders.createdAt);

  return rows
    .filter((r) => isAdmin || Number(r.poValue) <= approvalCeiling)
    .map((r) => ({
      id: r.id,
      docCode: r.code,
      vendorName: r.vendorName ?? r.vendorCodeText ?? null,
      itemCode: null,
      itemName: null,
      docQty: Number(r.qty),
      docAmount: showMoney ? Number(r.poValue) : null,
      createdByName: r.createdByName ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      navPage: `/purchase-orders/${r.id}`,
    }));
}
