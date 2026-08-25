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

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  approvalConfig,
  deliveryChallans,
  goodsReceiptNotes,
  items,
  jcOps,
  jobCards,
  jwDcOutward,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
  users,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { assertNotSelfApproval, canSeeFormPrice, requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import type { DocumentTraceability } from '@innovic/shared';
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

/** Header money roll-up — mirror of the PO form's `_poUpdateTotal()` preview
 *  (purchase-order-form.tsx L118-135) and the invoices header. Returns 2dp
 *  numeric strings ready for the DB:
 *    subtotal   = Σ(qty × rate)
 *    taxAmount  = subtotal × (sgstPct + cgstPct + igstPct) / 100
 *    totalAmount = subtotal + taxAmount
 *  Internal roll-up only — NOT the legal CGST/SGST/IGST split (out of scope).
 *  Rounds subtotal and taxAmount to 2dp first, matching migration 0078's
 *  backfill so create/update and the backfill agree to the paisa. */
function computePoTotals(
  lines: Array<{ qty: number; rate: string | number }>,
  sgstPct: number,
  cgstPct: number,
  igstPct: number,
): { subtotal: string; taxAmount: string; totalAmount: string } {
  const rawSubtotal = lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0);
  const subtotal = Number(rawSubtotal.toFixed(2));
  const taxAmount = Number(((subtotal * (sgstPct + cgstPct + igstPct)) / 100).toFixed(2));
  const totalAmount = subtotal + taxAmount;
  return {
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
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

// Money-hiding for L1 Viewers (ADR: "Can See Price"). When the caller may not
// see prices on Purchase Orders, the rupee amounts are nulled before they
// leave the server — lists, detail, prints and exports all build from these,
// so nulling here hides money everywhere at once. GST percentages are kept:
// they are not the confidential figures and revealing them alone is harmless.
function hidePoHeaderMoney<
  T extends {
    subtotal: number | null;
    taxAmount: number | null;
    totalAmount: number | null;
    sgstPct: string | null;
    cgstPct: string | null;
    igstPct: string | null;
  },
>(h: T): T {
  return {
    ...h,
    // Also STATE it: the reader must not have to infer 'hidden' from the nulls.
    priceVisible: false,
    subtotal: null,
    taxAmount: null,
    totalAmount: null,
    sgstPct: null,
    cgstPct: null,
    igstPct: null,
  };
}

function hidePoLineMoney<T extends { rate: string | null }>(l: T): T {
  return { ...l, rate: null };
}

export async function listPurchaseOrders(
  input: ListPurchaseOrdersQuery,
  user: AuthContext,
): Promise<ListPurchaseOrdersResponse> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'po_create');
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
        po.subtotal::text AS "subtotal",
        po.tax_amount::text AS "taxAmount",
        po.total_amount::text AS "totalAmount",
        po.pr_code_text AS "prCodeText",
        po.approved_by AS "approvedBy", po.approved_at AS "approvedAt",
        po.approval_remarks AS "approvalRemarks",
        po.rejected_by AS "rejectedBy", po.rejected_at AS "rejectedAt",
        po.rejection_reason AS "rejectionReason", po.remarks,
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
      ORDER BY po.po_date DESC, po.code DESC
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

    const mapped = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    const rowsList = showMoney ? mapped : mapped.map(hidePoHeaderMoney);
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
    subtotal: Number(r['subtotal'] ?? 0),
    taxAmount: Number(r['taxAmount'] ?? 0),
    totalAmount: Number(r['totalAmount'] ?? 0),
    prCodeText: (r['prCodeText'] as string | null) ?? null,
    approvedBy: (r['approvedBy'] as string | null) ?? null,
    approvedAt: maybeTsLike(r['approvedAt']),
    approvalRemarks: (r['approvalRemarks'] as string | null) ?? null,
    rejectedBy: (r['rejectedBy'] as string | null) ?? null,
    rejectedAt: maybeTsLike(r['rejectedAt']),
    rejectionReason: (r['rejectionReason'] as string | null) ?? null,
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
  const showMoney = await canSeeFormPrice(user, 'po_create');
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

    const header = toPurchaseOrder(headerRow.row);
    const lines = lineRows.map((r) => toPurchaseOrderLine(r.row, r.itemCode));
    return {
      ...(showMoney ? header : hidePoHeaderMoney(header)),
      vendorName: headerRow.vendorName,
      lines: showMoney ? lines : lines.map(hidePoLineMoney),
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
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.taxAmount),
    totalAmount: Number(row.totalAmount),
    prCodeText: row.prCodeText,
    approvedBy: row.approvedBy,
    approvedAt: maybeTsLike(row.approvedAt),
    approvalRemarks: row.approvalRemarks,
    rejectedBy: row.rejectedBy,
    rejectedAt: maybeTsLike(row.rejectedAt),
    rejectionReason: row.rejectionReason,
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

/** Next IN-PO-##### code in the company series (mirrors nextSoCode). Used when
 *  the create payload omits a code (document-number override: blank = auto). */
async function nextPoCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: purchaseOrders.code })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = (r.code || '').match(/IN-PO-(\d+)\s*$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `IN-PO-${String(max + 1).padStart(5, '0')}`;
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
  user: AuthContext,
): Promise<PurchaseOrderDetail> {
  // Raising a PO is the `entry` action — L2 Data Entry and up.
  await requireFormAccess(user, 'po_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const code = input.header.code?.trim() || (await nextPoCode(tx, companyId));
    const dup = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.code, code),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(
        `Purchase Order No. "${code}" already exists — duplicate not allowed. Please use a unique number.`,
      );
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
    const totals = computePoTotals(
      input.lines,
      input.header.sgstPct ?? 0,
      input.header.cgstPct ?? 0,
      input.header.igstPct ?? 0,
    );
    const inserted = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        code,
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
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
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
  // Changing a saved PO is the `edit` action — L3 Editor and up. An L2 clerk
  // may raise one but not alter it afterwards.
  await requireFormAccess(user, 'po_create', 'edit');
  const companyId = requireCompany(user);
  // Money in, same rule as money out. `priceOff` makes "can do the job but must
  // not see the number" a supported setup, so an editor with prices hidden is a
  // real user — and their form posts back money fields it never showed them.
  // The rate/percent fields carry zod defaults, so a blinded payload does not
  // merely omit them: it arrives holding a default that would overwrite the
  // stored figures. Ignore them here — what is stored stands.
  const showMoney = await canSeeFormPrice(user, 'po_create');

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

    // ── Status lock (0100) ──────────────────────────────────────────
    // Once a PO leaves draft it has been approved (or rejected/cancelled),
    // and the figures on it are what somebody signed for. Editing the lines
    // afterwards defeated the whole approval ceiling: approve a small PO,
    // then raise the rates. Structural check #5 of the Generic Role Audit
    // Checklist.
    //
    // Not a freeze of the whole record — the paperwork fields (due date,
    // remarks, PR reference) stay open, because chasing a delivery date is
    // not a change to what was approved. To change the money, reject the PO
    // back to draft and raise it again.
    if (existingHdr.status !== 'draft') {
      const h0 = input.header;
      const lockedChanges: string[] = [];
      if (input.lines !== undefined) lockedChanges.push('lines / rates');
      if (h0.vendorId !== undefined && (h0.vendorId ?? null) !== existingHdr.vendorId) {
        lockedChanges.push('vendor');
      }
      if (h0.poType !== undefined && h0.poType !== existingHdr.poType)
        lockedChanges.push('PO type');
      if (h0.poDate !== undefined && h0.poDate !== existingHdr.poDate)
        lockedChanges.push('PO date');
      if (h0.taxType !== undefined && (h0.taxType ?? null) !== existingHdr.taxType) {
        lockedChanges.push('tax type');
      }
      for (const [label, next, current] of [
        ['SGST %', h0.sgstPct, existingHdr.sgstPct],
        ['CGST %', h0.cgstPct, existingHdr.cgstPct],
        ['IGST %', h0.igstPct, existingHdr.igstPct],
      ] as const) {
        if (next !== undefined && Number(next) !== Number(current)) lockedChanges.push(label);
      }
      if (lockedChanges.length > 0) {
        throw new ValidationError(
          `PO ${existingHdr.code} is ${existingHdr.status}, so ${lockedChanges.join(', ')} ` +
            `can no longer be changed. Reject it back to draft first, or raise a new PO. ` +
            `Due date, remarks and the PR reference can still be edited.`,
        );
      }
    }

    if (input.header.vendorId !== undefined && input.header.vendorId !== null) {
      await assertVendorExists(tx, input.header.vendorId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    const h = input.header;
    if (h.poDate !== undefined) updates['poDate'] = h.poDate;
    if (h.poType !== undefined) updates['poType'] = h.poType;
    if (h.vendorId !== undefined) updates['vendorId'] = h.vendorId ?? null;
    if (h.vendorCodeText !== undefined) updates['vendorCodeText'] = h.vendorCodeText ?? null;
    // Status is IMMUTABLE on a raw edit: preserve the existing PO status
    // regardless of what the payload sends (mirror of updateJobCard's source
    // immutability). PO status moves ONLY through the dedicated state-machine
    // actions — approvePurchaseOrder / rejectPurchaseOrder / cancel — never a
    // plain update, which would otherwise let an edit flip draft→open (skipping
    // the approver + amount ceiling) or →cancelled (skipping the rejection
    // reason + rejectedBy/rejectedAt stamps). Silently ignore input.status.
    updates['status'] = existingHdr.status;
    if (h.dueDate !== undefined) updates['dueDate'] = h.dueDate ?? null;
    if (h.taxType !== undefined) updates['taxType'] = h.taxType ?? null;
    if (h.sgstPct !== undefined && showMoney) updates['sgstPct'] = pctToString(h.sgstPct);
    if (h.cgstPct !== undefined && showMoney) updates['cgstPct'] = pctToString(h.cgstPct);
    if (h.igstPct !== undefined && showMoney) updates['igstPct'] = pctToString(h.igstPct);
    if (h.prCodeText !== undefined) updates['prCodeText'] = h.prCodeText ?? null;
    if (h.approvalRemarks !== undefined) updates['approvalRemarks'] = h.approvalRemarks ?? null;
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;

    await tx.update(purchaseOrders).set(updates).where(eq(purchaseOrders.id, id));

    if (input.lines !== undefined) {
      await mergeLines(tx, id, companyId, input.lines, user, showMoney);
    }

    let updatedHdr = (
      await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
    )[0]!;
    const lineRows = await tx
      .select()
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.purchaseOrderId, id), isNull(purchaseOrderLines.deletedAt)))
      .orderBy(asc(purchaseOrderLines.lineNo));

    // Recompute stored totals from the FINAL state (post header-pct update +
    // line merge), regardless of whether pcts or lines changed. Persist and
    // reflect the same figures on the returned header.
    const totals = computePoTotals(
      lineRows,
      Number(updatedHdr.sgstPct),
      Number(updatedHdr.cgstPct),
      Number(updatedHdr.igstPct),
    );
    await tx
      .update(purchaseOrders)
      .set({
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
      })
      .where(eq(purchaseOrders.id, id));
    updatedHdr = {
      ...updatedHdr,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
    };
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
  /** False when the caller may not see money on this form — their payload's
   *  `rate` is then ignored on an EXISTING line so the stored figure survives.
   *  A NEW line still takes the input (there is no stored value to protect). */
  showMoney: boolean,
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
    if (u.data.rate !== undefined && showMoney) lineUpdate['rate'] = rateToString(u.data);
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
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: L3 has edit without
  // approve, L4 has approve without edit. Previously this was `requireWriteRole`
  // alone, which let any manager delete a PO through the API while the UI only
  // ever offered Delete to admins.
  await requireFormAccess(user, 'po_create', 'edit');
  await requireFormAccess(user, 'po_create', 'approve');
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
  // Converting a PR raises a NEW PO — the `entry` action, same as create.
  await requireFormAccess(user, 'po_create', 'entry');
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

    // Vendor override: validated the same way the main create path validates
    // its header vendor, and its code snapshotted for the PO's own text column.
    const overrideVendorId = input.header.vendorId ?? null;
    let overrideVendorCode: string | null = null;
    if (overrideVendorId) {
      await assertVendorExists(tx, overrideVendorId, companyId);
      const vRows = await tx
        .select({ code: vendors.code })
        .from(vendors)
        .where(eq(vendors.id, overrideVendorId))
        .limit(1);
      overrideVendorCode = vRows[0]?.code ?? null;
    }

    // Blank code ⇒ auto-generate the next PO code (same as the main create path).
    const code = input.header.code?.trim() || (await nextPoCode(tx, companyId));

    // Code uniqueness on the new PO
    const dup = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.code, code),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Purchase order code "${code}" already exists`);
    }

    // Stored totals from the single PR-derived line (qty × est cost) + header tax.
    const fromPrTotals = computePoTotals(
      [{ qty: pr.qty, rate: pr.estCost }],
      Number(input.header.sgstPct ?? 0),
      Number(input.header.cgstPct ?? 0),
      Number(input.header.igstPct ?? 0),
    );
    // Insert PO header (vendor + audit-snapshot of PR code).
    const insertedPos = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        code,
        poDate: input.header.poDate,
        // Derive the PO type from the SOURCE PR, not the form: an OSP/job-work PR
        // (jw_osp, or linked to a JC op) → job_work; a service PR → service; a
        // plain buy (e.g. a direct_purchase plan's standard PR with no JC op) →
        // standard. Prevents a buy being mistyped job_work — which wrongly exposed
        // the outward-DC flow and hid the Receive/GRN action (IN-PO-00004 /
        // PLN-0006 case). 'service' was previously unreachable: it fell out of the
        // two-way test as 'standard', so a service PR became a buying PO.
        poType:
          pr.prType === 'jw_osp' || pr.sourceJcOpId
            ? 'job_work'
            : pr.prType === 'service'
              ? 'service'
              : 'standard',
        // The PR's vendor is the default, not a fixed rule: an OSP-generated PR
        // carries the `(vendor TBD)` sentinel in vendorCodeText with no
        // vendor_id, so without an override the PO inherited a placeholder
        // vendor that could not be corrected on the way through. When the caller
        // picks one, its code is snapshotted and the free text dropped, matching
        // resolveItemRefs' "a real link beats carried text" rule.
        vendorId: overrideVendorId ?? pr.vendorId,
        vendorCodeText: overrideVendorId ? overrideVendorCode : pr.vendorCodeText,
        status: 'open', // PRs only convert to open POs (skip draft state)
        dueDate: input.header.dueDate ?? pr.requiredDate ?? null,
        taxType: input.header.taxType ?? null,
        sgstPct: pctToString(input.header.sgstPct ?? 0),
        cgstPct: pctToString(input.header.cgstPct ?? 0),
        igstPct: pctToString(input.header.igstPct ?? 0),
        subtotal: fromPrTotals.subtotal,
        taxAmount: fromPrTotals.taxAmount,
        totalAmount: fromPrTotals.totalAmount,
        prId: pr.id,
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
    // A PR raised before the item-link fix (or by any caller that sent only the
    // typed code) carries item_code_text with a null item_id. Re-resolve here so
    // the PO line is linked even when its source PR is not — item_id is what the
    // GRN stock credit keys on.
    const prItemId =
      pr.itemId ??
      (pr.itemCodeText
        ? ((await resolveItemCodes(tx, [pr.itemCodeText.trim()], companyId)).get(
            pr.itemCodeText.trim(),
          ) ?? null)
        : null);
    const insertedLines = await tx
      .insert(purchaseOrderLines)
      .values({
        companyId,
        purchaseOrderId: header.id,
        lineNo: 1,
        itemId: prItemId,
        itemCodeText: prItemId ? null : pr.itemCodeText,
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

    // Advance the linked outsource jc_op so the DC→receive cascade can complete
    // it. Without this, an OSP PR converted here leaves the op stuck at
    // 'pr_raised' with a null outsource_po_line_id (mirrors osp-cascade's
    // auto-PO path, which already does this).
    if (pr.sourceJcOpId) {
      await tx
        .update(jcOps)
        .set({
          outsourcePoLineId: insertedLines[0]!.id,
          outsourceStatus: 'po_created',
          updatedBy: user.id,
        })
        .where(eq(jcOps.id, pr.sourceJcOpId));
    }

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

// ─── Approval flow (ADR-036/ADR-037 follow-up; limit gate ADR-038) ──
//
// Mirror of legacy _approvePO L21716 + _rejectPO L21758. Eligibility:
// (a) caller must be admin OR in approval_config.po_approvers; (b) PO
// must currently be in 'draft' status; (c) for a non-admin approver the
// PO value must not exceed their approval ceiling (ADR-038).
//
// PO value = Σ(qty × rate) over the PO's active lines — no tax, matching
// legacy `tVal` (L21727). Effective ceiling for a non-admin approver =
// the caller's personal users.approval_limit when set (>0), else the
// company approval_config.po_manager_limit, else the legacy default of
// 100000 (_getUserApprovalLimit L21602). Admin = unlimited.

const DEFAULT_PO_APPROVAL_LIMIT = 100_000;

interface ApprovalContext {
  isApprover: boolean;
  isAdmin: boolean;
  /** Effective ceiling for a non-admin approver (₹). Infinity for admins. */
  approvalCeiling: number;
}

async function loadApprovalContext(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  userRole: string,
): Promise<ApprovalContext> {
  const isAdmin = userRole === 'admin';
  if (isAdmin) return { isApprover: true, isAdmin: true, approvalCeiling: Infinity };

  const cfgRows = await tx
    .select({
      poApprovers: approvalConfig.poApprovers,
      poManagerLimit: approvalConfig.poManagerLimit,
    })
    .from(approvalConfig)
    .where(and(eq(approvalConfig.companyId, companyId), isNull(approvalConfig.deletedAt)))
    .limit(1);
  const approvers = Array.isArray(cfgRows[0]?.poApprovers)
    ? (cfgRows[0]!.poApprovers as string[])
    : [];

  const userRows = await tx
    .select({ approvalLimit: users.approvalLimit })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)))
    .limit(1);

  const personalLimit = Number(userRows[0]?.approvalLimit ?? 0);
  const companyLimit = Number(cfgRows[0]?.poManagerLimit ?? 0);
  const approvalCeiling =
    personalLimit > 0 ? personalLimit : companyLimit > 0 ? companyLimit : DEFAULT_PO_APPROVAL_LIMIT;

  return { isApprover: approvers.includes(userId), isAdmin: false, approvalCeiling };
}

/** Σ(qty × rate) over a PO's active lines — no tax (legacy `tVal` L21727). */
async function sumPoLineValue(tx: DbTransaction, purchaseOrderId: string): Promise<number> {
  const lines = await tx
    .select({ qty: purchaseOrderLines.qty, rate: purchaseOrderLines.rate })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
        isNull(purchaseOrderLines.deletedAt),
      ),
    );
  return lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.rate), 0);
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
      and(eq(purchaseOrderLines.purchaseOrderId, id), eq(purchaseOrderLines.companyId, companyId)),
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
  // The Access Control matrix must also grant Approve on Purchase Orders —
  // an L3 Editor can raise a PO but cannot sign it off (0100).
  await requireFormAccess(user, 'po_create', 'approve');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const { isApprover, isAdmin, approvalCeiling } = await loadApprovalContext(
      tx,
      companyId,
      user.id,
      user.role,
    );
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

    // Segregation of duty (0100): the raiser cannot sign off their own PO.
    assertNotSelfApproval(user, po.createdBy, `PO ${po.code}`);

    // Amount-limit gate (legacy _approvePO L21731). Admins bypass.
    if (!isAdmin) {
      const poValue = await sumPoLineValue(tx, id);
      if (poValue > approvalCeiling) {
        const fmt = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
        throw new AuthorizationError(
          `PO value ${fmt(poValue)} exceeds your approval limit of ${fmt(approvalCeiling)}. Admin approval required.`,
        );
      }
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
        detail:
          po.code + ' approved by ' + (user.email ?? user.id) + (remarks ? ' — ' + remarks : ''),
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
  // Rejecting is the other half of approving — same permission (0100).
  await requireFormAccess(user, 'po_create', 'approve');
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

    // Segregation of duty (0100) — the other half of approve. Rejecting is a
    // sign-off too: the raiser cannot kill their own PO to bury it, and an
    // auditor reading the trail must see two different names on the document.
    assertNotSelfApproval(user, po.createdBy, `PO ${po.code}`);

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
  // Batch conversion raises one NEW PO — the `entry` action, same as create.
  await requireFormAccess(user, 'po_create', 'entry');
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
    const sortedPrs = [...prRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const insertedPos = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        code: input.header.code,
        poDate: input.header.poDate,
        // Same rule as the single convert: job_work only when EVERY PR in the
        // batch is OSP/job-work (jw_osp or JC-op linked), service only when EVERY
        // PR is a service PR; a mixed batch falls back to standard.
        poType: sortedPrs.every((p) => p.prType === 'jw_osp' || p.sourceJcOpId)
          ? 'job_work'
          : sortedPrs.every((p) => p.prType === 'service')
            ? 'service'
            : 'standard',
        vendorId: input.vendorId,
        vendorCodeText,
        status: 'open',
        dueDate: input.header.dueDate ?? null,
        taxType: input.header.taxType ?? null,
        sgstPct: String(input.header.sgstPct ?? 0),
        cgstPct: String(input.header.cgstPct ?? 0),
        igstPct: String(input.header.igstPct ?? 0),
        // Batch may span multiple PRs joined into prCodeText; only stamp the FK
        // when there is a single source PR — otherwise leave it null.
        prId: sortedPrs.length === 1 ? sortedPrs[0]!.id : null,
        prCodeText: sortedPrs
          .map((p) => p.code)
          .join(', ')
          .slice(0, 200),
        remarks: input.header.remarks ?? `Batch from ${sortedPrs.length} OSP PR(s)`,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = insertedPos[0]!;

    // Same re-resolve as the single convert: a PR carrying only a typed code
    // gets linked to the Item Master here, so the PO line can credit stock later.
    const batchResolved = await resolveItemCodes(
      tx,
      sortedPrs.filter((p) => !p.itemId && p.itemCodeText).map((p) => p.itemCodeText!.trim()),
      companyId,
    );

    // Insert one line per PR. Apply rate override if provided.
    const lineRows = sortedPrs.map((pr, i) => {
      const prItemId =
        pr.itemId ?? (pr.itemCodeText ? (batchResolved.get(pr.itemCodeText.trim()) ?? null) : null);
      return {
        companyId,
        purchaseOrderId: header.id,
        lineNo: i + 1,
        itemId: prItemId,
        itemCodeText: prItemId ? null : pr.itemCodeText,
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
      };
    });
    const insertedLines = await tx.insert(purchaseOrderLines).values(lineRows).returning();

    // Stamp every PR + advance its linked outsource jc_op. lineRows/insertedLines
    // are built in sortedPrs order, so insertedLines[i] is pr[i]'s PO line.
    for (let i = 0; i < sortedPrs.length; i++) {
      const pr = sortedPrs[i]!;
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

      if (pr.sourceJcOpId) {
        await tx
          .update(jcOps)
          .set({
            outsourcePoLineId: insertedLines[i]!.id,
            outsourceStatus: 'po_created',
            updatedBy: user.id,
          })
          .where(eq(jcOps.id, pr.sourceJcOpId));
      }
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

/**
 * Read-only document traceability for one Purchase Order (T-060 family).
 *
 * Mirrors `getSalesOrderRelated`: a single withUserContext transaction, an
 * existence check that throws NotFoundError before gathering anything, and
 * company-scoped + soft-delete-filtered subqueries only. No writes, no schema.
 *
 * Upstream (source) relationships:
 *   - purchase_orders.vendor_id              -> vendors (the supplier)
 *   - purchase_requests.po_id = :id          -> source Purchase Requests
 *   - purchase_order_lines.source_so_line_id -> DISTINCT sales_orders (via SO lines)
 *   - purchase_order_lines.source_jc_op_id   -> DISTINCT job_cards (via jc_ops, OSP)
 *
 * Downstream (generated) relationships:
 *   - goods_receipt_notes.purchase_order_id = :id -> GRNs
 *   - delivery_challans.purchase_order_id   = :id -> Delivery Challans
 *   - jw_dc_outward.purchase_order_id       = :id -> JW DC Outward
 */
export async function getPurchaseOrderRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the PO exists / is visible before gathering related docs; grab
    // vendor_id for the upstream vendor link.
    const headers = await tx
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        poDate: purchaseOrders.poDate,
        status: purchaseOrders.status,
        vendorId: purchaseOrders.vendorId,
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
    const header = headers[0];
    if (!header) throw new NotFoundError(`Purchase order ${id} not found`);

    // Upstream: vendor (source supplier).
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

    // Upstream: source purchase requests (PR.po_id points back to this PO).
    const prRows = await tx
      .select({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        status: purchaseRequests.status,
        date: purchaseRequests.prDate,
      })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.poId, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .orderBy(desc(purchaseRequests.prDate));

    // Upstream: distinct sales orders this PO's lines were sourced from.
    const soRows = await tx
      .selectDistinct({
        id: salesOrders.id,
        code: salesOrders.code,
        status: salesOrders.status,
        date: salesOrders.soDate,
      })
      .from(salesOrders)
      .innerJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.sourceSoLineId, salesOrderLines.id))
      .where(
        and(
          eq(purchaseOrderLines.purchaseOrderId, id),
          isNull(purchaseOrderLines.deletedAt),
          isNull(salesOrderLines.deletedAt),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .orderBy(desc(salesOrders.soDate));

    // Upstream: distinct job cards (OSP) via jc_ops referenced by this PO's lines.
    const jcRows = await tx
      .selectDistinct({
        id: jobCards.id,
        code: jobCards.code,
        date: jobCards.jcDate,
      })
      .from(jobCards)
      .innerJoin(jcOps, eq(jcOps.jobCardId, jobCards.id))
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.sourceJcOpId, jcOps.id))
      .where(
        and(
          eq(purchaseOrderLines.purchaseOrderId, id),
          isNull(purchaseOrderLines.deletedAt),
          isNull(jcOps.deletedAt),
          eq(jobCards.companyId, companyId),
          isNull(jobCards.deletedAt),
        ),
      )
      .orderBy(desc(jobCards.jcDate));

    // Downstream: GRNs raised against this PO. goods_receipt_notes has no
    // status column -> reference by code/date.
    const grnRows = await tx
      .select({
        id: goodsReceiptNotes.id,
        code: goodsReceiptNotes.code,
        date: goodsReceiptNotes.grnDate,
      })
      .from(goodsReceiptNotes)
      .where(
        and(
          eq(goodsReceiptNotes.purchaseOrderId, id),
          eq(goodsReceiptNotes.companyId, companyId),
          isNull(goodsReceiptNotes.deletedAt),
        ),
      )
      .orderBy(desc(goodsReceiptNotes.grnDate));

    // Downstream: delivery challans issued against this PO.
    const dcRows = await tx
      .select({
        id: deliveryChallans.id,
        code: deliveryChallans.code,
        status: deliveryChallans.status,
        date: deliveryChallans.dcDate,
      })
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.purchaseOrderId, id),
          eq(deliveryChallans.companyId, companyId),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .orderBy(desc(deliveryChallans.dcDate));

    // Downstream: JW DC Outward against this PO. jw_dc_outward has no status
    // column -> reference by code/date.
    const jwDcRows = await tx
      .select({
        id: jwDcOutward.id,
        code: jwDcOutward.code,
        date: jwDcOutward.dcDate,
      })
      .from(jwDcOutward)
      .where(
        and(
          eq(jwDcOutward.purchaseOrderId, id),
          eq(jwDcOutward.companyId, companyId),
          isNull(jwDcOutward.deletedAt),
        ),
      )
      .orderBy(desc(jwDcOutward.dcDate));

    // Upstream sections (what this PO was built FROM).
    const vendorSection = section(
      'vendor',
      'Vendor',
      '\u{1F3ED}',
      'vendor',
      vendor
        ? [
            {
              id: vendor.id,
              code: vendor.code,
              status: null,
              date: null,
              linkId: null,
              label: vendor.name,
            },
          ]
        : [],
    );
    const prSection = section(
      'purchase-request',
      'Source Purchase Request',
      '\u{1F4DD}',
      'purchase-request',
      prRows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        date: toIsoDate(r.date),
        linkId: null,
        label: null,
      })),
    );
    const soSection = section(
      'sales-order',
      'Source Sales Orders',
      '\u{1F4C4}',
      'sales-order',
      soRows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        date: toIsoDate(r.date),
        linkId: null,
        label: null,
      })),
    );
    const jcSection = section(
      'job-card',
      'Source Job Cards (OSP)',
      '\u{1F4CB}',
      'job-card',
      jcRows.map((r) => ({
        id: r.id,
        code: r.code,
        status: null,
        date: toIsoDate(r.date),
        linkId: null,
        label: null,
      })),
    );

    // Downstream sections (generated from this PO).
    const grnSection = section(
      'grn',
      'Goods Receipt Notes',
      '\u{1F4E5}',
      'grn',
      grnRows.map((r) => ({
        id: r.id,
        code: r.code,
        status: null,
        date: toIsoDate(r.date),
        linkId: null,
        label: null,
      })),
    );
    const dcSection = section(
      'delivery-challans',
      'Delivery Challans',
      '\u{1F69A}',
      'delivery-challan',
      dcRows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        date: toIsoDate(r.date),
        linkId: null,
        label: null,
      })),
    );
    const jwDcSection = section(
      'jw-dc',
      'JW DC Outward',
      '\u{1F4E6}',
      'jw-dc',
      jwDcRows.map((r) => ({
        id: r.id,
        code: r.code,
        status: null,
        date: toIsoDate(r.date),
        linkId: null,
        label: null,
      })),
    );

    const upstream = [vendorSection, prSection, soSection, jcSection];
    const downstream = [grnSection, dcSection, jwDcSection];
    return {
      self: { module: 'purchase-orders', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.poDate),
          label: 'Purchase Order created',
          code: header.code,
          routeKind: 'purchase-order',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}
