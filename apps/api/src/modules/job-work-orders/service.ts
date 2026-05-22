// Job Work Orders service (T-031).
//
// Same shape as the sales-orders service — header + lines in a single
// transaction, option-C merge on update (header always; lines only when
// present in payload). Differences from SO:
//   - No GST / type / cost-center / BOM fields on the header.
//   - JW lines have material-received fields, not rate / clientPoLineNo.
//   - Always require ≥ 1 line (no Equipment exception).
//
// The merge helper is duplicated rather than abstracted out — rule of three.
// If a third module (T-032 / T-038) needs the same logic, extract then.

import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { clients, items, jobWorkOrderLines, jobWorkOrders } from '../../db/schema';
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
  CreateJobWorkOrderInput,
  JobWorkOrder,
  JobWorkOrderDetail,
  JobWorkOrderLine,
  JobWorkOrderLineInput,
  JobWorkOrderListItem,
  ListJobWorkOrdersQuery,
  ListJobWorkOrdersResponse,
  UpdateJobWorkOrderInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function jwDetail(code: string, customerName: string | null | undefined): string {
  return customerName ? `${code} — ${customerName}` : code;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function resolveLineItemRefs(
  line: JobWorkOrderLineInput,
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

function assignLineNos(lines: JobWorkOrderLineInput[], startFrom: number): number[] {
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

function numToStringOrNull(v: number | undefined): string | null {
  return v === undefined ? null : v.toFixed(2);
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listJobWorkOrders(
  input: ListJobWorkOrdersQuery,
  user: AuthContext,
): Promise<ListJobWorkOrdersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (jw.code ILIKE ${term} OR jw.customer_name ILIKE ${term} OR jw.client_po_no ILIKE ${term})`
      : sql``;
    const statusFrag = input.status ? sql`AND jw.status = ${input.status}::so_status` : sql``;
    const clientFrag = input.clientId ? sql`AND jw.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND jw.jw_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND jw.jw_date <= ${input.toDate}::date` : sql``;

    // Single-shot: header + line aggregates (count, total qty, material totals)
    // + JC qty (job_cards.source_jw_line_id back-reference). Mirrors legacy
    // renderJWMaster line 12648 (material status) + line 12645 (jcQty).
    const result = await tx.execute(sql`
      SELECT
        jw.id, jw.company_id AS "companyId", jw.code, jw.jw_date AS "jwDate",
        jw.client_id AS "clientId", jw.customer_name AS "customerName",
        jw.client_po_no AS "clientPoNo", jw.status, jw.remarks,
        jw.created_at AS "createdAt", jw.created_by AS "createdBy",
        jw.updated_at AS "updatedAt", jw.updated_by AS "updatedBy",
        jw.deleted_at AS "deletedAt",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(line_agg.total_qty, 0)::int  AS "totalQty",
        COALESCE(line_agg.client_mat_qty, 0)::text AS "clientMaterialQtyTotal",
        COALESCE(line_agg.material_recv_qty, 0)::text AS "materialReceivedQtyTotal",
        line_agg.earliest_due_date::text      AS "earliestDueDate",
        COALESCE(jc_agg.jc_qty, 0)::int       AS "jcQty"
      FROM public.job_work_orders jw
      LEFT JOIN (
        SELECT job_work_order_id,
               COUNT(*) AS line_count,
               SUM(order_qty) AS total_qty,
               SUM(COALESCE(client_material_qty, 0)) AS client_mat_qty,
               SUM(COALESCE(material_received_qty, 0)) AS material_recv_qty,
               MIN(due_date) AS earliest_due_date
        FROM public.job_work_order_lines
        WHERE deleted_at IS NULL
        GROUP BY job_work_order_id
      ) line_agg ON line_agg.job_work_order_id = jw.id
      LEFT JOIN (
        SELECT jwl.job_work_order_id, SUM(jc.order_qty) AS jc_qty
        FROM public.job_cards jc
        JOIN public.job_work_order_lines jwl ON jc.source_jw_line_id = jwl.id
        WHERE jc.deleted_at IS NULL
        GROUP BY jwl.job_work_order_id
      ) jc_agg ON jc_agg.job_work_order_id = jw.id
      WHERE jw.company_id = ${companyId}::uuid
        AND jw.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${clientFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY jw.code ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(jobWorkOrders.companyId, companyId), isNull(jobWorkOrders.deletedAt)];
    if (input.status) conditions.push(eq(jobWorkOrders.status, input.status));
    if (input.clientId) conditions.push(eq(jobWorkOrders.clientId, input.clientId));
    const totalRows = await tx
      .select({ value: count() })
      .from(jobWorkOrders)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): JobWorkOrderListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    jwDate: dateLike(r['jwDate']),
    clientId: (r['clientId'] as string | null) ?? null,
    customerName: (r['customerName'] as string | null) ?? null,
    clientPoNo: (r['clientPoNo'] as string | null) ?? null,
    status: r['status'] as JobWorkOrder['status'],
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalQty: Number(r['totalQty'] ?? 0),
    jcQty: Number(r['jcQty'] ?? 0),
    clientMaterialQtyTotal: String(r['clientMaterialQtyTotal'] ?? '0'),
    materialReceivedQtyTotal: String(r['materialReceivedQtyTotal'] ?? '0'),
    earliestDueDate: (r['earliestDueDate'] as string | null) ?? null,
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

export async function getJobWorkOrder(id: string, user: AuthContext): Promise<JobWorkOrderDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Job work order ${id} not found`);

    const lineRows = await tx
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)))
      .orderBy(asc(jobWorkOrderLines.lineNo));

    return {
      ...toJobWorkOrder(header),
      lines: lineRows.map(toJobWorkOrderLine),
    };
  });
}

function toJobWorkOrder(row: typeof jobWorkOrders.$inferSelect): JobWorkOrder {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    jwDate: row.jwDate,
    clientId: row.clientId,
    customerName: row.customerName,
    clientPoNo: row.clientPoNo,
    status: row.status,
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

function toJobWorkOrderLine(row: typeof jobWorkOrderLines.$inferSelect): JobWorkOrderLine {
  return {
    id: row.id,
    companyId: row.companyId,
    jobWorkOrderId: row.jobWorkOrderId,
    lineNo: row.lineNo,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    partName: row.partName,
    material: row.material,
    drawingNo: row.drawingNo,
    uom: row.uom,
    orderQty: row.orderQty,
    dueDate: row.dueDate,
    clientMaterial: row.clientMaterial,
    clientMaterialQty: row.clientMaterialQty,
    materialReceivedDate: row.materialReceivedDate,
    materialReceivedQty: row.materialReceivedQty,
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

export async function createJobWorkOrder(
  input: CreateJobWorkOrderInput,
  user: AuthContext,
): Promise<JobWorkOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: jobWorkOrders.id })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.companyId, companyId),
          eq(jobWorkOrders.code, input.header.code),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Job work order code "${input.header.code}" already exists`);
    }

    if (input.header.clientId) {
      await assertClientExists(tx, input.header.clientId, companyId);
    }

    const directIds = input.lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
    await assertItemIdsExist(tx, directIds, companyId);
    const codesToResolve = input.lines
      .filter((l) => !l.itemId && l.itemCodeText)
      .map((l) => l.itemCodeText!.trim());
    const resolved = await resolveItemCodes(tx, codesToResolve, companyId);
    const lineNos = assignLineNos(input.lines, 1);

    const headerStatus = input.header.status ?? 'open';
    const inserted = await tx
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: input.header.code,
        jwDate: input.header.jwDate,
        clientId: input.header.clientId ?? null,
        customerName: input.header.customerName ?? null,
        clientPoNo: input.header.clientPoNo ?? null,
        status: headerStatus,
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
        jobWorkOrderId: header.id,
        lineNo: lineNos[i]!,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        partName: l.partName,
        material: l.material ?? null,
        drawingNo: l.drawingNo ?? null,
        uom: l.uom,
        orderQty: l.orderQty,
        dueDate: l.dueDate ?? null,
        clientMaterial: l.clientMaterial ?? null,
        clientMaterialQty: numToStringOrNull(l.clientMaterialQty),
        materialReceivedDate: l.materialReceivedDate ?? null,
        materialReceivedQty: numToStringOrNull(l.materialReceivedQty),
        status: l.status ?? headerStatus,
        createdBy: user.id,
        updatedBy: user.id,
      };
    });
    const insertedLines = await tx.insert(jobWorkOrderLines).values(lineValues).returning();

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'JobWorkOrder',
        detail: jwDetail(header.code, header.customerName),
        refId: header.code,
      },
      companyId,
      user,
    );

    return {
      ...toJobWorkOrder(header),
      lines: insertedLines.map(toJobWorkOrderLine),
    };
  });
}

export async function updateJobWorkOrder(
  id: string,
  input: UpdateJobWorkOrderInput,
  user: AuthContext,
): Promise<JobWorkOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existingHdrRows = await tx
      .select()
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const existingHdr = existingHdrRows[0];
    if (!existingHdr) throw new NotFoundError(`Job work order ${id} not found`);

    if (input.header.clientId !== undefined && input.header.clientId !== null) {
      await assertClientExists(tx, input.header.clientId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    const h = input.header;
    if (h.jwDate !== undefined) updates['jwDate'] = h.jwDate;
    if (h.clientId !== undefined) updates['clientId'] = h.clientId ?? null;
    if (h.customerName !== undefined) updates['customerName'] = h.customerName ?? null;
    if (h.clientPoNo !== undefined) updates['clientPoNo'] = h.clientPoNo ?? null;
    if (h.status !== undefined) updates['status'] = h.status;
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;

    await tx.update(jobWorkOrders).set(updates).where(eq(jobWorkOrders.id, id));

    if (input.lines !== undefined) {
      await mergeLines(tx, id, companyId, input.lines, user);
    }

    const updatedHdrRows = await tx
      .select()
      .from(jobWorkOrders)
      .where(eq(jobWorkOrders.id, id))
      .limit(1);
    const lineRows = await tx
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)))
      .orderBy(asc(jobWorkOrderLines.lineNo));

    const updatedHdr = updatedHdrRows[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'JobWorkOrder',
        detail: jwDetail(updatedHdr.code, updatedHdr.customerName),
        refId: updatedHdr.code,
      },
      companyId,
      user,
    );

    return {
      ...toJobWorkOrder(updatedHdr),
      lines: lineRows.map(toJobWorkOrderLine),
    };
  });
}

async function mergeLines(
  tx: DbTransaction,
  jobWorkOrderId: string,
  companyId: string,
  inputLines: JobWorkOrderLineInput[],
  user: AuthContext,
): Promise<void> {
  const existing = await tx
    .select({
      id: jobWorkOrderLines.id,
      lineNo: jobWorkOrderLines.lineNo,
    })
    .from(jobWorkOrderLines)
    .where(
      and(
        eq(jobWorkOrderLines.jobWorkOrderId, jobWorkOrderId),
        isNull(jobWorkOrderLines.deletedAt),
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
  const toInsert: JobWorkOrderLineInput[] = [];
  const toUpdate: Array<{ id: string; data: JobWorkOrderLineInput }> = [];

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
      .update(jobWorkOrderLines)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(inArray(jobWorkOrderLines.id, absentIds));
  }

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
    if (u.data.dueDate !== undefined) lineUpdate['dueDate'] = u.data.dueDate ?? null;
    if (u.data.clientMaterial !== undefined)
      lineUpdate['clientMaterial'] = u.data.clientMaterial ?? null;
    if (u.data.clientMaterialQty !== undefined)
      lineUpdate['clientMaterialQty'] = numToStringOrNull(u.data.clientMaterialQty);
    if (u.data.materialReceivedDate !== undefined)
      lineUpdate['materialReceivedDate'] = u.data.materialReceivedDate ?? null;
    if (u.data.materialReceivedQty !== undefined)
      lineUpdate['materialReceivedQty'] = numToStringOrNull(u.data.materialReceivedQty);
    if (u.data.status !== undefined) lineUpdate['status'] = u.data.status;

    await tx.update(jobWorkOrderLines).set(lineUpdate).where(eq(jobWorkOrderLines.id, u.id));
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
        jobWorkOrderId,
        lineNo: newLineNos[i]!,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        partName: l.partName,
        material: l.material ?? null,
        drawingNo: l.drawingNo ?? null,
        uom: l.uom,
        orderQty: l.orderQty,
        dueDate: l.dueDate ?? null,
        clientMaterial: l.clientMaterial ?? null,
        clientMaterialQty: numToStringOrNull(l.clientMaterialQty),
        materialReceivedDate: l.materialReceivedDate ?? null,
        materialReceivedQty: numToStringOrNull(l.materialReceivedQty),
        status: l.status ?? 'open',
        createdBy: user.id,
        updatedBy: user.id,
      };
    });
    await tx.insert(jobWorkOrderLines).values(values);
  }
}

export async function softDeleteJobWorkOrder(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({
        id: jobWorkOrders.id,
        code: jobWorkOrders.code,
        customerName: jobWorkOrders.customerName,
      })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`Job work order ${id} not found`);
    }
    const now = new Date();
    await tx
      .update(jobWorkOrderLines)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)));
    await tx
      .update(jobWorkOrders)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(eq(jobWorkOrders.id, id));
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'JobWorkOrder',
        detail: jwDetail(row.code, row.customerName),
        refId: row.code,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
