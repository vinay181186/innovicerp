// Delivery Challan service (T-040a read-only + T-059a outward write).
//
// T-040a shipped list + detail only. T-059a adds the outward create + cancel
// flows from the legacy `printChallan` line 26133. Receive-back lands in
// T-059b. Writes go through service.ts so cascades into jc_ops.sentQty +
// outsource_status + store_transactions stay atomic with the DC row insert.

import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  deliveryChallanLines,
  deliveryChallans,
  items,
  purchaseOrderLines,
  purchaseOrders,
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
import { emitActivityLog } from '../activity-log/service';
import {
  applyOutwardToJcOp,
  reverseOutwardFromJcOp,
  reverseStoreTxnOnDcCancel,
  writeStoreTxnOnDcIssue,
} from './cascades';
import type {
  CreateDeliveryChallanInput,
  DeliveryChallanListItem,
  DeliveryChallanWithLines,
  ListDeliveryChallansQuery,
  ListDeliveryChallansResponse,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

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

export async function listDeliveryChallans(
  input: ListDeliveryChallansQuery,
  user: AuthContext,
): Promise<ListDeliveryChallansResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (dc.code ILIKE ${term} OR dc.po_code_text ILIKE ${term} OR v.name ILIKE ${term})`
      : sql``;
    const statusFrag = input.status ? sql`AND dc.status = ${input.status}::dc_status` : sql``;
    const vendorFrag = input.vendorId ? sql`AND dc.vendor_id = ${input.vendorId}::uuid` : sql``;
    const poFrag = input.purchaseOrderId
      ? sql`AND dc.purchase_order_id = ${input.purchaseOrderId}::uuid`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND dc.dc_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND dc.dc_date <= ${input.toDate}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        dc.id, dc.company_id AS "companyId", dc.code,
        dc.dc_date AS "dcDate",
        dc.purchase_order_id AS "purchaseOrderId",
        dc.po_code_text AS "poCodeText",
        dc.vendor_id AS "vendorId",
        dc.vendor_code_text AS "vendorCodeText",
        dc.sales_order_line_id AS "salesOrderLineId",
        dc.so_ref_text AS "soRefText",
        dc.transport,
        dc.status,
        dc.created_at AS "createdAt", dc.created_by AS "createdBy",
        dc.updated_at AS "updatedAt", dc.updated_by AS "updatedBy",
        dc.deleted_at AS "deletedAt",
        v.name AS "vendorName",
        po.code AS "poCode",
        so.code AS "soCode",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(line_agg.total_qty, 0)::text AS "totalQty"
      FROM public.delivery_challans dc
      LEFT JOIN public.vendors v ON v.id = dc.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = dc.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = dc.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS line_count,
          COALESCE(SUM(qty), 0) AS total_qty
        FROM public.delivery_challan_lines dcl
        WHERE dcl.delivery_challan_id = dc.id AND dcl.deleted_at IS NULL
      ) line_agg ON TRUE
      WHERE dc.company_id = ${companyId}::uuid
        AND dc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${vendorFrag}
        ${poFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY dc.dc_date DESC, dc.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [
      eq(deliveryChallans.companyId, companyId),
      isNull(deliveryChallans.deletedAt),
    ];
    if (input.status) conditions.push(eq(deliveryChallans.status, input.status));
    if (input.vendorId) conditions.push(eq(deliveryChallans.vendorId, input.vendorId));
    if (input.purchaseOrderId)
      conditions.push(eq(deliveryChallans.purchaseOrderId, input.purchaseOrderId));
    const totalRows = await tx
      .select({ value: count() })
      .from(deliveryChallans)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const items = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): DeliveryChallanListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    dcDate: dateLike(r['dcDate']),
    purchaseOrderId: (r['purchaseOrderId'] as string | null) ?? null,
    poCodeText: r['poCodeText'] as string,
    vendorId: r['vendorId'] as string,
    vendorCodeText: r['vendorCodeText'] as string,
    salesOrderLineId: (r['salesOrderLineId'] as string | null) ?? null,
    soRefText: (r['soRefText'] as string | null) ?? null,
    transport: (r['transport'] as string | null) ?? null,
    status: r['status'] as DeliveryChallanListItem['status'],
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    vendorName: (r['vendorName'] as string | null) ?? null,
    poCode: (r['poCode'] as string | null) ?? null,
    soCode: (r['soCode'] as string | null) ?? null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalQty: r['totalQty'] as string,
  };
}

async function loadDeliveryChallanWithLines(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<DeliveryChallanWithLines> {
  const headerRows = await tx.execute(sql`
      SELECT
        dc.id, dc.company_id AS "companyId", dc.code,
        dc.dc_date AS "dcDate",
        dc.purchase_order_id AS "purchaseOrderId",
        dc.po_code_text AS "poCodeText",
        dc.vendor_id AS "vendorId",
        dc.vendor_code_text AS "vendorCodeText",
        dc.sales_order_line_id AS "salesOrderLineId",
        dc.so_ref_text AS "soRefText",
        dc.transport,
        dc.status,
        dc.created_at AS "createdAt", dc.created_by AS "createdBy",
        dc.updated_at AS "updatedAt", dc.updated_by AS "updatedBy",
        dc.deleted_at AS "deletedAt",
        v.name AS "vendorName",
        po.code AS "poCode",
        so.code AS "soCode"
      FROM public.delivery_challans dc
      LEFT JOIN public.vendors v ON v.id = dc.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = dc.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = dc.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      WHERE dc.id = ${id}::uuid
        AND dc.company_id = ${companyId}::uuid
        AND dc.deleted_at IS NULL
      LIMIT 1
    `);
  const headerRow = (headerRows as unknown as Array<Record<string, unknown>>)[0];
  if (!headerRow) throw new NotFoundError(`Delivery challan ${id} not found`);

  const lineRows = await tx
    .select()
    .from(deliveryChallanLines)
    .where(
      and(
        eq(deliveryChallanLines.deliveryChallanId, id),
        eq(deliveryChallanLines.companyId, companyId),
        isNull(deliveryChallanLines.deletedAt),
      ),
    )
    .orderBy(deliveryChallanLines.lineNo);

  return {
    id: headerRow['id'] as string,
    companyId: headerRow['companyId'] as string,
    code: headerRow['code'] as string,
    dcDate: dateLike(headerRow['dcDate']),
    purchaseOrderId: (headerRow['purchaseOrderId'] as string | null) ?? null,
    poCodeText: headerRow['poCodeText'] as string,
    vendorId: headerRow['vendorId'] as string,
    vendorCodeText: headerRow['vendorCodeText'] as string,
    salesOrderLineId: (headerRow['salesOrderLineId'] as string | null) ?? null,
    soRefText: (headerRow['soRefText'] as string | null) ?? null,
    transport: (headerRow['transport'] as string | null) ?? null,
    status: headerRow['status'] as DeliveryChallanWithLines['status'],
    createdAt: tsLike(headerRow['createdAt']),
    createdBy: headerRow['createdBy'] as string,
    updatedAt: tsLike(headerRow['updatedAt']),
    updatedBy: headerRow['updatedBy'] as string,
    deletedAt: maybeTsLike(headerRow['deletedAt']),
    vendorName: (headerRow['vendorName'] as string | null) ?? null,
    poCode: (headerRow['poCode'] as string | null) ?? null,
    soCode: (headerRow['soCode'] as string | null) ?? null,
    lines: lineRows.map((l) => ({
      id: l.id,
      companyId: l.companyId,
      deliveryChallanId: l.deliveryChallanId,
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemCodeText: l.itemCodeText,
      itemNameText: l.itemNameText,
      qty: l.qty,
      uom: l.uom,
      materialText: l.materialText,
      dcRemarks: l.dcRemarks,
      purchaseOrderLineId: l.purchaseOrderLineId,
      createdAt: tsLike(l.createdAt),
      createdBy: l.createdBy,
      updatedAt: tsLike(l.updatedAt),
      updatedBy: l.updatedBy,
      deletedAt: maybeTsLike(l.deletedAt),
    })),
  };
}

export async function getDeliveryChallan(
  id: string,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => loadDeliveryChallanWithLines(tx, id, companyId));
}

// ─── Writes (T-059a outward) ───────────────────────────────────────────────

function dcDetail(code: string, vendorCodeText: string | null | undefined): string {
  return vendorCodeText ? `${code} — ${vendorCodeText}` : code;
}

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

async function assertSalesOrderLineExists(
  tx: DbTransaction,
  salesOrderLineId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.id, salesOrderLineId),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Sales order line ${salesOrderLineId} not found in this company`);
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

async function loadPoLineMap(
  tx: DbTransaction,
  poLineIds: string[],
  companyId: string,
): Promise<
  Map<string, { id: string; purchaseOrderId: string; itemId: string | null; qty: number }>
> {
  const out = new Map<
    string,
    { id: string; purchaseOrderId: string; itemId: string | null; qty: number }
  >();
  const unique = Array.from(new Set(poLineIds));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
      purchaseOrderId: purchaseOrderLines.purchaseOrderId,
      itemId: purchaseOrderLines.itemId,
      qty: purchaseOrderLines.qty,
    })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.companyId, companyId),
        inArray(purchaseOrderLines.id, unique),
        isNull(purchaseOrderLines.deletedAt),
      ),
    );
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      purchaseOrderId: r.purchaseOrderId,
      itemId: r.itemId,
      qty: Number(r.qty ?? 0),
    });
  }
  if (out.size !== unique.length) {
    const missing = unique.filter((id) => !out.has(id));
    throw new ValidationError(`PO line id(s) not found: ${missing.join(', ')}`);
  }
  return out;
}

async function sumSentQtyByPoLine(
  tx: DbTransaction,
  poLineIds: string[],
  companyId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = Array.from(new Set(poLineIds));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({
      poLineId: deliveryChallanLines.purchaseOrderLineId,
      sent: sql<string>`COALESCE(SUM(${deliveryChallanLines.qty}), 0)::numeric`,
    })
    .from(deliveryChallanLines)
    .innerJoin(deliveryChallans, eq(deliveryChallans.id, deliveryChallanLines.deliveryChallanId))
    .where(
      and(
        inArray(deliveryChallanLines.purchaseOrderLineId, unique),
        eq(deliveryChallanLines.companyId, companyId),
        isNull(deliveryChallanLines.deletedAt),
        isNull(deliveryChallans.deletedAt),
        sql`${deliveryChallans.status} != 'cancelled'`,
      ),
    )
    .groupBy(deliveryChallanLines.purchaseOrderLineId);
  for (const r of rows) {
    if (r.poLineId) out.set(r.poLineId, Number(r.sent));
  }
  return out;
}

function assignLineNos(
  lines: ReadonlyArray<{ readonly lineNo?: number | undefined }>,
  startFrom: number,
): number[] {
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

export async function createDeliveryChallan(
  input: CreateDeliveryChallanInput,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: deliveryChallans.id })
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.companyId, companyId),
          eq(deliveryChallans.code, input.header.code),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Delivery challan code "${input.header.code}" already exists`);
    }

    await assertVendorExists(tx, input.header.vendorId, companyId);
    if (input.header.purchaseOrderId) {
      await assertPurchaseOrderExists(tx, input.header.purchaseOrderId, companyId);
    }
    if (input.header.salesOrderLineId) {
      await assertSalesOrderLineExists(tx, input.header.salesOrderLineId, companyId);
    }

    const itemIds = input.lines.map((l) => l.itemId);
    await assertItemIdsExist(tx, itemIds, companyId);

    const poLineIds = input.lines
      .map((l) => l.purchaseOrderLineId)
      .filter((id): id is string => Boolean(id));
    const poLines = await loadPoLineMap(tx, poLineIds, companyId);
    const alreadySent = await sumSentQtyByPoLine(tx, poLineIds, companyId);

    // Pre-write validation: each PO line's cumulative-sent + this DC's qty
    // must not exceed the PO line qty.
    const incomingByPoLine = new Map<string, number>();
    for (const l of input.lines) {
      if (!l.purchaseOrderLineId) continue;
      const pol = poLines.get(l.purchaseOrderLineId)!;
      if (input.header.purchaseOrderId && pol.purchaseOrderId !== input.header.purchaseOrderId) {
        throw new ValidationError(
          `PO line ${l.purchaseOrderLineId} does not belong to PO ${input.header.purchaseOrderId}`,
        );
      }
      const prev = incomingByPoLine.get(l.purchaseOrderLineId) ?? 0;
      incomingByPoLine.set(l.purchaseOrderLineId, prev + l.qty);
    }
    for (const [poLineId, inc] of incomingByPoLine) {
      const pol = poLines.get(poLineId)!;
      const already = alreadySent.get(poLineId) ?? 0;
      const remaining = pol.qty - already;
      if (inc > remaining) {
        throw new ConflictError(
          `PO line ${poLineId} has ${remaining} pcs remaining; cannot ship ${inc}`,
        );
      }
    }

    const lineNos = assignLineNos(input.lines, 1);

    const inserted = await tx
      .insert(deliveryChallans)
      .values({
        companyId,
        code: input.header.code,
        dcDate: input.header.dcDate,
        purchaseOrderId: input.header.purchaseOrderId ?? null,
        poCodeText: input.header.poCodeText,
        vendorId: input.header.vendorId,
        vendorCodeText: input.header.vendorCodeText,
        salesOrderLineId: input.header.salesOrderLineId ?? null,
        soRefText: input.header.soRefText ?? null,
        transport: input.header.transport ?? null,
        status: 'issued',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    const lineValues = input.lines.map((l, i) => ({
      companyId,
      deliveryChallanId: header.id,
      lineNo: lineNos[i]!,
      itemId: l.itemId,
      itemCodeText: l.itemCodeText,
      itemNameText: l.itemNameText ?? null,
      qty: String(l.qty),
      uom: l.uom,
      materialText: l.materialText ?? null,
      dcRemarks: l.dcRemarks ?? null,
      purchaseOrderLineId: l.purchaseOrderLineId ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    }));
    const insertedLines = await tx.insert(deliveryChallanLines).values(lineValues).returning();

    // Cascades: stock OUT ledger + jc_op flip per line.
    const opCascades: Array<{ jcCode: string; opSeq: number; qty: number }> = [];
    for (const dl of insertedLines) {
      const qtyInt = Math.round(Number(dl.qty));
      await writeStoreTxnOnDcIssue({
        tx,
        companyId,
        adminUserId: user.id,
        dcCode: header.code,
        dcDate: header.dcDate,
        lineNo: dl.lineNo,
        itemId: dl.itemId,
        qty: qtyInt,
      });
      if (dl.purchaseOrderLineId) {
        const result = await applyOutwardToJcOp({
          tx,
          companyId,
          adminUserId: user.id,
          dcCode: header.code,
          dcDate: header.dcDate,
          purchaseOrderLineId: dl.purchaseOrderLineId,
          qty: qtyInt,
        });
        if (result.fired && result.jcCode && result.opSeq) {
          opCascades.push({ jcCode: result.jcCode, opSeq: result.opSeq, qty: qtyInt });
        }
      }
    }

    // Audit emissions in the same tx.
    await emitActivityLog(
      tx,
      {
        action: 'DC_ISSUE',
        entity: 'DeliveryChallan',
        detail: dcDetail(header.code, header.vendorCodeText),
        refId: header.code,
      },
      companyId,
      user,
    );
    for (const op of opCascades) {
      await emitActivityLog(
        tx,
        {
          action: 'OP_OUTSOURCE_SENT',
          entity: 'JcOp',
          detail: `${op.jcCode} Op ${op.opSeq} — sent ${op.qty} pcs via ${header.code}`,
          refId: op.jcCode,
        },
        companyId,
        user,
      );
    }

    return loadDeliveryChallanWithLines(tx, header.id, companyId);
  });
}

export async function cancelDeliveryChallan(
  id: string,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  // Admin-only — destructive: reverses jc_op state + writes compensating
  // stock ledger rows.
  if (user.role !== 'admin') {
    throw new AuthorizationError(
      `Role "${user.role}" cannot cancel delivery challans — admin required`,
    );
  }
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const headerRows = await tx
      .select()
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.id, id),
          eq(deliveryChallans.companyId, companyId),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1);
    const header = headerRows[0];
    if (!header) throw new NotFoundError(`Delivery challan ${id} not found`);
    if (header.status === 'cancelled') {
      throw new ConflictError(`Delivery challan ${header.code} is already cancelled`);
    }
    if (header.status === 'received') {
      throw new ConflictError(`Delivery challan ${header.code} has been received; cannot cancel`);
    }

    const lineRows = await tx
      .select()
      .from(deliveryChallanLines)
      .where(
        and(eq(deliveryChallanLines.deliveryChallanId, id), isNull(deliveryChallanLines.deletedAt)),
      );

    const opCascades: Array<{ jcCode: string; opSeq: number; qty: number }> = [];
    for (const dl of lineRows) {
      const qtyInt = Math.round(Number(dl.qty));
      await reverseStoreTxnOnDcCancel({
        tx,
        companyId,
        adminUserId: user.id,
        dcCode: header.code,
        dcDate: header.dcDate,
        lineNo: dl.lineNo,
        itemId: dl.itemId,
        qty: qtyInt,
      });
      if (dl.purchaseOrderLineId) {
        const result = await reverseOutwardFromJcOp({
          tx,
          companyId,
          adminUserId: user.id,
          dcCode: header.code,
          dcDate: header.dcDate,
          purchaseOrderLineId: dl.purchaseOrderLineId,
          qty: qtyInt,
        });
        if (result.fired && result.jcCode && result.opSeq) {
          opCascades.push({ jcCode: result.jcCode, opSeq: result.opSeq, qty: qtyInt });
        }
      }
    }

    await tx
      .update(deliveryChallans)
      .set({ status: 'cancelled', updatedBy: user.id })
      .where(eq(deliveryChallans.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'DC_CANCEL',
        entity: 'DeliveryChallan',
        detail: `${header.code} — cancelled`,
        refId: header.code,
      },
      companyId,
      user,
    );
    for (const op of opCascades) {
      await emitActivityLog(
        tx,
        {
          action: 'OP_OUTSOURCE_REVERSED',
          entity: 'JcOp',
          detail: `${op.jcCode} Op ${op.opSeq} — reversed ${op.qty} pcs from ${header.code}`,
          refId: op.jcCode,
        },
        companyId,
        user,
      );
    }

    return loadDeliveryChallanWithLines(tx, id, companyId);
  });
}
