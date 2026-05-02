// Purchase Requests service (T-036a).
//
// Single-table per ADR-015 #2. Mirrors the legacy `addPR` / approval flow but
// keeps approvals + PO-creation as separate service-layer actions (not in the
// generic update path). Status flow: open → approved → po_created (or
// cancelled). Only the basic field updates land here in T-036a; the approve
// + create-PO actions ship in T-036b alongside the PO module.

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import {
  items,
  jcOps,
  jobCards,
  purchaseOrders,
  purchaseRequests,
  salesOrderLines,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import type {
  CreatePurchaseRequestInput,
  ListPurchaseRequestsQuery,
  ListPurchaseRequestsResponse,
  PurchaseRequest,
  PurchaseRequestListItem,
  UpdatePurchaseRequestInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// ─── FK validation helpers ────────────────────────────────────────────────

async function assertVendorExists(
  tx: DbTransaction,
  vendorId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        eq(vendors.id, vendorId),
        eq(vendors.companyId, companyId),
        isNull(vendors.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Vendor ${vendorId} not found in this company`);
  }
}

async function assertItemExists(
  tx: DbTransaction,
  itemId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.id, itemId),
        eq(items.companyId, companyId),
        isNull(items.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Item ${itemId} not found in this company`);
  }
}

async function assertJcOpExists(
  tx: DbTransaction,
  jcOpId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: jcOps.id })
    .from(jcOps)
    .where(
      and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`JC op ${jcOpId} not found in this company`);
  }
}

async function assertSoLineExists(
  tx: DbTransaction,
  soLineId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.id, soLineId),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`SO line ${soLineId} not found in this company`);
  }
}

function estCostToString(input: number | undefined): string {
  return (input ?? 0).toFixed(2);
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function maybeTsLike(v: unknown): string | null {
  if (v == null) return null;
  return tsLike(v);
}

function maybeDateLike(v: unknown): string | null {
  if (v == null) return null;
  return dateLike(v);
}

function toPurchaseRequest(row: typeof purchaseRequests.$inferSelect): PurchaseRequest {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    prDate: row.prDate,
    status: row.status,
    vendorId: row.vendorId,
    vendorCodeText: row.vendorCodeText,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemName: row.itemName,
    qty: row.qty,
    estCost: row.estCost,
    requiredDate: row.requiredDate,
    sourceJcOpId: row.sourceJcOpId,
    sourceSoLineId: row.sourceSoLineId,
    operation: row.operation,
    remarks: row.remarks,
    approvedBy: row.approvedBy,
    approvedAt: maybeTsLike(row.approvedAt),
    poId: row.poId,
    poCreatedAt: maybeTsLike(row.poCreatedAt),
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listPurchaseRequests(
  input: ListPurchaseRequestsQuery,
  user: AuthContext,
): Promise<ListPurchaseRequestsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (pr.code ILIKE ${term} OR pr.operation ILIKE ${term} OR pr.item_name ILIKE ${term})`
      : sql``;
    const statusFrag = input.status
      ? sql`AND pr.status = ${input.status}::pr_status`
      : sql``;
    const vendorFrag = input.vendorId
      ? sql`AND pr.vendor_id = ${input.vendorId}::uuid`
      : sql``;
    const jcOpFrag = input.sourceJcOpId
      ? sql`AND pr.source_jc_op_id = ${input.sourceJcOpId}::uuid`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND pr.pr_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND pr.pr_date <= ${input.toDate}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        pr.id, pr.company_id AS "companyId", pr.code,
        pr.pr_date AS "prDate", pr.status,
        pr.vendor_id AS "vendorId", pr.vendor_code_text AS "vendorCodeText",
        pr.item_id AS "itemId", pr.item_code_text AS "itemCodeText",
        pr.item_name AS "itemName",
        pr.qty, pr.est_cost::text AS "estCost", pr.required_date AS "requiredDate",
        pr.source_jc_op_id AS "sourceJcOpId",
        pr.source_so_line_id AS "sourceSoLineId",
        pr.operation, pr.remarks,
        pr.approved_by AS "approvedBy", pr.approved_at AS "approvedAt",
        pr.po_id AS "poId", pr.po_created_at AS "poCreatedAt",
        pr.created_at AS "createdAt", pr.created_by AS "createdBy",
        pr.updated_at AS "updatedAt", pr.updated_by AS "updatedBy",
        pr.deleted_at AS "deletedAt",
        v.name AS "vendorName",
        i.code AS "itemCode",
        jc.code AS "sourceJcCode",
        jo.op_seq AS "sourceJcOpSeq",
        po.code AS "poCode"
      FROM public.purchase_requests pr
      LEFT JOIN public.vendors v
        ON v.id = pr.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = pr.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = pr.source_jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.job_cards jc
        ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = pr.po_id AND po.deleted_at IS NULL
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${vendorFrag}
        ${jcOpFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY pr.code ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total — same fast count pattern as sales-orders.
    const conditions = [eq(purchaseRequests.companyId, companyId), isNull(purchaseRequests.deletedAt)];
    if (input.status) conditions.push(eq(purchaseRequests.status, input.status));
    if (input.vendorId) conditions.push(eq(purchaseRequests.vendorId, input.vendorId));
    if (input.sourceJcOpId)
      conditions.push(eq(purchaseRequests.sourceJcOpId, input.sourceJcOpId));
    const totalRows = await tx
      .select({ value: count() })
      .from(purchaseRequests)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const rowsList = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: rowsList, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): PurchaseRequestListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    prDate: dateLike(r['prDate']),
    status: r['status'] as PurchaseRequest['status'],
    vendorId: (r['vendorId'] as string | null) ?? null,
    vendorCodeText: (r['vendorCodeText'] as string | null) ?? null,
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: (r['itemCodeText'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    qty: Number(r['qty'] ?? 0),
    estCost: r['estCost'] as string,
    requiredDate: maybeDateLike(r['requiredDate']),
    sourceJcOpId: (r['sourceJcOpId'] as string | null) ?? null,
    sourceSoLineId: (r['sourceSoLineId'] as string | null) ?? null,
    operation: (r['operation'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    approvedBy: (r['approvedBy'] as string | null) ?? null,
    approvedAt: maybeTsLike(r['approvedAt']),
    poId: (r['poId'] as string | null) ?? null,
    poCreatedAt: maybeTsLike(r['poCreatedAt']),
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    vendorName: (r['vendorName'] as string | null) ?? null,
    itemCode: (r['itemCode'] as string | null) ?? null,
    sourceJcCode: (r['sourceJcCode'] as string | null) ?? null,
    sourceJcOpSeq: r['sourceJcOpSeq'] != null ? Number(r['sourceJcOpSeq']) : null,
    poCode: (r['poCode'] as string | null) ?? null,
  };
}

export async function getPurchaseRequest(
  id: string,
  user: AuthContext,
): Promise<PurchaseRequest> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Purchase request ${id} not found`);
    return toPurchaseRequest(row);
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
  user: AuthContext,
): Promise<PurchaseRequest> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Code uniqueness within company
    const dup = await tx
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.companyId, companyId),
          eq(purchaseRequests.code, input.code),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Purchase request code "${input.code}" already exists`);
    }

    if (input.vendorId) await assertVendorExists(tx, input.vendorId, companyId);
    if (input.itemId) await assertItemExists(tx, input.itemId, companyId);
    if (input.sourceJcOpId) await assertJcOpExists(tx, input.sourceJcOpId, companyId);
    if (input.sourceSoLineId) await assertSoLineExists(tx, input.sourceSoLineId, companyId);

    const inserted = await tx
      .insert(purchaseRequests)
      .values({
        companyId,
        code: input.code,
        prDate: input.prDate,
        status: input.status ?? 'open',
        vendorId: input.vendorId ?? null,
        vendorCodeText: input.vendorCodeText ?? null,
        itemId: input.itemId ?? null,
        itemCodeText: input.itemCodeText ?? null,
        itemName: input.itemName ?? null,
        qty: input.qty,
        estCost: estCostToString(input.estCost),
        requiredDate: input.requiredDate ?? null,
        sourceJcOpId: input.sourceJcOpId ?? null,
        sourceSoLineId: input.sourceSoLineId ?? null,
        operation: input.operation ?? null,
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return toPurchaseRequest(inserted[0]!);
  });
}

export async function updatePurchaseRequest(
  id: string,
  input: UpdatePurchaseRequestInput,
  user: AuthContext,
): Promise<PurchaseRequest> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`Purchase request ${id} not found`);
    }

    if (input.vendorId !== undefined && input.vendorId !== null) {
      await assertVendorExists(tx, input.vendorId, companyId);
    }
    if (input.itemId !== undefined && input.itemId !== null) {
      await assertItemExists(tx, input.itemId, companyId);
    }
    if (input.sourceJcOpId !== undefined && input.sourceJcOpId !== null) {
      await assertJcOpExists(tx, input.sourceJcOpId, companyId);
    }
    if (input.sourceSoLineId !== undefined && input.sourceSoLineId !== null) {
      await assertSoLineExists(tx, input.sourceSoLineId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.prDate !== undefined) updates['prDate'] = input.prDate;
    if (input.status !== undefined) updates['status'] = input.status;
    if (input.vendorId !== undefined) updates['vendorId'] = input.vendorId ?? null;
    if (input.vendorCodeText !== undefined)
      updates['vendorCodeText'] = input.vendorCodeText ?? null;
    if (input.itemId !== undefined) updates['itemId'] = input.itemId ?? null;
    if (input.itemCodeText !== undefined) updates['itemCodeText'] = input.itemCodeText ?? null;
    if (input.itemName !== undefined) updates['itemName'] = input.itemName ?? null;
    if (input.qty !== undefined) updates['qty'] = input.qty;
    if (input.estCost !== undefined) updates['estCost'] = estCostToString(input.estCost);
    if (input.requiredDate !== undefined) updates['requiredDate'] = input.requiredDate ?? null;
    if (input.sourceJcOpId !== undefined) updates['sourceJcOpId'] = input.sourceJcOpId ?? null;
    if (input.sourceSoLineId !== undefined)
      updates['sourceSoLineId'] = input.sourceSoLineId ?? null;
    if (input.operation !== undefined) updates['operation'] = input.operation ?? null;
    if (input.remarks !== undefined) updates['remarks'] = input.remarks ?? null;

    await tx.update(purchaseRequests).set(updates).where(eq(purchaseRequests.id, id));

    const reread = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, id))
      .limit(1);
    return toPurchaseRequest(reread[0]!);
  });
}

export async function softDeletePurchaseRequest(
  id: string,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: purchaseRequests.id, status: purchaseRequests.status, poId: purchaseRequests.poId })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`Purchase request ${id} not found`);
    }
    // Block deletion when a PO has been generated — that PO carries the
    // procurement obligation. Cancel the PR instead (status='cancelled') if
    // needed; deletion is for mistakes pre-PO only.
    if (existing[0]!.poId !== null) {
      throw new ConflictError(
        `Purchase request ${id} has a linked purchase order — cancel instead of delete`,
      );
    }
    await tx
      .update(purchaseRequests)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(purchaseRequests.id, id));
    return { ok: true };
  });
}

// Silence unused-import — purchaseOrders is referenced via the JOIN in raw SQL.
void purchaseOrders;
void jobCards;
