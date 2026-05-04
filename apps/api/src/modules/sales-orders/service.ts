// Sales Orders service (T-030).
//
// Header + lines in a single transaction. Mirrors the legacy SO modal flow
// (`addSO()` line 12413, `_editFullSO()` line 12531) but enforces
// CLAUDE.md §6 contracts: validation here, RLS at DB, soft-delete only,
// no business logic in routes.
//
// Update merge (option C agreed): if `lines` is present in the payload, run
// the legacy merge — id-matched lines are updated, new lines are inserted,
// existing lines whose id is absent from input are soft-deleted. If `lines`
// is omitted, only the header is updated; existing lines untouched. This
// avoids the footgun where a header-only PATCH would wipe lines.

import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { clients, items, salesOrderLines, salesOrders } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import type {
  CreateSalesOrderInput,
  ListSalesOrdersQuery,
  ListSalesOrdersResponse,
  SalesOrder,
  SalesOrderDetail,
  SalesOrderLine,
  SalesOrderLineInput,
  SalesOrderListItem,
  UpdateSalesOrderInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Resolve `clientId` if provided. Throws ValidationError if it doesn't
 *  exist (or doesn't belong to the company / is soft-deleted). */
async function assertClientExists(
  tx: DbTransaction,
  clientId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.companyId, companyId), isNull(clients.deletedAt)),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Client ${clientId} not found in this company`);
  }
}

/** For a batch of line inputs, resolve itemId from itemCodeText where the
 *  caller didn't supply an itemId. Returns a map keyed by the original
 *  itemCodeText. Unresolved codes are NOT errors per ADR-012 #10 — the line
 *  is loaded with item_id=null and item_code_text preserved. */
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

/** Validate that any `itemId` values supplied directly exist + belong to
 *  this company. Same FK-enforcement story as assertClientExists. Dedupes
 *  the input array — the same itemId may appear on many lines of one SO. */
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

/** Resolve `(itemId, itemCodeText)` for a line input per ADR-012 #10:
 *   - itemId provided → trust it (already validated upstream); itemCodeText null
 *   - itemCodeText only → look up; on hit → (uuid, null), on miss → (null, text)
 */
function resolveLineItemRefs(
  line: SalesOrderLineInput,
  resolved: Map<string, string>,
): { itemId: string | null; itemCodeText: string | null } {
  if (line.itemId) {
    return { itemId: line.itemId, itemCodeText: null };
  }
  const code = line.itemCodeText?.trim();
  if (!code) {
    // Refine on the schema already blocks this, but be defensive.
    throw new ValidationError('itemId or itemCodeText is required');
  }
  const found = resolved.get(code);
  return found ? { itemId: found, itemCodeText: null } : { itemId: null, itemCodeText: code };
}

/** Auto-assign / validate lineNo across an array of lines. Mirrors the
 *  legacy `nextLine` counter behaviour. Returns lineNo per index. */
function assignLineNos(lines: SalesOrderLineInput[], startFrom: number): number[] {
  // If any line has lineNo, all must — otherwise reject (mixing is ambiguous).
  const provided = lines.filter((l) => l.lineNo !== undefined);
  if (provided.length > 0 && provided.length !== lines.length) {
    throw new ValidationError('Provide lineNo on every line or none');
  }
  if (provided.length === 0) {
    return lines.map((_, i) => startFrom + i);
  }
  // Caller-provided. Check uniqueness within the batch.
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

function rateToString(input: SalesOrderLineInput): string {
  return (input.rate ?? 0).toFixed(2);
}

function gstToString(g: number): string {
  return g.toFixed(2);
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listSalesOrders(
  input: ListSalesOrdersQuery,
  user: AuthContext,
): Promise<ListSalesOrdersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Build conditional WHERE fragments inline. Mirrors legacy
    // `renderSOmaster` filter set (line 19308 status / line 19542 search).
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (so.code ILIKE ${term} OR so.customer_name ILIKE ${term} OR so.client_po_no ILIKE ${term})`
      : sql``;
    const statusFrag = input.status ? sql`AND so.status = ${input.status}::so_status` : sql``;
    const typeFrag = input.type ? sql`AND so.type = ${input.type}::so_type` : sql``;
    const clientFrag = input.clientId ? sql`AND so.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND so.so_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND so.so_date <= ${input.toDate}::date` : sql``;

    // Single query: headers LEFT JOIN line totals LEFT JOIN JC totals,
    // pagination + ordering inlined. jc_qty is the sum of order_qty across
    // job_cards whose source_so_line_id points at any line of this SO,
    // mirroring legacy `renderSOmaster` line 11853 (`totalJC=lines.reduce(... j.orderQty ...)`).
    const result = await tx.execute(sql`
      SELECT
        so.id, so.company_id AS "companyId", so.code, so.so_date AS "soDate",
        so.client_id AS "clientId", so.customer_name AS "customerName",
        so.client_po_no AS "clientPoNo", so.type, so.status,
        so.gst_percent::text AS "gstPercent",
        so.bom_master_id AS "bomMasterId", so.bom_status AS "bomStatus",
        so.cost_center AS "costCenter", so.remarks,
        so.created_at AS "createdAt", so.created_by AS "createdBy",
        so.updated_at AS "updatedAt", so.updated_by AS "updatedBy",
        so.deleted_at AS "deletedAt",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(line_agg.total_qty, 0)::int AS "totalQty",
        COALESCE(jc_agg.jc_qty, 0)::int       AS "jcQty"
      FROM public.sales_orders so
      LEFT JOIN (
        SELECT sales_order_id, COUNT(*) AS line_count, SUM(order_qty) AS total_qty
        FROM public.sales_order_lines
        WHERE deleted_at IS NULL
        GROUP BY sales_order_id
      ) line_agg ON line_agg.sales_order_id = so.id
      LEFT JOIN (
        SELECT sol.sales_order_id, SUM(jc.order_qty) AS jc_qty
        FROM public.job_cards jc
        JOIN public.sales_order_lines sol ON jc.source_so_line_id = sol.id
        WHERE jc.deleted_at IS NULL
        GROUP BY sol.sales_order_id
      ) jc_agg ON jc_agg.sales_order_id = so.id
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${typeFrag}
        ${clientFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY so.code ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total count uses Drizzle ORM with the same filter set.
    const conditions = [eq(salesOrders.companyId, companyId), isNull(salesOrders.deletedAt)];
    if (input.status) conditions.push(eq(salesOrders.status, input.status));
    if (input.type) conditions.push(eq(salesOrders.type, input.type));
    if (input.clientId) conditions.push(eq(salesOrders.clientId, input.clientId));
    // search/dates omitted from the count for performance; total is approximate
    // when search is active (acceptable — UI shows "X+ results"). Tighten later
    // if needed.
    const totalRows = await tx
      .select({ value: count() })
      .from(salesOrders)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const items = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): SalesOrderListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    soDate: dateLike(r['soDate']),
    clientId: (r['clientId'] as string | null) ?? null,
    customerName: (r['customerName'] as string | null) ?? null,
    clientPoNo: (r['clientPoNo'] as string | null) ?? null,
    type: r['type'] as SalesOrder['type'],
    status: r['status'] as SalesOrder['status'],
    gstPercent: r['gstPercent'] as string,
    bomMasterId: (r['bomMasterId'] as string | null) ?? null,
    bomStatus: (r['bomStatus'] as string | null) ?? null,
    costCenter: (r['costCenter'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalQty: Number(r['totalQty'] ?? 0),
    jcQty: Number(r['jcQty'] ?? 0),
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

export async function getSalesOrder(id: string, user: AuthContext): Promise<SalesOrderDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Sales order ${id} not found`);

    const lineRows = await tx
      .select()
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.salesOrderId, id), isNull(salesOrderLines.deletedAt)))
      .orderBy(asc(salesOrderLines.lineNo));

    return {
      ...toSalesOrder(header),
      lines: lineRows.map(toSalesOrderLine),
    };
  });
}

function toSalesOrder(row: typeof salesOrders.$inferSelect): SalesOrder {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    soDate: row.soDate,
    clientId: row.clientId,
    customerName: row.customerName,
    clientPoNo: row.clientPoNo,
    type: row.type,
    status: row.status,
    gstPercent: row.gstPercent,
    bomMasterId: row.bomMasterId,
    bomStatus: row.bomStatus,
    costCenter: row.costCenter,
    remarks: row.remarks,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt
      ? row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : String(row.deletedAt)
      : null,
  };
}

function toSalesOrderLine(row: typeof salesOrderLines.$inferSelect): SalesOrderLine {
  return {
    id: row.id,
    companyId: row.companyId,
    salesOrderId: row.salesOrderId,
    lineNo: row.lineNo,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    partName: row.partName,
    material: row.material,
    drawingNo: row.drawingNo,
    uom: row.uom,
    orderQty: row.orderQty,
    rate: row.rate,
    dueDate: row.dueDate,
    clientPoLineNo: row.clientPoLineNo,
    status: row.status,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt
      ? row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : String(row.deletedAt)
      : null,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createSalesOrder(
  input: CreateSalesOrderInput,
  user: AuthContext,
): Promise<SalesOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Header uniqueness
    const dup = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.companyId, companyId),
          eq(salesOrders.code, input.header.code),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Sales order code "${input.header.code}" already exists`);
    }

    if (input.header.clientId) {
      await assertClientExists(tx, input.header.clientId, companyId);
    }

    // Line FK pre-resolution
    const directIds = input.lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
    await assertItemIdsExist(tx, directIds, companyId);
    const codesToResolve = input.lines
      .filter((l) => !l.itemId && l.itemCodeText)
      .map((l) => l.itemCodeText!.trim());
    const resolved = await resolveItemCodes(tx, codesToResolve, companyId);
    const lineNos = assignLineNos(input.lines, 1);

    // Insert header
    const headerStatus = input.header.status ?? 'open';
    const headerType = input.header.type ?? 'component_manufacturing';
    const inserted = await tx
      .insert(salesOrders)
      .values({
        companyId,
        code: input.header.code,
        soDate: input.header.soDate,
        clientId: input.header.clientId ?? null,
        customerName: input.header.customerName ?? null,
        clientPoNo: input.header.clientPoNo ?? null,
        type: headerType,
        status: headerStatus,
        gstPercent: gstToString(input.header.gstPercent ?? 18),
        bomMasterId: input.header.bomMasterId ?? null,
        bomStatus: input.header.bomStatus ?? null,
        costCenter: input.header.costCenter ?? null,
        remarks: input.header.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    // Insert lines
    let insertedLines: Array<typeof salesOrderLines.$inferSelect> = [];
    if (input.lines.length > 0) {
      const lineValues = input.lines.map((l, i) => {
        const refs = resolveLineItemRefs(l, resolved);
        return {
          companyId,
          salesOrderId: header.id,
          lineNo: lineNos[i]!,
          itemId: refs.itemId,
          itemCodeText: refs.itemCodeText,
          partName: l.partName,
          material: l.material ?? null,
          drawingNo: l.drawingNo ?? null,
          uom: l.uom,
          orderQty: l.orderQty,
          rate: rateToString(l),
          dueDate: l.dueDate ?? null,
          clientPoLineNo: l.clientPoLineNo ?? null,
          status: l.status ?? headerStatus,
          createdBy: user.id,
          updatedBy: user.id,
        };
      });
      insertedLines = await tx.insert(salesOrderLines).values(lineValues).returning();
    }

    return {
      ...toSalesOrder(header),
      lines: insertedLines.map(toSalesOrderLine),
    };
  });
}

export async function updateSalesOrder(
  id: string,
  input: UpdateSalesOrderInput,
  user: AuthContext,
): Promise<SalesOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existingHdrRows = await tx
      .select()
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const existingHdr = existingHdrRows[0];
    if (!existingHdr) throw new NotFoundError(`Sales order ${id} not found`);

    if (input.header.clientId !== undefined && input.header.clientId !== null) {
      await assertClientExists(tx, input.header.clientId, companyId);
    }

    // Header update — only set the fields the caller provided.
    const updates: Record<string, unknown> = { updatedBy: user.id };
    const h = input.header;
    if (h.soDate !== undefined) updates['soDate'] = h.soDate;
    if (h.clientId !== undefined) updates['clientId'] = h.clientId ?? null;
    if (h.customerName !== undefined) updates['customerName'] = h.customerName ?? null;
    if (h.clientPoNo !== undefined) updates['clientPoNo'] = h.clientPoNo ?? null;
    if (h.type !== undefined) updates['type'] = h.type;
    if (h.status !== undefined) updates['status'] = h.status;
    if (h.gstPercent !== undefined) updates['gstPercent'] = gstToString(h.gstPercent);
    if (h.bomMasterId !== undefined) updates['bomMasterId'] = h.bomMasterId ?? null;
    if (h.bomStatus !== undefined) updates['bomStatus'] = h.bomStatus ?? null;
    if (h.costCenter !== undefined) updates['costCenter'] = h.costCenter ?? null;
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;

    await tx.update(salesOrders).set(updates).where(eq(salesOrders.id, id));

    // Lines merge — only when caller provided a `lines` array (option C).
    if (input.lines !== undefined) {
      await mergeLines(tx, id, companyId, input.lines, user);
    }

    // Re-read for response
    const updatedHdrRows = await tx
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, id))
      .limit(1);
    const lineRows = await tx
      .select()
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.salesOrderId, id), isNull(salesOrderLines.deletedAt)))
      .orderBy(asc(salesOrderLines.lineNo));

    return {
      ...toSalesOrder(updatedHdrRows[0]!),
      lines: lineRows.map(toSalesOrderLine),
    };
  });
}

async function mergeLines(
  tx: DbTransaction,
  salesOrderId: string,
  companyId: string,
  inputLines: SalesOrderLineInput[],
  user: AuthContext,
): Promise<void> {
  const existing = await tx
    .select({
      id: salesOrderLines.id,
      lineNo: salesOrderLines.lineNo,
    })
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.salesOrderId, salesOrderId), isNull(salesOrderLines.deletedAt)));
  const existingById = new Map(existing.map((e) => [e.id, e]));

  // Pre-validate FKs in one shot.
  const directIds = inputLines.flatMap((l) => (l.itemId ? [l.itemId] : []));
  await assertItemIdsExist(tx, directIds, companyId);
  const codesToResolve = inputLines
    .filter((l) => !l.itemId && l.itemCodeText)
    .map((l) => l.itemCodeText!.trim());
  const resolved = await resolveItemCodes(tx, codesToResolve, companyId);

  // Decide updates vs inserts.
  const seenInputIds = new Set<string>();
  const toInsert: SalesOrderLineInput[] = [];
  const toUpdate: Array<{ id: string; data: SalesOrderLineInput }> = [];

  for (const l of inputLines) {
    if (l.id && existingById.has(l.id)) {
      seenInputIds.add(l.id);
      toUpdate.push({ id: l.id, data: l });
    } else {
      toInsert.push(l);
    }
  }

  // Soft-delete absentees.
  const absentIds = existing.map((e) => e.id).filter((eid) => !seenInputIds.has(eid));
  if (absentIds.length > 0) {
    await tx
      .update(salesOrderLines)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(inArray(salesOrderLines.id, absentIds));
  }

  // Apply updates.
  for (const u of toUpdate) {
    const refs = resolveLineItemRefs(u.data, resolved);
    const lineUpdate: Record<string, unknown> = { updatedBy: user.id };
    if (u.data.lineNo !== undefined) lineUpdate['lineNo'] = u.data.lineNo;
    if (u.data.itemId !== undefined || u.data.itemCodeText !== undefined) {
      lineUpdate['itemId'] = refs.itemId;
      lineUpdate['itemCodeText'] = refs.itemCodeText;
    }
    if (u.data.partName !== undefined) lineUpdate['partName'] = u.data.partName;
    if (u.data.material !== undefined) lineUpdate['material'] = u.data.material ?? null;
    if (u.data.drawingNo !== undefined) lineUpdate['drawingNo'] = u.data.drawingNo ?? null;
    if (u.data.uom !== undefined) lineUpdate['uom'] = u.data.uom;
    if (u.data.orderQty !== undefined) lineUpdate['orderQty'] = u.data.orderQty;
    if (u.data.rate !== undefined) lineUpdate['rate'] = rateToString(u.data);
    if (u.data.dueDate !== undefined) lineUpdate['dueDate'] = u.data.dueDate ?? null;
    if (u.data.clientPoLineNo !== undefined)
      lineUpdate['clientPoLineNo'] = u.data.clientPoLineNo ?? null;
    if (u.data.status !== undefined) lineUpdate['status'] = u.data.status;

    await tx.update(salesOrderLines).set(lineUpdate).where(eq(salesOrderLines.id, u.id));
  }

  // Apply inserts. Auto-assign lineNo from max(existing - absent) + 1 unless provided.
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
        salesOrderId,
        lineNo: newLineNos[i]!,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        partName: l.partName,
        material: l.material ?? null,
        drawingNo: l.drawingNo ?? null,
        uom: l.uom,
        orderQty: l.orderQty,
        rate: rateToString(l),
        dueDate: l.dueDate ?? null,
        clientPoLineNo: l.clientPoLineNo ?? null,
        status: l.status ?? 'open',
        createdBy: user.id,
        updatedBy: user.id,
      };
    });
    await tx.insert(salesOrderLines).values(values);
  }
}

export async function softDeleteSalesOrder(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`Sales order ${id} not found`);
    }
    const now = new Date();
    await tx
      .update(salesOrderLines)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(and(eq(salesOrderLines.salesOrderId, id), isNull(salesOrderLines.deletedAt)));
    await tx
      .update(salesOrders)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(eq(salesOrders.id, id));
    return { ok: true };
  });
}
