// Purchase Orders service (T-036b).
//
// Header + lines per ADR-015 #1. Mirrors the legacy `addPO()` line 25728 +
// `_editFullPO()` flow but enforces CLAUDE.md §6 contracts: validation here,
// RLS at DB, soft-delete only, no business logic in routes.
//
// Update merge follows the same option-C semantics as sales-orders /
// job-work-orders: if `lines` is present in the payload, run the legacy merge;
// if omitted, only the header is updated. `received_qty` on lines is mutated
// by the GRN cascade in T-036c — the update path here will preserve it
// untouched on existing lines (we never re-write received_qty from the form).
//
// Plus a third entry-point — `createPurchaseOrderFromPr` — that builds a
// single-line PO from a PR row in one transaction, also setting PR.poId /
// poCreatedAt / status='po_created'. Mirrors legacy `addPO()` line 25728.

import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  approvalConfig,
  items,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
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
import { emitActivityLog } from '../activity-log/service';
import type {
  CreatePurchaseOrderFromPrInput,
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  ListPurchaseOrdersResponse,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderLine,
  PurchaseOrderLineInput,
  PurchaseOrderListItem,
  UpdatePurchaseOrderInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function poDetail(code: string, vendorCodeText: string | null | undefined): string {
  return vendorCodeText ? `${code} — ${vendorCodeText}` : code;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

async function assertItemIdsExist(
  tx: DbTransaction,
  itemIds: string[],
  companyId: string,
): Promise<void> {
  const unique = Array.from(new Set(itemIds));
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    throw new ValidationError(`Item id(s) not found: ${missing.join(', ')}`);
  }
}

async function resolveItemCodes(
  tx: DbTransaction,
  codes: string[],
  companyId: string,
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(
      and(eq(items.companyId, companyId), inArray(items.code, codes), isNull(items.deletedAt)),
    );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.code, r.id);
  return map;
}

function resolveLineItemRefs(
  line: PurchaseOrderLineInput,
  resolved: Map<string, string>,
): { itemId: string | null; itemCodeText: string | null } {
  if (line.itemId) {
    return { itemId: line.itemId, itemCodeText: null };
  }
  const code = line.itemCodeText?.trim();
  if (!code) {
    throw new ValidationError('itemId or itemCodeText is required');
  }
  const found = resolved.get(code);
  return found ? { itemId: found, itemCodeText: null } : { itemId: null, itemCodeText: code };
}

function assignLineNos(lines: PurchaseOrderLineInput[], startFrom: number): number[] {
  const provided = lines.filter((l) => l.lineNo !== undefined);
  if (provided.length > 0 && provided.length !== lines.length) {
    throw new ValidationError('Provide lineNo on every line or none');
  }
  if (provided.length === 0) {
    return lines.map((_, i) => startFrom + i);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const l of lines) {
    const n = l.lineNo!;
    if (seen.has(n)) {
      throw new ValidationError(`Duplicate lineNo ${n} within input`);
    }
    seen.add(n);
    out.push(n);
  }
  return out;
}

function rateToString(input: PurchaseOrderLineInput): string {
  return (input.rate ?? 0).toFixed(2);
}

function pctToString(p: number): string {
  return p.toFixed(2);
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

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listPurchaseOrders(
  input: ListPurchaseOrdersQuery,
  user: AuthContext,
): Promise<ListPurchaseOrdersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (po.code ILIKE ${term} OR po.pr_code_text ILIKE ${term} OR po.vendor_code_text ILIKE ${term})`
      : sql``;
    const statusFrag = input.status ? sql`AND po.status = ${input.status}::po_status` : sql``;
    const typeFrag = input.poType ? sql`AND po.po_type = ${input.poType}::po_type` : sql``;
    const vendorFrag = input.vendorId ? sql`AND po.vendor_id = ${input.vendorId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND po.po_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND po.po_date <= ${input.toDate}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        po.id, po.company_id AS "companyId", po.code,
        po.po_date AS "poDate", po.po_type AS "poType",
        po.vendor_id AS "vendorId", po.vendor_code_text AS "vendorCodeText",
        po.status,
        po.due_date AS "dueDate", po.tax_type AS "taxType",
        po.sgst_pct::text AS "sgstPct",
        po.cgst_pct::text AS "cgstPct",
        po.igst_pct::text AS "igstPct",
        po.pr_code_text AS "prCodeText",
        po.approved_by AS "approvedBy", po.approved_at AS "approvedAt",
        po.approval_remarks AS "approvalRemarks", po.remarks,
        po.created_at AS "createdAt", po.created_by AS "createdBy",
        po.updated_at AS "updatedAt", po.updated_by AS "updatedBy",
        po.deleted_at AS "deletedAt",
        v.name AS "vendorName",
        COALESCE(line_agg.line_count, 0)::int  AS "lineCount",
        COALESCE(line_agg.total_qty, 0)::int   AS "totalQty",
        COALESCE(line_agg.received_qty, 0)::int AS "receivedQty"
      FROM public.purchase_orders po
      LEFT JOIN public.vendors v ON v.id = po.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN (
        SELECT purchase_order_id,
               COUNT(*) AS line_count,
               SUM(qty) AS total_qty,
               SUM(received_qty) AS received_qty
        FROM public.purchase_order_lines
        WHERE deleted_at IS NULL
        GROUP BY purchase_order_id
      ) line_agg ON line_agg.purchase_order_id = po.id
      WHERE po.company_id = ${companyId}::uuid
        AND po.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${typeFrag}
        ${vendorFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY po.code ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(purchaseOrders.companyId, companyId), isNull(purchaseOrders.deletedAt)];
    if (input.status) conditions.push(eq(purchaseOrders.status, input.status));
    if (input.poType) conditions.push(eq(purchaseOrders.poType, input.poType));
    if (input.vendorId) conditions.push(eq(purchaseOrders.vendorId, input.vendorId));
    const totalRows = await tx
      .select({ value: count() })
      .from(purchaseOrders)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const rowsList = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: rowsList, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): PurchaseOrderListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    poDate: dateLike(r['poDate']),
    poType: r['poType'] as PurchaseOrder['poType'],
    vendorId: (r['vendorId'] as string | null) ?? null,
    vendorCodeText: (r['vendorCodeText'] as string | null) ?? null,
    status: r['status'] as PurchaseOrder['status'],
    dueDate: maybeDateLike(r['dueDate']),
    taxType: (r['taxType'] as string | null) ?? null,
    sgstPct: r['sgstPct'] as string,
    cgstPct: r['cgstPct'] as string,
    igstPct: r['igstPct'] as string,
    prCodeText: (r['prCodeText'] as string | null) ?? null,
    approvedBy: (r['approvedBy'] as string | null) ?? null,
    approvedAt: maybeTsLike(r['approvedAt']),
    approvalRemarks: (r['approvalRemarks'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    vendorName: (r['vendorName'] as string | null) ?? null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalQty: Number(r['totalQty'] ?? 0),
    receivedQty: Number(r['receivedQty'] ?? 0),
  };
}

export async function getPurchaseOrder(
  id: string,
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headerRows = await tx
      .select({ row: purchaseOrders, vendorName: vendors.name })
      .from(purchaseOrders)
      .leftJoin(vendors, and(eq(vendors.id, purchaseOrders.vendorId), isNull(vendors.deletedAt)))
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const headerRow = headerRows[0];
    if (!headerRow) throw new NotFoundError(`Purchase order ${id} not found`);

    const lineRows = await tx
      .select({ row: purchaseOrderLines, itemCode: items.code })
      .from(purchaseOrderLines)
      .leftJoin(items, and(eq(items.id, purchaseOrderLines.itemId), isNull(items.deletedAt)))
      .where(and(eq(purchaseOrderLines.purchaseOrderId, id), isNull(purchaseOrderLines.deletedAt)))
      .orderBy(asc(purchaseOrderLines.lineNo));

    return {
      ...toPurchaseOrder(headerRow.row),
      vendorName: headerRow.vendorName,
      lines: lineRows.map((r) => toPurchaseOrderLine(r.row, r.itemCode)),
    };
  });
}

function toPurchaseOrder(row: typeof purchaseOrders.$inferSelect): PurchaseOrder {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    poDate: row.poDate,
    poType: row.poType,
    vendorId: row.vendorId,
    vendorCodeText: row.vendorCodeText,
    status: row.status,
    dueDate: row.dueDate,
    taxType: row.taxType,
    sgstPct: row.sgstPct,
    cgstPct: row.cgstPct,
    igstPct: row.igstPct,
    prCodeText: row.prCodeText,
    approvedBy: row.approvedBy,
    approvedAt: maybeTsLike(row.approvedAt),
    approvalRemarks: row.approvalRemarks,
    remarks: row.remarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

function toPurchaseOrderLine(
  row: typeof purchaseOrderLines.$inferSelect,
  itemCode: string | null = null,
): PurchaseOrderLine {
  return {
    id: row.id,
    companyId: row.companyId,
    purchaseOrderId: row.purchaseOrderId,
    lineNo: row.lineNo,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemCode,
    itemName: row.itemName,
    qty: row.qty,
    rate: row.rate,
    receivedQty: row.receivedQty,
    dueDate: row.dueDate,
    sourceSoLineId: row.sourceSoLineId,
    sourceJcOpId: row.sourceJcOpId,
    lineRemarks: row.lineRemarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.code, input.header.code),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Purchase order code "${input.header.code}" already exists`);
    }

    if (input.header.vendorId) {
      await assertVendorExists(tx, input.header.vendorId, companyId);
    }

    const directIds = input.lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
    await assertItemIdsExist(tx, directIds, companyId);
    const codesToResolve = input.lines
      .filter((l) => !l.itemId && l.itemCodeText)
      .map((l) => l.itemCodeText!.trim());
    const resolved = await resolveItemCodes(tx, codesToResolve, companyId);
    const lineNos = assignLineNos(input.lines, 1);

    // Legacy `_poInitialStatus()` L21589: 'draft' if PO approval enabled,
    // else 'open'. Caller-passed status wins. APPROVAL_CONFIG_DEFAULTS has
    // poApproval=true so the default path is to require approval.
    let initialStatus: 'draft' | 'open' = 'draft';
    if (!input.header.status) {
      const cfgRows = await tx
        .select({ poApproval: approvalConfig.poApproval })
        .from(approvalConfig)
        .where(and(eq(approvalConfig.companyId, companyId), isNull(approvalConfig.deletedAt)))
        .limit(1);
      const poApprovalOn = cfgRows[0]?.poApproval ?? true;
      initialStatus = poApprovalOn ? 'draft' : 'open';
    }
    const headerStatus = input.header.status ?? initialStatus;
    const headerType = input.header.poType ?? 'standard';
    const inserted = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        code: input.header.code,
        poDate: input.header.poDate,
        poType: headerType,
        vendorId: input.header.vendorId ?? null,
        vendorCodeText: input.header.vendorCodeText ?? null,
        status: headerStatus,
        dueDate: input.header.dueDate ?? null,
        taxType: input.header.taxType ?? null,
        sgstPct: pctToString(input.header.sgstPct ?? 0),
        cgstPct: pctToString(input.header.cgstPct ?? 0),
        igstPct: pctToString(input.header.igstPct ?? 0),
        prCodeText: input.header.prCodeText ?? null,
        approvalRemarks: input.header.approvalRemarks ?? null,
        remarks: input.header.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    const lineValues = input.lines.map((l, i) => {
      const refs = resolveLineItemRefs(l, resolved);
      return {
        companyId,
        purchaseOrderId: header.id,
        lineNo: lineNos[i]!,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        itemName: l.itemName,
        qty: l.qty,
        rate: rateToString(l),
        receivedQty: l.receivedQty ?? 0,
        dueDate: l.dueDate ?? null,
        sourceSoLineId: l.sourceSoLineId ?? null,
        sourceJcOpId: l.sourceJcOpId ?? null,
        lineRemarks: l.lineRemarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      };
    });
    const insertedLines = await tx.insert(purchaseOrderLines).values(lineValues).returning();

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'PurchaseOrder',
        detail: poDetail(header.code, header.vendorCodeText),
        refId: header.code,
      },
      companyId,
      user,
    );

    return {
      ...toPurchaseOrder(header),
      vendorName: null,
      lines: insertedLines.map((row) => toPurchaseOrderLine(row)),
    };
  });
}

export async function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderInput,
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existingHdrRows = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const existingHdr = existingHdrRows[0];
    if (!existingHdr) throw new NotFoundError(`Purchase order ${id} not found`);

    if (input.header.vendorId !== undefined && input.header.vendorId !== null) {
      await assertVendorExists(tx, input.header.vendorId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    const h = input.header;
    if (h.poDate !== undefined) updates['poDate'] = h.poDate;
    if (h.poType !== undefined) updates['poType'] = h.poType;
    if (h.vendorId !== undefined) updates['vendorId'] = h.vendorId ?? null;
    if (h.vendorCodeText !== undefined) updates['vendorCodeText'] = h.vendorCodeText ?? null;
    if (h.status !== undefined) updates['status'] = h.status;
    if (h.dueDate !== undefined) updates['dueDate'] = h.dueDate ?? null;
    if (h.taxType !== undefined) updates['taxType'] = h.taxType ?? null;
    if (h.sgstPct !== undefined) updates['sgstPct'] = pctToString(h.sgstPct);
    if (h.cgstPct !== undefined) updates['cgstPct'] = pctToString(h.cgstPct);
    if (h.igstPct !== undefined) updates['igstPct'] = pctToString(h.igstPct);
    if (h.prCodeText !== undefined) updates['prCodeText'] = h.prCodeText ?? null;
    if (h.approvalRemarks !== undefined) updates['approvalRemarks'] = h.approvalRemarks ?? null;
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;

    await tx.update(purchaseOrders).set(updates).where(eq(purchaseOrders.id, id));

    if (input.lines !== undefined) {
      await mergeLines(tx, id, companyId, input.lines, user);
    }

    const updatedHdrRows = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .limit(1);
    const lineRows = await tx
      .select()
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.purchaseOrderId, id), isNull(purchaseOrderLines.deletedAt)))
      .orderBy(asc(purchaseOrderLines.lineNo));

    const updatedHdr = updatedHdrRows[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'PurchaseOrder',
        detail: poDetail(updatedHdr.code, updatedHdr.vendorCodeText),
        refId: updatedHdr.code,
      },
      companyId,
      user,
    );

    return {
      ...toPurchaseOrder(updatedHdr),
      vendorName: null,
      lines: lineRows.map((row) => toPurchaseOrderLine(row)),
    };
  });
}

async function mergeLines(
  tx: DbTransaction,
  purchaseOrderId: string,
  companyId: string,
  inputLines: PurchaseOrderLineInput[],
  user: AuthContext,
): Promise<void> {
  const existing = await tx
    .select({ id: purchaseOrderLines.id, lineNo: purchaseOrderLines.lineNo })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
        isNull(purchaseOrderLines.deletedAt),
      ),
    );
  const existingById = new Map(existing.map((e) => [e.id, e]));

  const directIds = inputLines.flatMap((l) => (l.itemId ? [l.itemId] : []));
  await assertItemIdsExist(tx, directIds, companyId);
  const codesToResolve = inputLines
    .filter((l) => !l.itemId && l.itemCodeText)
    .map((l) => l.itemCodeText!.trim());
  const resolved = await resolveItemCodes(tx, codesToResolve, companyId);

  const seenInputIds = new Set<string>();
  const toInsert: PurchaseOrderLineInput[] = [];
  const toUpdate: Array<{ id: string; data: PurchaseOrderLineInput }> = [];

  for (const l of inputLines) {
    if (l.id && existingById.has(l.id)) {
      seenInputIds.add(l.id);
      toUpdate.push({ id: l.id, data: l });
    } else {
      toInsert.push(l);
    }
  }

  const absentIds = existing.map((e) => e.id).filter((eid) => !seenInputIds.has(eid));
  if (absentIds.length > 0) {
    await tx
      .update(purchaseOrderLines)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(inArray(purchaseOrderLines.id, absentIds));
  }

  for (const u of toUpdate) {
    const refs = resolveLineItemRefs(u.data, resolved);
    const lineUpdate: Record<string, unknown> = { updatedBy: user.id };
    if (u.data.lineNo !== undefined) lineUpdate['lineNo'] = u.data.lineNo;
    if (u.data.itemId !== undefined || u.data.itemCodeText !== undefined) {
      lineUpdate['itemId'] = refs.itemId;
      lineUpdate['itemCodeText'] = refs.itemCodeText;
    }
    if (u.data.itemName !== undefined) lineUpdate['itemName'] = u.data.itemName;
    if (u.data.qty !== undefined) lineUpdate['qty'] = u.data.qty;
    if (u.data.rate !== undefined) lineUpdate['rate'] = rateToString(u.data);
    // received_qty is mutated by the GRN cascade only (T-036c). The form
    // never re-writes it; ignore even if the caller sends one.
    if (u.data.dueDate !== undefined) lineUpdate['dueDate'] = u.data.dueDate ?? null;
    if (u.data.sourceSoLineId !== undefined)
      lineUpdate['sourceSoLineId'] = u.data.sourceSoLineId ?? null;
    if (u.data.sourceJcOpId !== undefined) lineUpdate['sourceJcOpId'] = u.data.sourceJcOpId ?? null;
    if (u.data.lineRemarks !== undefined) lineUpdate['lineRemarks'] = u.data.lineRemarks ?? null;

    await tx.update(purchaseOrderLines).set(lineUpdate).where(eq(purchaseOrderLines.id, u.id));
  }

  if (toInsert.length > 0) {
    const survivingMax = existing
      .filter((e) => !absentIds.includes(e.id))
      .reduce((m, e) => Math.max(m, e.lineNo), 0);
    const startFrom = survivingMax + 1;
    const newLineNos = assignLineNos(toInsert, startFrom);
    const values = toInsert.map((l, i) => {
      const refs = resolveLineItemRefs(l, resolved);
      return {
        companyId,
        purchaseOrderId,
        lineNo: newLineNos[i]!,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        itemName: l.itemName,
        qty: l.qty,
        rate: rateToString(l),
        receivedQty: l.receivedQty ?? 0,
        dueDate: l.dueDate ?? null,
        sourceSoLineId: l.sourceSoLineId ?? null,
        sourceJcOpId: l.sourceJcOpId ?? null,
        lineRemarks: l.lineRemarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      };
    });
    await tx.insert(purchaseOrderLines).values(values);
  }
}

export async function softDeletePurchaseOrder(
  id: string,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        vendorCodeText: purchaseOrders.vendorCodeText,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`Purchase order ${id} not found`);
    }
    // T-036c will add a guard: block delete when GRN lines reference this PO's
    // lines. For T-036b we'll let the soft-delete go through; once GRN module
    // exists the guard becomes meaningful.
    const now = new Date();
    await tx
      .update(purchaseOrderLines)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(and(eq(purchaseOrderLines.purchaseOrderId, id), isNull(purchaseOrderLines.deletedAt)));
    await tx
      .update(purchaseOrders)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(eq(purchaseOrders.id, id));
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'PurchaseOrder',
        detail: poDetail(row.code, row.vendorCodeText),
        refId: row.code,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}

// ─── Create-from-PR ───────────────────────────────────────────────────────

/** Convert a PR into a single-line PO in one transaction. PR must be open or
 *  approved (not po_created or cancelled). Side-effects on the PR row:
 *  poId / poCreatedAt / status='po_created'. */
export async function createPurchaseOrderFromPr(
  input: CreatePurchaseOrderFromPrInput,
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const prRows = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, input.prId),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const pr = prRows[0];
    if (!pr) throw new NotFoundError(`Purchase request ${input.prId} not found`);
    if (pr.status === 'po_created' || pr.poId !== null) {
      throw new ConflictError(`PR ${pr.code} is already linked to a PO`);
    }
    if (pr.status === 'cancelled') {
      throw new ConflictError(`PR ${pr.code} is cancelled — cannot generate PO`);
    }

    // Code uniqueness on the new PO
    const dup = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.code, input.header.code),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Purchase order code "${input.header.code}" already exists`);
    }

    // Insert PO header (vendor + audit-snapshot of PR code).
    const insertedPos = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        code: input.header.code,
        poDate: input.header.poDate,
        poType: input.header.poType ?? 'job_work',
        vendorId: pr.vendorId,
        vendorCodeText: pr.vendorCodeText,
        status: 'open', // PRs only convert to open POs (skip draft state)
        dueDate: input.header.dueDate ?? pr.requiredDate ?? null,
        taxType: input.header.taxType ?? null,
        sgstPct: pctToString(input.header.sgstPct ?? 0),
        cgstPct: pctToString(input.header.cgstPct ?? 0),
        igstPct: pctToString(input.header.igstPct ?? 0),
        prCodeText: pr.code,
        remarks:
          input.header.remarks ??
          (pr.operation ? `From PR ${pr.code} — ${pr.operation}` : `From PR ${pr.code}`),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = insertedPos[0]!;

    // Insert single PO line from PR fields.
    const itemNameForLine = pr.itemName ?? pr.itemCodeText ?? 'Item';
    const insertedLines = await tx
      .insert(purchaseOrderLines)
      .values({
        companyId,
        purchaseOrderId: header.id,
        lineNo: 1,
        itemId: pr.itemId,
        itemCodeText: pr.itemCodeText,
        itemName: itemNameForLine,
        qty: pr.qty,
        rate: pr.estCost,
        receivedQty: 0,
        dueDate: pr.requiredDate ?? null,
        sourceSoLineId: pr.sourceSoLineId,
        sourceJcOpId: pr.sourceJcOpId,
        lineRemarks: null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();

    // Side-effect: stamp PR with the new PO link + status flip.
    await tx
      .update(purchaseRequests)
      .set({
        poId: header.id,
        poCreatedAt: new Date(),
        status: 'po_created',
        updatedBy: user.id,
      })
      .where(eq(purchaseRequests.id, pr.id));

    // Audit: emit two rows in the same tx — one for the new PO (CREATE),
    // one for the PR (PR_CONVERT, status flip from this side). Keeps both
    // entities' audit trails complete from their own refId perspective.
    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'PurchaseOrder',
        detail: poDetail(header.code, header.vendorCodeText),
        refId: header.code,
      },
      companyId,
      user,
    );
    await emitActivityLog(
      tx,
      {
        action: 'PR_CONVERT',
        entity: 'PurchaseRequest',
        detail: `${pr.code} → ${header.code}`,
        refId: pr.code,
      },
      companyId,
      user,
    );

    return {
      ...toPurchaseOrder(header),
      vendorName: null,
      lines: insertedLines.map((row) => toPurchaseOrderLine(row)),
    };
  });
}

// ─── Approval flow (ADR-036 follow-up, 2026-05-31) ─────────────────
//
// Mirror of legacy _approvePO L21716 + _rejectPO L21758. Eligibility:
// (a) caller must be admin OR in approval_config.po_approvers; (b) PO
// must currently be in 'draft' status. Amount-limit gate (legacy uses
// po_manager_limit) is not yet wired — would need to sum lines + tax
// per ADR-036's deferred audit item. Activity log + state change.

async function loadApprovalContext(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  userRole: string,
): Promise<{ isApprover: boolean; isAdmin: boolean }> {
  const isAdmin = userRole === 'admin';
  if (isAdmin) return { isApprover: true, isAdmin: true };
  const rows = await tx
    .select({ poApprovers: approvalConfig.poApprovers })
    .from(approvalConfig)
    .where(and(eq(approvalConfig.companyId, companyId), isNull(approvalConfig.deletedAt)))
    .limit(1);
  const approvers = Array.isArray(rows[0]?.poApprovers) ? (rows[0]!.poApprovers as string[]) : [];
  return { isApprover: approvers.includes(userId), isAdmin: false };
}

async function getPurchaseOrderInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<PurchaseOrderDetail> {
  const rows = await tx
    .select({ header: purchaseOrders, vendorName: vendors.name })
    .from(purchaseOrders)
    .leftJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(
      and(
        eq(purchaseOrders.id, id),
        eq(purchaseOrders.companyId, companyId),
        isNull(purchaseOrders.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`Purchase order ${id} not found`);

  const lineRows = await tx
    .select()
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.purchaseOrderId, id),
        eq(purchaseOrderLines.companyId, companyId),
      ),
    )
    .orderBy(asc(purchaseOrderLines.lineNo));

  return {
    ...toPurchaseOrder(row.header),
    vendorName: row.vendorName,
    lines: lineRows.map((r) => toPurchaseOrderLine(r)),
  };
}

export async function approvePurchaseOrder(
  id: string,
  remarks: string | null,
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const { isApprover } = await loadApprovalContext(tx, companyId, user.id, user.role);
    if (!isApprover) {
      throw new AuthorizationError(
        'You are not authorized to approve POs. Ask an admin to add you to the approvers list.',
      );
    }

    const existing = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const po = existing[0];
    if (!po) throw new NotFoundError(`Purchase order ${id} not found`);
    if (po.status !== 'draft') {
      throw new ValidationError(`PO ${po.code} is ${po.status}; only draft POs can be approved`);
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: 'open',
        approvedBy: user.id,
        approvedAt: new Date(),
        approvalRemarks: remarks ?? null,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'APPROVE',
        entity: 'Purchase Order',
        detail: po.code + ' approved by ' + (user.email ?? user.id) + (remarks ? ' — ' + remarks : ''),
        refId: po.code,
      },
      companyId,
      user,
    );

    return getPurchaseOrderInternal(tx, id, companyId);
  });
}

export async function rejectPurchaseOrder(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  if (!reason || !reason.trim()) {
    throw new ValidationError('Rejection reason is required');
  }

  return withUserContext(user, async (tx) => {
    const { isApprover } = await loadApprovalContext(tx, companyId, user.id, user.role);
    if (!isApprover) {
      throw new AuthorizationError('You are not authorized to reject POs.');
    }

    const existing = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const po = existing[0];
    if (!po) throw new NotFoundError(`Purchase order ${id} not found`);
    if (po.status !== 'draft') {
      throw new ValidationError(`PO ${po.code} is ${po.status}; only draft POs can be rejected`);
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: 'cancelled',
        rejectedBy: user.id,
        rejectedAt: new Date(),
        rejectionReason: reason.trim(),
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'REJECT',
        entity: 'Purchase Order',
        detail: po.code + ' rejected: ' + reason.trim(),
        refId: po.code,
      },
      companyId,
      user,
    );

    return getPurchaseOrderInternal(tx, id, companyId);
  });
}

// ─── Outsource Jobs batch convert (legacy _ospCreatePO L27131) ─────
//
// Clubs N OSP PRs into a single JW PO header with one line per PR.
// All PRs must be open/approved + belong to same company. Vendor +
// per-line rate overrides come from the form. PR rows are stamped
// po_created with the new PO id. Activity log: one PO CREATE + one
// PR_CONVERT per PR.

export async function createPurchaseOrderFromPrBatch(
  input: {
    prIds: string[];
    vendorId: string;
    header: {
      code: string;
      poDate: string;
      poType?: 'standard' | 'job_work' | 'outsource' | 'service' | undefined;
      dueDate?: string | undefined;
      taxType?: string | undefined;
      sgstPct?: number | undefined;
      cgstPct?: number | undefined;
      igstPct?: number | undefined;
      remarks?: string | undefined;
    };
    rateOverrides?: Record<string, number> | undefined;
  },
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Load vendor (exists + in caller's company).
    await assertVendorExists(tx, input.vendorId, companyId);
    const vendorRow = (
      await tx
        .select({ code: vendors.code, name: vendors.name })
        .from(vendors)
        .where(eq(vendors.id, input.vendorId))
        .limit(1)
    )[0];
    const vendorCodeText = vendorRow?.code ?? null;

    // Code uniqueness on the new PO.
    const dup = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.code, input.header.code),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Purchase order code "${input.header.code}" already exists`);
    }

    // Load all PRs.
    const prRows = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          inArray(purchaseRequests.id, input.prIds),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      );
    if (prRows.length !== input.prIds.length) {
      throw new NotFoundError('Some PR IDs not found in this company');
    }
    for (const pr of prRows) {
      if (pr.status === 'po_created' || pr.poId !== null) {
        throw new ConflictError(`PR ${pr.code} already linked to a PO`);
      }
      if (pr.status === 'cancelled') {
        throw new ConflictError(`PR ${pr.code} is cancelled — cannot convert`);
      }
    }

    // Sort PRs by created_at so line_no ordering is stable.
    const sortedPrs = [...prRows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    const insertedPos = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        code: input.header.code,
        poDate: input.header.poDate,
        poType: input.header.poType ?? 'job_work',
        vendorId: input.vendorId,
        vendorCodeText,
        status: 'open',
        dueDate: input.header.dueDate ?? null,
        taxType: input.header.taxType ?? null,
        sgstPct: String(input.header.sgstPct ?? 0),
        cgstPct: String(input.header.cgstPct ?? 0),
        igstPct: String(input.header.igstPct ?? 0),
        prCodeText: sortedPrs.map((p) => p.code).join(', ').slice(0, 200),
        remarks: input.header.remarks ?? `Batch from ${sortedPrs.length} OSP PR(s)`,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = insertedPos[0]!;

    // Insert one line per PR. Apply rate override if provided.
    const lineRows = sortedPrs.map((pr, i) => ({
      companyId,
      purchaseOrderId: header.id,
      lineNo: i + 1,
      itemId: pr.itemId,
      itemCodeText: pr.itemCodeText,
      itemName: pr.itemName ?? pr.itemCodeText ?? 'Item',
      qty: pr.qty,
      rate: String(input.rateOverrides?.[pr.id] ?? Number(pr.estCost)),
      receivedQty: 0,
      dueDate: pr.requiredDate ?? null,
      sourceSoLineId: pr.sourceSoLineId,
      sourceJcOpId: pr.sourceJcOpId,
      lineRemarks: pr.operation ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    }));
    const insertedLines = await tx.insert(purchaseOrderLines).values(lineRows).returning();

    // Stamp every PR.
    for (const pr of sortedPrs) {
      await tx
        .update(purchaseRequests)
        .set({
          poId: header.id,
          poCreatedAt: new Date(),
          status: 'po_created',
          vendorId: input.vendorId,
          vendorCodeText,
          updatedBy: user.id,
        })
        .where(eq(purchaseRequests.id, pr.id));
    }

    // Audit: one PO CREATE + one PR_CONVERT per PR.
    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'PurchaseOrder',
        detail: `${header.code} (JWPO-OSP) — ${sortedPrs.length} lines to ${vendorRow?.name ?? input.vendorId}`,
        refId: header.code,
      },
      companyId,
      user,
    );
    for (const pr of sortedPrs) {
      await emitActivityLog(
        tx,
        {
          action: 'PR_CONVERT',
          entity: 'PurchaseRequest',
          detail: `${pr.code} → ${header.code}`,
          refId: pr.code,
        },
        companyId,
        user,
      );
    }

    return {
      ...toPurchaseOrder(header),
      vendorName: vendorRow?.name ?? null,
      lines: insertedLines.map((row) => toPurchaseOrderLine(row)),
    };
  });
}
