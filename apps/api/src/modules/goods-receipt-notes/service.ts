// Goods Receipt Notes service (T-036c).
//
// Header + lines per ADR-015 #1, with inline QC fields per ADR-015 #8.
// Mirrors the legacy `addGRN()` line 26515 + `_editFullGRN()` flow.
//
// Three cascades fire on every GRN write (in the same DB tx as the write):
//   1. recalcPoLineReceivedQty — for every PO line touched (current + prior)
//   2. recalcPoHeaderStatus    — for every PO header touched
//   3. writeStoreTxnOnQcAccept — for every GRN line whose QC status went to
//      'completed' on this write
//
// Locks:
//   - QC fields on a GRN line are immutable once qc_status='completed' (the
//     completed transition wrote a store_transactions row that can't be
//     reversed automatically; the workaround is to create a reversing GRN
//     line). The update path raises ConflictError if the input would change
//     QC fields on a completed line.
//   - softDelete blocked if any line on the GRN has qc_status='completed'.
//
// Update merge follows the same option-C semantics as SO/JW/PO: if `lines`
// is present in the payload, run the merge; if omitted, only the header is
// updated (existing lines untouched).

import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  items,
  purchaseOrderLines,
  purchaseOrders,
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
import { recalcPoHeaderStatus, recalcPoLineReceivedQty, writeStoreTxnOnQcAccept } from './cascades';
import type {
  CreateGoodsReceiptNoteInput,
  GoodsReceiptNote,
  GoodsReceiptNoteDetail,
  GoodsReceiptNoteLine,
  GoodsReceiptNoteLineInput,
  GoodsReceiptNoteListItem,
  ListGoodsReceiptNotesQuery,
  ListGoodsReceiptNotesResponse,
  UpdateGoodsReceiptNoteInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// ─── FK helpers ───────────────────────────────────────────────────────────

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
  if (rows.length === 0) throw new ValidationError(`Vendor ${vendorId} not found in this company`);
}

async function assertPurchaseOrderExists(
  tx: DbTransaction,
  purchaseOrderId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.id, purchaseOrderId),
        eq(purchaseOrders.companyId, companyId),
        isNull(purchaseOrders.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Purchase order ${purchaseOrderId} not found in this company`);
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

async function assertPoLineIdsExist(
  tx: DbTransaction,
  poLineIds: string[],
  companyId: string,
): Promise<void> {
  const unique = Array.from(new Set(poLineIds));
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: purchaseOrderLines.id })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.companyId, companyId),
        inArray(purchaseOrderLines.id, unique),
        isNull(purchaseOrderLines.deletedAt),
      ),
    );
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    throw new ValidationError(`PO line id(s) not found: ${missing.join(', ')}`);
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
  line: GoodsReceiptNoteLineInput,
  resolved: Map<string, string>,
): { itemId: string | null; itemCodeText: string | null } {
  if (line.itemId) return { itemId: line.itemId, itemCodeText: null };
  const code = line.itemCodeText?.trim();
  if (!code) throw new ValidationError('itemId or itemCodeText is required');
  const found = resolved.get(code);
  return found ? { itemId: found, itemCodeText: null } : { itemId: null, itemCodeText: code };
}

function assignLineNos(lines: GoodsReceiptNoteLineInput[], startFrom: number): number[] {
  const provided = lines.filter((l) => l.lineNo !== undefined);
  if (provided.length > 0 && provided.length !== lines.length) {
    throw new ValidationError('Provide lineNo on every line or none');
  }
  if (provided.length === 0) return lines.map((_, i) => startFrom + i);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const l of lines) {
    const n = l.lineNo!;
    if (seen.has(n)) throw new ValidationError(`Duplicate lineNo ${n} within input`);
    seen.add(n);
    out.push(n);
  }
  return out;
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

export async function listGoodsReceiptNotes(
  input: ListGoodsReceiptNotesQuery,
  user: AuthContext,
): Promise<ListGoodsReceiptNotesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (grn.code ILIKE ${term} OR grn.po_code_text ILIKE ${term} OR grn.dc_no ILIKE ${term} OR grn.invoice_no ILIKE ${term})`
      : sql``;
    const vendorFrag = input.vendorId ? sql`AND grn.vendor_id = ${input.vendorId}::uuid` : sql``;
    const poFrag = input.purchaseOrderId
      ? sql`AND grn.purchase_order_id = ${input.purchaseOrderId}::uuid`
      : sql``;
    const qcStatusFrag = input.qcStatus
      ? sql`AND EXISTS (
          SELECT 1 FROM public.goods_receipt_note_lines gnl
          WHERE gnl.goods_receipt_note_id = grn.id
            AND gnl.deleted_at IS NULL
            AND gnl.qc_status = ${input.qcStatus}::grn_qc_status
        )`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND grn.grn_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND grn.grn_date <= ${input.toDate}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        grn.id, grn.company_id AS "companyId", grn.code,
        grn.grn_date AS "grnDate",
        grn.purchase_order_id AS "purchaseOrderId",
        grn.po_code_text AS "poCodeText",
        grn.vendor_id AS "vendorId",
        grn.vendor_code_text AS "vendorCodeText",
        grn.dc_no AS "dcNo", grn.invoice_no AS "invoiceNo", grn.remarks,
        grn.created_at AS "createdAt", grn.created_by AS "createdBy",
        grn.updated_at AS "updatedAt", grn.updated_by AS "updatedBy",
        grn.deleted_at AS "deletedAt",
        v.name AS "vendorName",
        po.code AS "poCode",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(line_agg.total_received_qty, 0)::int AS "totalReceivedQty",
        COALESCE(line_agg.qc_pending_count, 0)::int AS "qcPendingCount"
      FROM public.goods_receipt_notes grn
      LEFT JOIN public.vendors v ON v.id = grn.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = grn.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN (
        SELECT goods_receipt_note_id,
               COUNT(*) AS line_count,
               SUM(received_qty) AS total_received_qty,
               SUM(CASE WHEN qc_status != 'completed' THEN 1 ELSE 0 END) AS qc_pending_count
        FROM public.goods_receipt_note_lines
        WHERE deleted_at IS NULL
        GROUP BY goods_receipt_note_id
      ) line_agg ON line_agg.goods_receipt_note_id = grn.id
      WHERE grn.company_id = ${companyId}::uuid
        AND grn.deleted_at IS NULL
        ${searchFrag}
        ${vendorFrag}
        ${poFrag}
        ${qcStatusFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY grn.grn_date DESC, grn.code ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [
      eq(goodsReceiptNotes.companyId, companyId),
      isNull(goodsReceiptNotes.deletedAt),
    ];
    if (input.vendorId) conditions.push(eq(goodsReceiptNotes.vendorId, input.vendorId));
    if (input.purchaseOrderId)
      conditions.push(eq(goodsReceiptNotes.purchaseOrderId, input.purchaseOrderId));
    const totalRows = await tx
      .select({ value: count() })
      .from(goodsReceiptNotes)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const rowsList = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: rowsList, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): GoodsReceiptNoteListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    grnDate: dateLike(r['grnDate']),
    purchaseOrderId: (r['purchaseOrderId'] as string | null) ?? null,
    poCodeText: (r['poCodeText'] as string | null) ?? null,
    vendorId: (r['vendorId'] as string | null) ?? null,
    vendorCodeText: (r['vendorCodeText'] as string | null) ?? null,
    dcNo: (r['dcNo'] as string | null) ?? null,
    invoiceNo: (r['invoiceNo'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    vendorName: (r['vendorName'] as string | null) ?? null,
    poCode: (r['poCode'] as string | null) ?? null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalReceivedQty: Number(r['totalReceivedQty'] ?? 0),
    qcPendingCount: Number(r['qcPendingCount'] ?? 0),
  };
}

export async function getGoodsReceiptNote(
  id: string,
  user: AuthContext,
): Promise<GoodsReceiptNoteDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(goodsReceiptNotes)
      .where(
        and(
          eq(goodsReceiptNotes.id, id),
          eq(goodsReceiptNotes.companyId, companyId),
          isNull(goodsReceiptNotes.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Goods receipt note ${id} not found`);

    const lineRows = await tx
      .select()
      .from(goodsReceiptNoteLines)
      .where(
        and(
          eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
          isNull(goodsReceiptNoteLines.deletedAt),
        ),
      )
      .orderBy(asc(goodsReceiptNoteLines.lineNo));

    return {
      ...toGoodsReceiptNote(header),
      lines: lineRows.map(toGoodsReceiptNoteLine),
    };
  });
}

function toGoodsReceiptNote(row: typeof goodsReceiptNotes.$inferSelect): GoodsReceiptNote {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    grnDate: row.grnDate,
    purchaseOrderId: row.purchaseOrderId,
    poCodeText: row.poCodeText,
    vendorId: row.vendorId,
    vendorCodeText: row.vendorCodeText,
    dcNo: row.dcNo,
    invoiceNo: row.invoiceNo,
    remarks: row.remarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

function toGoodsReceiptNoteLine(
  row: typeof goodsReceiptNoteLines.$inferSelect,
): GoodsReceiptNoteLine {
  return {
    id: row.id,
    companyId: row.companyId,
    goodsReceiptNoteId: row.goodsReceiptNoteId,
    lineNo: row.lineNo,
    purchaseOrderLineId: row.purchaseOrderLineId,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemName: row.itemName,
    receivedQty: row.receivedQty,
    dcRefNo: row.dcRefNo,
    qcStatus: row.qcStatus,
    qcAcceptedQty: row.qcAcceptedQty,
    qcRejectedQty: row.qcRejectedQty,
    qcDate: maybeDateLike(row.qcDate),
    qcRemarks: row.qcRemarks,
    qcInspectedBy: row.qcInspectedBy,
    remarks: row.remarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createGoodsReceiptNote(
  input: CreateGoodsReceiptNoteInput,
  user: AuthContext,
): Promise<GoodsReceiptNoteDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: goodsReceiptNotes.id })
      .from(goodsReceiptNotes)
      .where(
        and(
          eq(goodsReceiptNotes.companyId, companyId),
          eq(goodsReceiptNotes.code, input.header.code),
          isNull(goodsReceiptNotes.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`GRN code "${input.header.code}" already exists`);
    }

    if (input.header.vendorId) {
      await assertVendorExists(tx, input.header.vendorId, companyId);
    }
    if (input.header.purchaseOrderId) {
      await assertPurchaseOrderExists(tx, input.header.purchaseOrderId, companyId);
    }

    const directIds = input.lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
    await assertItemIdsExist(tx, directIds, companyId);
    const codesToResolve = input.lines
      .filter((l) => !l.itemId && l.itemCodeText)
      .map((l) => l.itemCodeText!.trim());
    const resolved = await resolveItemCodes(tx, codesToResolve, companyId);
    const poLineIds = input.lines
      .map((l) => l.purchaseOrderLineId)
      .filter((id): id is string => Boolean(id));
    await assertPoLineIdsExist(tx, poLineIds, companyId);

    const lineNos = assignLineNos(input.lines, 1);

    const inserted = await tx
      .insert(goodsReceiptNotes)
      .values({
        companyId,
        code: input.header.code,
        grnDate: input.header.grnDate,
        purchaseOrderId: input.header.purchaseOrderId ?? null,
        poCodeText: input.header.poCodeText ?? null,
        vendorId: input.header.vendorId ?? null,
        vendorCodeText: input.header.vendorCodeText ?? null,
        dcNo: input.header.dcNo ?? null,
        invoiceNo: input.header.invoiceNo ?? null,
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
        goodsReceiptNoteId: header.id,
        lineNo: lineNos[i]!,
        purchaseOrderLineId: l.purchaseOrderLineId ?? null,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        itemName: l.itemName,
        receivedQty: l.receivedQty,
        dcRefNo: l.dcRefNo ?? null,
        qcStatus: l.qcStatus,
        qcAcceptedQty: l.qcAcceptedQty,
        qcRejectedQty: l.qcRejectedQty,
        qcDate: l.qcDate ?? null,
        qcRemarks: l.qcRemarks ?? null,
        qcInspectedBy: l.qcStatus === 'completed' ? user.id : null,
        remarks: l.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      };
    });
    const insertedLines = await tx.insert(goodsReceiptNoteLines).values(lineValues).returning();

    // Fire cascades for every newly-inserted line.
    await runCascades(tx, companyId, user.id, insertedLines, []);

    return {
      ...toGoodsReceiptNote(header),
      lines: insertedLines.map(toGoodsReceiptNoteLine),
    };
  });
}

export async function updateGoodsReceiptNote(
  id: string,
  input: UpdateGoodsReceiptNoteInput,
  user: AuthContext,
): Promise<GoodsReceiptNoteDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existingHdrRows = await tx
      .select()
      .from(goodsReceiptNotes)
      .where(
        and(
          eq(goodsReceiptNotes.id, id),
          eq(goodsReceiptNotes.companyId, companyId),
          isNull(goodsReceiptNotes.deletedAt),
        ),
      )
      .limit(1);
    if (existingHdrRows.length === 0) {
      throw new NotFoundError(`Goods receipt note ${id} not found`);
    }

    if (input.header.vendorId !== undefined && input.header.vendorId !== null) {
      await assertVendorExists(tx, input.header.vendorId, companyId);
    }
    if (input.header.purchaseOrderId !== undefined && input.header.purchaseOrderId !== null) {
      await assertPurchaseOrderExists(tx, input.header.purchaseOrderId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    const h = input.header;
    if (h.grnDate !== undefined) updates['grnDate'] = h.grnDate;
    if (h.purchaseOrderId !== undefined) updates['purchaseOrderId'] = h.purchaseOrderId ?? null;
    if (h.poCodeText !== undefined) updates['poCodeText'] = h.poCodeText ?? null;
    if (h.vendorId !== undefined) updates['vendorId'] = h.vendorId ?? null;
    if (h.vendorCodeText !== undefined) updates['vendorCodeText'] = h.vendorCodeText ?? null;
    if (h.dcNo !== undefined) updates['dcNo'] = h.dcNo ?? null;
    if (h.invoiceNo !== undefined) updates['invoiceNo'] = h.invoiceNo ?? null;
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;

    await tx.update(goodsReceiptNotes).set(updates).where(eq(goodsReceiptNotes.id, id));

    if (input.lines !== undefined) {
      await mergeLines(tx, id, companyId, input.lines, user);
    }

    const updatedHdrRows = await tx
      .select()
      .from(goodsReceiptNotes)
      .where(eq(goodsReceiptNotes.id, id))
      .limit(1);
    const lineRows = await tx
      .select()
      .from(goodsReceiptNoteLines)
      .where(
        and(
          eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
          isNull(goodsReceiptNoteLines.deletedAt),
        ),
      )
      .orderBy(asc(goodsReceiptNoteLines.lineNo));

    return {
      ...toGoodsReceiptNote(updatedHdrRows[0]!),
      lines: lineRows.map(toGoodsReceiptNoteLine),
    };
  });
}

async function mergeLines(
  tx: DbTransaction,
  grnId: string,
  companyId: string,
  inputLines: GoodsReceiptNoteLineInput[],
  user: AuthContext,
): Promise<void> {
  const existing = await tx
    .select()
    .from(goodsReceiptNoteLines)
    .where(
      and(
        eq(goodsReceiptNoteLines.goodsReceiptNoteId, grnId),
        isNull(goodsReceiptNoteLines.deletedAt),
      ),
    );
  const existingById = new Map(existing.map((e) => [e.id, e]));

  const directIds = inputLines.flatMap((l) => (l.itemId ? [l.itemId] : []));
  await assertItemIdsExist(tx, directIds, companyId);
  const codesToResolve = inputLines
    .filter((l) => !l.itemId && l.itemCodeText)
    .map((l) => l.itemCodeText!.trim());
  const resolved = await resolveItemCodes(tx, codesToResolve, companyId);
  const poLineIds = inputLines
    .map((l) => l.purchaseOrderLineId)
    .filter((id): id is string => Boolean(id));
  await assertPoLineIdsExist(tx, poLineIds, companyId);

  const seenInputIds = new Set<string>();
  const toInsert: GoodsReceiptNoteLineInput[] = [];
  const toUpdate: Array<{
    id: string;
    data: GoodsReceiptNoteLineInput;
    prev: typeof goodsReceiptNoteLines.$inferSelect;
  }> = [];

  for (const l of inputLines) {
    if (l.id && existingById.has(l.id)) {
      seenInputIds.add(l.id);
      toUpdate.push({ id: l.id, data: l, prev: existingById.get(l.id)! });
    } else {
      toInsert.push(l);
    }
  }

  // Block QC field changes on already-completed lines.
  for (const u of toUpdate) {
    if (u.prev.qcStatus === 'completed') {
      const qcChanged =
        u.data.qcStatus !== u.prev.qcStatus ||
        u.data.qcAcceptedQty !== u.prev.qcAcceptedQty ||
        u.data.qcRejectedQty !== u.prev.qcRejectedQty ||
        u.data.receivedQty !== u.prev.receivedQty;
      if (qcChanged) {
        throw new ConflictError(
          `GRN line ${u.prev.lineNo} is QC-completed; create a reversing GRN line instead of editing`,
        );
      }
    }
  }

  // Block soft-deleting already-QC-completed lines.
  const absentIds = existing.map((e) => e.id).filter((eid) => !seenInputIds.has(eid));
  for (const aid of absentIds) {
    const prev = existingById.get(aid)!;
    if (prev.qcStatus === 'completed') {
      throw new ConflictError(
        `Cannot remove GRN line ${prev.lineNo} — already QC-completed; create a reversing GRN line instead`,
      );
    }
  }

  // Track every PO line that needs received_qty recompute and every PO header
  // that needs status recompute (current + prior, for the case where a line's
  // PO-line-link changed).
  const touchedPoLineIds = new Set<string>();
  const touchedPoHeaderIds = new Set<string>();

  // Apply soft-deletes.
  if (absentIds.length > 0) {
    for (const aid of absentIds) {
      const prev = existingById.get(aid)!;
      if (prev.purchaseOrderLineId) touchedPoLineIds.add(prev.purchaseOrderLineId);
    }
    await tx
      .update(goodsReceiptNoteLines)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(inArray(goodsReceiptNoteLines.id, absentIds));
  }

  // Apply updates and collect touched PO-line/header sets.
  const cascadeQcUpdates: Array<typeof goodsReceiptNoteLines.$inferSelect> = [];
  for (const u of toUpdate) {
    const refs = resolveLineItemRefs(u.data, resolved);
    const lineUpdate: Record<string, unknown> = { updatedBy: user.id };
    if (u.data.lineNo !== undefined) lineUpdate['lineNo'] = u.data.lineNo;
    if (u.data.purchaseOrderLineId !== undefined) {
      lineUpdate['purchaseOrderLineId'] = u.data.purchaseOrderLineId ?? null;
      if (u.prev.purchaseOrderLineId) touchedPoLineIds.add(u.prev.purchaseOrderLineId);
      if (u.data.purchaseOrderLineId) touchedPoLineIds.add(u.data.purchaseOrderLineId);
    } else if (u.prev.purchaseOrderLineId) {
      touchedPoLineIds.add(u.prev.purchaseOrderLineId);
    }
    if (u.data.itemId !== undefined || u.data.itemCodeText !== undefined) {
      lineUpdate['itemId'] = refs.itemId;
      lineUpdate['itemCodeText'] = refs.itemCodeText;
    }
    if (u.data.itemName !== undefined) lineUpdate['itemName'] = u.data.itemName;
    if (u.data.receivedQty !== undefined) lineUpdate['receivedQty'] = u.data.receivedQty;
    if (u.data.dcRefNo !== undefined) lineUpdate['dcRefNo'] = u.data.dcRefNo ?? null;
    if (u.data.qcStatus !== undefined) lineUpdate['qcStatus'] = u.data.qcStatus;
    if (u.data.qcAcceptedQty !== undefined) lineUpdate['qcAcceptedQty'] = u.data.qcAcceptedQty;
    if (u.data.qcRejectedQty !== undefined) lineUpdate['qcRejectedQty'] = u.data.qcRejectedQty;
    if (u.data.qcDate !== undefined) lineUpdate['qcDate'] = u.data.qcDate ?? null;
    if (u.data.qcRemarks !== undefined) lineUpdate['qcRemarks'] = u.data.qcRemarks ?? null;
    // qcInspectedBy auto-stamped on the completed transition.
    if (u.data.qcStatus === 'completed' && u.prev.qcStatus !== 'completed') {
      lineUpdate['qcInspectedBy'] = user.id;
    }
    if (u.data.remarks !== undefined) lineUpdate['remarks'] = u.data.remarks ?? null;

    await tx
      .update(goodsReceiptNoteLines)
      .set(lineUpdate)
      .where(eq(goodsReceiptNoteLines.id, u.id));

    // Re-read for the cascade — only the QC-accept cascade needs this; for
    // received_qty/header recompute the SQL re-scans authoritatively.
    const reread = await tx
      .select()
      .from(goodsReceiptNoteLines)
      .where(eq(goodsReceiptNoteLines.id, u.id))
      .limit(1);
    const after = reread[0]!;
    cascadeQcUpdates.push(after);

    if (u.data.qcStatus === 'completed' && u.prev.qcStatus !== 'completed' && after.itemId) {
      await writeStoreTxnOnQcAccept({
        tx,
        companyId,
        adminUserId: user.id,
        grnId,
        grnLineId: after.id,
        itemId: after.itemId,
        qcAcceptedQty: after.qcAcceptedQty,
        prevQcStatus: u.prev.qcStatus,
        nextQcStatus: 'completed',
      });
    }
  }

  // Apply inserts.
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
        goodsReceiptNoteId: grnId,
        lineNo: newLineNos[i]!,
        purchaseOrderLineId: l.purchaseOrderLineId ?? null,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        itemName: l.itemName,
        receivedQty: l.receivedQty,
        dcRefNo: l.dcRefNo ?? null,
        qcStatus: l.qcStatus,
        qcAcceptedQty: l.qcAcceptedQty,
        qcRejectedQty: l.qcRejectedQty,
        qcDate: l.qcDate ?? null,
        qcRemarks: l.qcRemarks ?? null,
        qcInspectedBy: l.qcStatus === 'completed' ? user.id : null,
        remarks: l.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      };
    });
    const insertedLines = await tx.insert(goodsReceiptNoteLines).values(values).returning();
    for (const r of insertedLines) {
      if (r.purchaseOrderLineId) touchedPoLineIds.add(r.purchaseOrderLineId);
      if (r.qcStatus === 'completed' && r.itemId && r.qcAcceptedQty > 0) {
        await writeStoreTxnOnQcAccept({
          tx,
          companyId,
          adminUserId: user.id,
          grnId,
          grnLineId: r.id,
          itemId: r.itemId,
          qcAcceptedQty: r.qcAcceptedQty,
          prevQcStatus: undefined,
          nextQcStatus: 'completed',
        });
      }
    }
  }

  // Recompute received_qty for every touched PO line, then header status for
  // the union of their parent POs.
  for (const polId of touchedPoLineIds) {
    await recalcPoLineReceivedQty(tx, polId, user.id);
    const polRows = await tx
      .select({ purchaseOrderId: purchaseOrderLines.purchaseOrderId })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, polId))
      .limit(1);
    if (polRows[0]) touchedPoHeaderIds.add(polRows[0].purchaseOrderId);
  }
  for (const poId of touchedPoHeaderIds) {
    await recalcPoHeaderStatus(tx, poId, user.id);
  }
}

/** Internal helper used by createGoodsReceiptNote to fan out cascades for a
 *  fresh batch of inserted lines. */
async function runCascades(
  tx: DbTransaction,
  companyId: string,
  adminUserId: string,
  insertedLines: Array<typeof goodsReceiptNoteLines.$inferSelect>,
  _existingPoLineIds: string[],
): Promise<void> {
  const touchedPoLineIds = new Set<string>();
  for (const r of insertedLines) {
    if (r.purchaseOrderLineId) touchedPoLineIds.add(r.purchaseOrderLineId);
    if (r.qcStatus === 'completed' && r.itemId && r.qcAcceptedQty > 0) {
      await writeStoreTxnOnQcAccept({
        tx,
        companyId,
        adminUserId,
        grnId: r.goodsReceiptNoteId,
        grnLineId: r.id,
        itemId: r.itemId,
        qcAcceptedQty: r.qcAcceptedQty,
        prevQcStatus: undefined,
        nextQcStatus: 'completed',
      });
    }
  }
  const touchedPoHeaderIds = new Set<string>();
  for (const polId of touchedPoLineIds) {
    await recalcPoLineReceivedQty(tx, polId, adminUserId);
    const polRows = await tx
      .select({ purchaseOrderId: purchaseOrderLines.purchaseOrderId })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, polId))
      .limit(1);
    if (polRows[0]) touchedPoHeaderIds.add(polRows[0].purchaseOrderId);
  }
  for (const poId of touchedPoHeaderIds) {
    await recalcPoHeaderStatus(tx, poId, adminUserId);
  }
}

export async function softDeleteGoodsReceiptNote(
  id: string,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existingHdr = await tx
      .select({ id: goodsReceiptNotes.id })
      .from(goodsReceiptNotes)
      .where(
        and(
          eq(goodsReceiptNotes.id, id),
          eq(goodsReceiptNotes.companyId, companyId),
          isNull(goodsReceiptNotes.deletedAt),
        ),
      )
      .limit(1);
    if (existingHdr.length === 0) {
      throw new NotFoundError(`Goods receipt note ${id} not found`);
    }

    const linesToDelete = await tx
      .select()
      .from(goodsReceiptNoteLines)
      .where(
        and(
          eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
          isNull(goodsReceiptNoteLines.deletedAt),
        ),
      );
    const completed = linesToDelete.find((l) => l.qcStatus === 'completed');
    if (completed) {
      throw new ConflictError(
        `Cannot delete GRN — line ${completed.lineNo} is QC-completed; create a reversing GRN line instead`,
      );
    }

    const touchedPoLineIds = new Set<string>();
    for (const l of linesToDelete) {
      if (l.purchaseOrderLineId) touchedPoLineIds.add(l.purchaseOrderLineId);
    }

    const now = new Date();
    await tx
      .update(goodsReceiptNoteLines)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(
        and(
          eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
          isNull(goodsReceiptNoteLines.deletedAt),
        ),
      );
    await tx
      .update(goodsReceiptNotes)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(eq(goodsReceiptNotes.id, id));

    // Recompute received_qty + PO header status for every PO line that lost
    // a contribution from the deleted GRN lines.
    const touchedPoHeaderIds = new Set<string>();
    for (const polId of touchedPoLineIds) {
      await recalcPoLineReceivedQty(tx, polId, user.id);
      const polRows = await tx
        .select({ purchaseOrderId: purchaseOrderLines.purchaseOrderId })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.id, polId))
        .limit(1);
      if (polRows[0]) touchedPoHeaderIds.add(polRows[0].purchaseOrderId);
    }
    for (const poId of touchedPoHeaderIds) {
      await recalcPoHeaderStatus(tx, poId, user.id);
    }

    return { ok: true };
  });
}
