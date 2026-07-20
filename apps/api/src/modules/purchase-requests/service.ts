// Purchase Requests service (T-036a).
//
// Single-table per ADR-015 #2. Mirrors the legacy `addPR` / approval flow but
// keeps approvals + PO-creation as separate service-layer actions (not in the
// generic update path). Status flow: open → approved → po_created (or
// cancelled). Only the basic field updates land here in T-036a; the approve
// + create-PO actions ship in T-036b alongside the PO module.

import { and, count, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DocumentTraceability, RelatedDoc } from '@innovic/shared';
import {
  items,
  jcOps,
  jobCards,
  planOps,
  plans,
  purchaseOrders,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
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
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import { emitActivityLog } from '../activity-log/service';
import type {
  CreatePurchaseRequestInput,
  ListPurchaseRequestsQuery,
  ListPurchaseRequestsResponse,
  PurchaseRequest,
  PurchaseRequestDetail,
  PurchaseRequestListItem,
  UpdatePurchaseRequestInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function prDetail(
  code: string,
  itemName: string | null | undefined,
  itemCodeText: string | null | undefined,
  qty: number,
): string {
  const label = itemName ?? itemCodeText ?? '—';
  return `${code} — ${label} x ${qty}`;
}

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
      and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId), isNull(vendors.deletedAt)),
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
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
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
    .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
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
    prType: row.prType,
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
    const statusFrag = input.status ? sql`AND pr.status = ${input.status}::pr_status` : sql``;
    const vendorFrag = input.vendorId ? sql`AND pr.vendor_id = ${input.vendorId}::uuid` : sql``;
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
        COALESCE(v.name, vt.name) AS "vendorName",
        i.code AS "itemCode",
        jc.code AS "sourceJcCode",
        jo.op_seq AS "sourceJcOpSeq",
        po.code AS "poCode",
        so.code AS "soCode",
        sol.line_no AS "soLineNo"
      FROM public.purchase_requests pr
      LEFT JOIN public.vendors v
        ON v.id = pr.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.vendors vt
        ON vt.code = pr.vendor_code_text AND vt.company_id = pr.company_id AND vt.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = pr.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = pr.source_jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.job_cards jc
        ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = pr.po_id AND po.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = pr.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
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
    const conditions = [
      eq(purchaseRequests.companyId, companyId),
      isNull(purchaseRequests.deletedAt),
    ];
    if (input.status) conditions.push(eq(purchaseRequests.status, input.status));
    if (input.prType) conditions.push(eq(purchaseRequests.prType, input.prType));
    if (input.vendorId) conditions.push(eq(purchaseRequests.vendorId, input.vendorId));
    if (input.sourceJcOpId) conditions.push(eq(purchaseRequests.sourceJcOpId, input.sourceJcOpId));
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
    prType: ((r['prType'] as PurchaseRequest['prType'] | null) ?? 'standard'),
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
    soCode: (r['soCode'] as string | null) ?? null,
    soLineNo: r['soLineNo'] != null ? Number(r['soLineNo']) : null,
  };
}

export async function getPurchaseRequest(
  id: string,
  user: AuthContext,
): Promise<PurchaseRequestDetail> {
  const companyId = requireCompany(user);
  const vendorByCode = alias(vendors, 'vendor_by_code');
  return withUserContext(user, async (tx) => {
    // Resolve the vendor/item display joins the list already carries (per
    // docs/PARITY/linked-display-audit). Consumers previously had only
    // vendorCodeText to fall back on, which on an OSP-generated PR is the
    // '(vendor TBD)' sentinel — so a vendor picked later never showed.
    const rows = await tx
      .select({
        row: purchaseRequests,
        // Resolve the vendor name via the FK, else by matching the free-text
        // vendor_code_text to a vendor's code (ADR-015 free-text fallback) — so an
        // OSP/planning PR that stored the vendor code still shows the real name.
        vendorName: sql<string | null>`coalesce(${vendors.name}, ${vendorByCode.name})`,
        vendorCode: sql<string | null>`coalesce(${vendors.code}, ${vendorByCode.code})`,
        itemCode: items.code,
        // Resolve the source/linked document codes so the detail page shows real
        // values instead of a '— linked —' placeholder.
        poCode: purchaseOrders.code,
        sourceJcCode: jobCards.code,
        sourceJcOpSeq: jcOps.opSeq,
        soCode: salesOrders.code,
        soLineNo: salesOrderLines.lineNo,
      })
      .from(purchaseRequests)
      .leftJoin(
        vendors,
        and(eq(vendors.id, purchaseRequests.vendorId), isNull(vendors.deletedAt)),
      )
      .leftJoin(
        vendorByCode,
        and(
          eq(vendorByCode.code, purchaseRequests.vendorCodeText),
          eq(vendorByCode.companyId, purchaseRequests.companyId),
          isNull(vendorByCode.deletedAt),
        ),
      )
      .leftJoin(items, and(eq(items.id, purchaseRequests.itemId), isNull(items.deletedAt)))
      .leftJoin(
        purchaseOrders,
        and(eq(purchaseOrders.id, purchaseRequests.poId), isNull(purchaseOrders.deletedAt)),
      )
      .leftJoin(jcOps, and(eq(jcOps.id, purchaseRequests.sourceJcOpId), isNull(jcOps.deletedAt)))
      .leftJoin(jobCards, and(eq(jobCards.id, jcOps.jobCardId), isNull(jobCards.deletedAt)))
      .leftJoin(
        salesOrderLines,
        and(
          eq(salesOrderLines.id, purchaseRequests.sourceSoLineId),
          isNull(salesOrderLines.deletedAt),
        ),
      )
      .leftJoin(
        salesOrders,
        and(eq(salesOrders.id, salesOrderLines.salesOrderId), isNull(salesOrders.deletedAt)),
      )
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) throw new NotFoundError(`Purchase request ${id} not found`);
    return {
      ...toPurchaseRequest(found.row),
      vendorName: found.vendorName,
      vendorCode: found.vendorCode,
      itemCode: found.itemCode,
      poCode: found.poCode,
      sourceJcCode: found.sourceJcCode,
      sourceJcOpSeq: found.sourceJcOpSeq,
      soCode: found.soCode,
      soLineNo: found.soLineNo,
    };
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
        prType: input.prType ?? (input.sourceJcOpId ? 'jw_osp' : 'standard'),
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
    const row = inserted[0]!;

    // Legacy createPR write-back — HTML L6207-08:
    //   op.outsourceStatus='PR Raised'; op.outsourcePRNo=prNo;
    // When a PR is raised from an outsource JC op, stamp the source op so the
    // JC Ops board (jc-ops/service.ts joins pr ON pr.id = op.outsource_pr_id)
    // surfaces the raised PR. This is ATOMIC with the insert above — same tx —
    // so a committed PR is never left without its op stamped (the parity bug
    // this fixes). 'PR Raised' maps to the 'pr_raised' OUTSOURCE_STATUSES
    // member; legacy `op.outsourcePRNo` maps to our outsource_pr_id FK.
    // The op's existence/company was already asserted above (assertJcOpExists).
    if (input.sourceJcOpId) {
      await tx
        .update(jcOps)
        .set({
          outsourcePrId: row.id,
          outsourceStatus: 'pr_raised',
          updatedAt: new Date(),
          updatedBy: user.id,
        })
        .where(
          and(
            eq(jcOps.id, input.sourceJcOpId),
            eq(jcOps.companyId, companyId),
            isNull(jcOps.deletedAt),
          ),
        );
    }

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'PurchaseRequest',
        detail: prDetail(row.code, row.itemName, row.itemCodeText, row.qty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return toPurchaseRequest(row);
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
    // A PR converted to a PO is locked — no further edits.
    if (existing[0]!.poId !== null || existing[0]!.status === 'po_created') {
      throw new ConflictError(`Purchase request ${existing[0]!.code} is linked to a PO and cannot be edited`);
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
    const row = reread[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'PurchaseRequest',
        detail: prDetail(row.code, row.itemName, row.itemCodeText, row.qty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return toPurchaseRequest(row);
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
      .select({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        itemName: purchaseRequests.itemName,
        itemCodeText: purchaseRequests.itemCodeText,
        qty: purchaseRequests.qty,
        status: purchaseRequests.status,
        poId: purchaseRequests.poId,
      })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`Purchase request ${id} not found`);
    }
    // Block deletion when a PO has been generated — that PO carries the
    // procurement obligation. Cancel the PR instead (status='cancelled') if
    // needed; deletion is for mistakes pre-PO only.
    if (row.poId !== null) {
      throw new ConflictError(
        `Purchase request ${id} has a linked purchase order — cancel instead of delete`,
      );
    }
    await tx
      .update(purchaseRequests)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(purchaseRequests.id, id));
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'PurchaseRequest',
        detail: prDetail(row.code, row.itemName, row.itemCodeText, row.qty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}

// ─── Traceability (read-only related-documents graph) ──────────────────────
//
// New-ERP navigation enhancement (not in legacy). Mirrors
// getSalesOrderRelated: anchor existence check → company-scoped, soft-delete
// filtered FK subqueries → DocumentTraceability. Changes no business rule.
//
// Edges (verified FKs only):
//   Upstream (source):
//     - purchase_requests.vendor_id        → vendors        (nullable)
//     - purchase_requests.item_id          → items          (nullable)
//     - purchase_requests.source_so_line_id → sales_order_lines → sales_orders (nullable)
//     - purchase_requests.source_jc_op_id  → jc_ops → job_cards (nullable)
//   Downstream (generated):
//     - purchase_requests.po_id            → purchase_orders (nullable)
//     - plans linked via dp_pr_id / fo_pr_id / fo_mat_pr_id / material_pr_id
//       UNION plan_ops.outsource_pr_id (resolved to plan_id)
export async function getPurchaseRequestRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the PR is visible before gathering related docs; grab the source
    // FKs the upstream links resolve from.
    const headers = await tx
      .select({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        prDate: purchaseRequests.prDate,
        status: purchaseRequests.status,
        vendorId: purchaseRequests.vendorId,
        itemId: purchaseRequests.itemId,
        sourceSoLineId: purchaseRequests.sourceSoLineId,
        sourceJcOpId: purchaseRequests.sourceJcOpId,
        poId: purchaseRequests.poId,
      })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Purchase request ${id} not found`);

    // ── Upstream: vendor (source supplier) ─────────────────────────────────
    const vendorRows = header.vendorId
      ? await tx
          .select({ id: vendors.id, code: vendors.code, name: vendors.name })
          .from(vendors)
          .where(
            and(
              eq(vendors.id, header.vendorId),
              eq(vendors.companyId, companyId),
              isNull(vendors.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const vendor = vendorRows[0] ?? null;

    // ── Upstream: item ─────────────────────────────────────────────────────
    const itemRows = header.itemId
      ? await tx
          .select({ id: items.id, code: items.code, name: items.name })
          .from(items)
          .where(
            and(
              eq(items.id, header.itemId),
              eq(items.companyId, companyId),
              isNull(items.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const item = itemRows[0] ?? null;

    // ── Upstream: source Sales Order (via SO line → header) ────────────────
    const soRows = header.sourceSoLineId
      ? await tx
          .select({
            id: salesOrders.id,
            code: salesOrders.code,
            status: salesOrders.status,
            date: salesOrders.soDate,
          })
          .from(salesOrderLines)
          .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
          .where(
            and(
              eq(salesOrderLines.id, header.sourceSoLineId),
              eq(salesOrders.companyId, companyId),
              isNull(salesOrders.deletedAt),
              isNull(salesOrderLines.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const so = soRows[0] ?? null;

    // ── Upstream: source Job Card (OSP) (via JC op → header) ───────────────
    const jcRows = header.sourceJcOpId
      ? await tx
          .select({ id: jobCards.id, code: jobCards.code, date: jobCards.jcDate })
          .from(jcOps)
          .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
          .where(
            and(
              eq(jcOps.id, header.sourceJcOpId),
              eq(jobCards.companyId, companyId),
              isNull(jobCards.deletedAt),
              isNull(jcOps.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const jc = jcRows[0] ?? null;

    // ── Downstream: generated Purchase Order ───────────────────────────────
    const poRows = header.poId
      ? await tx
          .select({
            id: purchaseOrders.id,
            code: purchaseOrders.code,
            status: purchaseOrders.status,
            date: purchaseOrders.poDate,
          })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.id, header.poId),
              eq(purchaseOrders.companyId, companyId),
              isNull(purchaseOrders.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const po = poRows[0] ?? null;

    // ── Downstream: plans linked to this PR ────────────────────────────────
    // Header-level PR links (design-provisioned / fabrication-order / material).
    const directPlanRows = await tx
      .select({
        id: plans.id,
        code: plans.code,
        status: plans.planStatus,
        date: plans.planDate,
      })
      .from(plans)
      .where(
        and(
          eq(plans.companyId, companyId),
          isNull(plans.deletedAt),
          or(
            eq(plans.dpPrId, id),
            eq(plans.foPrId, id),
            eq(plans.foMatPrId, id),
            eq(plans.materialPrId, id),
          ),
        ),
      );
    // Plans whose outsource op raised this PR (plan_ops.outsource_pr_id).
    const opPlanRows = await tx
      .selectDistinct({
        id: plans.id,
        code: plans.code,
        status: plans.planStatus,
        date: plans.planDate,
      })
      .from(plans)
      .innerJoin(planOps, eq(planOps.planId, plans.id))
      .where(
        and(
          eq(plans.companyId, companyId),
          isNull(plans.deletedAt),
          eq(planOps.outsourcePrId, id),
          isNull(planOps.deletedAt),
        ),
      );
    const planById = new Map<string, (typeof directPlanRows)[number]>();
    for (const p of [...directPlanRows, ...opPlanRows]) planById.set(p.id, p);
    const planRows = Array.from(planById.values());

    const row = (
      id_: string,
      code: string,
      status: string | null,
      date: unknown,
      extra?: { linkId?: string; label?: string },
    ): RelatedDoc => ({
      id: id_,
      code,
      status,
      date: toIsoDate(date),
      linkId: extra?.linkId ?? null,
      label: extra?.label ?? null,
    });

    // ── Upstream sections (what this PR was raised FROM) ───────────────────
    const vendorSection = section(
      'vendor',
      'Vendor',
      '🏭',
      'vendor',
      vendor ? [row(vendor.id, vendor.code, null, null, { label: vendor.name })] : [],
    );
    const itemSection = section(
      'item',
      'Item',
      '📦',
      'item',
      item ? [row(item.id, item.code, null, null, { label: item.name })] : [],
    );
    const soSection = section(
      'sales-order',
      'Source Sales Order',
      '📄',
      'sales-order',
      so ? [row(so.id, so.code, so.status, so.date)] : [],
    );
    const jcSection = section(
      'job-card',
      'Source Job Card (OSP)',
      '📋',
      'job-card',
      jc ? [row(jc.id, jc.code, null, jc.date)] : [],
    );

    // ── Downstream sections (generated from this PR) ───────────────────────
    const poSection = section(
      'purchase-order',
      'Purchase Order',
      '🧾',
      'purchase-order',
      po ? [row(po.id, po.code, po.status, po.date)] : [],
    );
    const plansSection = section(
      'plans',
      'Planning',
      '🗂',
      'plan',
      planRows.map((p) => row(p.id, p.code, p.status, p.date)),
    );

    const upstream = [vendorSection, itemSection, soSection, jcSection];
    const downstream = [poSection, plansSection];
    return {
      self: { module: 'purchase-requests', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.prDate),
          label: 'Purchase Request created',
          code: header.code,
          routeKind: 'purchase-request',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}

// Silence unused-import — purchaseOrders is referenced via the JOIN in raw SQL.
void purchaseOrders;
void jobCards;
