// Delivery Challan service (T-040a — read-only).
//
// List + detail only. No create/update/softDelete in T-040a — the legacy DC
// flow (`printChallan` line 26133) cascades into jc_ops.sentQty + outsourceStatus
// transitions and that workflow lands in a future task. Migrated rows are the
// only data; this exposes them to the UI.

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { deliveryChallanLines, deliveryChallans } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import type {
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

export async function getDeliveryChallan(
  id: string,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
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
        createdAt: tsLike(l.createdAt),
        createdBy: l.createdBy,
        updatedAt: tsLike(l.updatedAt),
        updatedBy: l.updatedBy,
        deletedAt: maybeTsLike(l.deletedAt),
      })),
    };
  });
}
