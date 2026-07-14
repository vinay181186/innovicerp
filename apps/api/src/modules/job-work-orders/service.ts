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

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { clients, items, jobWorkOrderLines, jobWorkOrders } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { withUniqueRetry } from '../../lib/db-retry';
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

/** Validates the client exists in this company and returns its master name
 *  (used to snapshot customer_name from the master, not free text). */
async function assertClientExists(
  tx: DbTransaction,
  clientId: string,
  companyId: string,
): Promise<string> {
  const rows = await tx
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.companyId, companyId), isNull(clients.deletedAt)),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Client ${clientId} not found in this company`);
  }
  return rows[0]!.name;
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

/** Reverse of resolveItemCodes: itemId → master item code. Used on READ so the
 *  detail/edit form can show the readable code for lines that were resolved to
 *  an itemId at write time (their item_code_text is null). Fixes bugs 1.3/1.4. */
async function resolveItemCodesById(
  tx: DbTransaction,
  itemIds: Array<string | null>,
  companyId: string,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(itemIds.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.id, r.code);
  return map;
}

/** Next IN-JW-##### code in the company series (mirrors job-cards nextJcCode).
 *  Server-authoritative so the code no longer depends on a frontend useEffect
 *  (fixes bug 1.2). The MAX+1 scan matches the established repo convention. */
async function nextJwCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: jobWorkOrders.code })
    .from(jobWorkOrders)
    .where(eq(jobWorkOrders.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = (r.code || '').match(/IN-JW-(\d+)\s*$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `IN-JW-${String(max + 1).padStart(5, '0')}`;
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
    // Match JW / client / client-PO, or any of the JWSO's lines by item code /
    // part name (via EXISTS so the header stays one row — #6).
    const searchFrag = term
      ? sql`AND (jw.code ILIKE ${term} OR jw.customer_name ILIKE ${term} OR jw.client_po_no ILIKE ${term}
                 OR EXISTS (
                   SELECT 1 FROM public.job_work_order_lines l2
                   LEFT JOIN public.items i2 ON i2.id = l2.item_id AND i2.deleted_at IS NULL
                   WHERE l2.job_work_order_id = jw.id AND l2.deleted_at IS NULL
                     AND (COALESCE(i2.code, l2.item_code_text) ILIKE ${term} OR l2.part_name ILIKE ${term})
                 ))`
      : sql``;
    const statusFrag = input.status ? sql`AND jw.status = ${input.status}::so_status` : sql``;
    const clientFrag = input.clientId ? sql`AND jw.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND jw.jw_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND jw.jw_date <= ${input.toDate}::date` : sql``;

    // ONE ROW PER JWSO HEADER (#6 — matches the SO Master list). Line aggregates
    // (count, total qty, earliest due) + rolled-up JC qty across all lines.
    const baseWhere = sql`
      FROM public.job_work_orders jw
      WHERE jw.company_id = ${companyId}::uuid AND jw.deleted_at IS NULL
        ${searchFrag} ${statusFrag} ${clientFrag} ${fromFrag} ${toFrag}`;

    const result = await tx.execute(sql`
      SELECT
        jw.id AS "jwId", jw.code, jw.jw_date AS "jwDate",
        jw.client_id AS "clientId", jw.customer_name AS "customerName",
        jw.client_po_no AS "clientPoNo",
        COALESCE(agg.line_count, 0)::int AS "lineCount",
        COALESCE(agg.total_qty, 0)::int AS "totalQty",
        COALESCE(jca.jc_qty, 0)::int AS "jcQty",
        agg.earliest_due::text AS "earliestDueDate",
        jw.status, jw.remarks,
        jw.client_material_qty::text AS "clientMaterialQty",
        jw.material_received_qty::text AS "materialReceivedQty"
      FROM public.job_work_orders jw
      LEFT JOIN (
        SELECT job_work_order_id,
          COUNT(*) AS line_count, SUM(order_qty) AS total_qty, MIN(due_date) AS earliest_due
        FROM public.job_work_order_lines
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
        GROUP BY job_work_order_id
      ) agg ON agg.job_work_order_id = jw.id
      LEFT JOIN (
        SELECT l.job_work_order_id, SUM(jc.order_qty) AS jc_qty
        FROM public.job_cards jc
        JOIN public.job_work_order_lines l
          ON l.id = jc.source_jw_line_id AND l.deleted_at IS NULL
        WHERE jc.deleted_at IS NULL AND jc.source_jw_line_id IS NOT NULL
        GROUP BY l.job_work_order_id
      ) jca ON jca.job_work_order_id = jw.id
      WHERE jw.company_id = ${companyId}::uuid AND jw.deleted_at IS NULL
        ${searchFrag} ${statusFrag} ${clientFrag} ${fromFrag} ${toFrag}
      ORDER BY jw.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const totalRows = await tx.execute(sql`SELECT COUNT(*)::int AS c ${baseWhere}`);
    const total = Number((totalRows as unknown as Array<{ c: number }>)[0]?.c ?? 0);

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): JobWorkOrderListItem {
  return {
    jwId: r['jwId'] as string,
    code: r['code'] as string,
    jwDate: dateLike(r['jwDate']),
    clientId: (r['clientId'] as string | null) ?? null,
    customerName: (r['customerName'] as string | null) ?? null,
    clientPoNo: (r['clientPoNo'] as string | null) ?? null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalQty: Number(r['totalQty'] ?? 0),
    jcQty: Number(r['jcQty'] ?? 0),
    earliestDueDate: (r['earliestDueDate'] as string | null) ?? null,
    status: r['status'] as JobWorkOrder['status'],
    remarks: (r['remarks'] as string | null) ?? null,
    clientMaterialQty: (r['clientMaterialQty'] as string | null) ?? null,
    materialReceivedQty: (r['materialReceivedQty'] as string | null) ?? null,
  };
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
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

    const codeMap = await resolveItemCodesById(
      tx,
      lineRows.map((l) => l.itemId),
      companyId,
    );
    return {
      ...toJobWorkOrder(header),
      lines: lineRows.map((l) => toJobWorkOrderLine(l, codeMap)),
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
    gstPercent: row.gstPercent,
    remarks: row.remarks,
    clientMaterial: row.clientMaterial,
    clientMaterialQty: row.clientMaterialQty,
    materialReceivedDate: row.materialReceivedDate,
    materialReceivedQty: row.materialReceivedQty,
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

function toJobWorkOrderLine(
  row: typeof jobWorkOrderLines.$inferSelect,
  codeByItemId?: Map<string, string>,
): JobWorkOrderLine {
  // On write, a line matched to a master item stores item_id and nulls
  // item_code_text. On read we surface the readable code (from the master) so
  // the detail page and edit form show it instead of a blank / "— linked —".
  const resolvedCode =
    row.itemCodeText ?? (row.itemId ? (codeByItemId?.get(row.itemId) ?? null) : null);
  return {
    id: row.id,
    companyId: row.companyId,
    jobWorkOrderId: row.jobWorkOrderId,
    lineNo: row.lineNo,
    itemId: row.itemId,
    itemCodeText: resolvedCode,
    partName: row.partName,
    material: row.material,
    drawingNo: row.drawingNo,
    uom: row.uom,
    orderQty: row.orderQty,
    rate: row.rate,
    dueDate: row.dueDate,
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

  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on job_work_orders_company_code_uniq (23505) — the MAX+1 generator
  // is not race-proof on its own.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // Code is server-authoritative: when the client omits it (or sends blank),
      // generate the next IN-JW-##### in the company series (fixes bug 1.2). A
      // caller-supplied code is still honoured (and duplicate-checked) for parity
      // with the legacy manual-entry path.
      const code = input.header.code?.trim() || (await nextJwCode(tx, companyId));

      const dup = await tx
        .select({ id: jobWorkOrders.id })
        .from(jobWorkOrders)
        .where(
          and(
            eq(jobWorkOrders.companyId, companyId),
            eq(jobWorkOrders.code, code),
            isNull(jobWorkOrders.deletedAt),
          ),
        )
        .limit(1);
      if (dup.length > 0) {
        throw new ConflictError(`Job work order code "${code}" already exists`);
      }

      // Client master link is enforced by the create schema (route boundary).
      // When a client is set, snapshot its master name into customer_name so the
      // stored customer always mirrors the master (no free text).
      let clientName: string | null = null;
      if (input.header.clientId) {
        clientName = await assertClientExists(tx, input.header.clientId, companyId);
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
          code,
          jwDate: input.header.jwDate,
          clientId: input.header.clientId ?? null,
          customerName: clientName ?? input.header.customerName ?? null,
          clientPoNo: input.header.clientPoNo ?? null,
          status: headerStatus,
          gstPercent: (input.header.gstPercent ?? 18).toFixed(2),
          remarks: input.header.remarks ?? null,
          clientMaterial: input.header.clientMaterial ?? null,
          clientMaterialQty: numToStringOrNull(input.header.clientMaterialQty),
          materialReceivedDate: input.header.materialReceivedDate ?? null,
          materialReceivedQty: numToStringOrNull(input.header.materialReceivedQty),
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
          rate: (l.rate ?? 0).toFixed(2),
          dueDate: l.dueDate ?? null,
          status: l.status ?? headerStatus,
          createdBy: user.id,
          updatedBy: user.id,
        };
      });
      const insertedLines = await tx.insert(jobWorkOrderLines).values(lineValues).returning();
      const codeMap = await resolveItemCodesById(
        tx,
        insertedLines.map((l) => l.itemId),
        companyId,
      );

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
        lines: insertedLines.map((l) => toJobWorkOrderLine(l, codeMap)),
      };
    }),
  );
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

    // When the client changes, snapshot the customer name from the master.
    let snapshotClientName: string | null = null;
    if (input.header.clientId !== undefined && input.header.clientId !== null) {
      snapshotClientName = await assertClientExists(tx, input.header.clientId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    const h = input.header;
    if (h.jwDate !== undefined) updates['jwDate'] = h.jwDate;
    if (h.clientId !== undefined) updates['clientId'] = h.clientId ?? null;
    if (snapshotClientName !== null) updates['customerName'] = snapshotClientName;
    else if (h.customerName !== undefined) updates['customerName'] = h.customerName ?? null;
    if (h.clientPoNo !== undefined) updates['clientPoNo'] = h.clientPoNo ?? null;
    if (h.status !== undefined) updates['status'] = h.status;
    if (h.gstPercent !== undefined) updates['gstPercent'] = Number(h.gstPercent).toFixed(2);
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;
    if (h.clientMaterial !== undefined) updates['clientMaterial'] = h.clientMaterial ?? null;
    if (h.clientMaterialQty !== undefined)
      updates['clientMaterialQty'] = numToStringOrNull(h.clientMaterialQty);
    if (h.materialReceivedDate !== undefined)
      updates['materialReceivedDate'] = h.materialReceivedDate ?? null;
    if (h.materialReceivedQty !== undefined)
      updates['materialReceivedQty'] = numToStringOrNull(h.materialReceivedQty);

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
    const codeMap = await resolveItemCodesById(
      tx,
      lineRows.map((l) => l.itemId),
      companyId,
    );
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
      lines: lineRows.map((l) => toJobWorkOrderLine(l, codeMap)),
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
    if (u.data.rate !== undefined) lineUpdate['rate'] = (u.data.rate ?? 0).toFixed(2);
    if (u.data.dueDate !== undefined) lineUpdate['dueDate'] = u.data.dueDate ?? null;
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
        rate: (l.rate ?? 0).toFixed(2),
        dueDate: l.dueDate ?? null,
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
