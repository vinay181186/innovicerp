// JW Delivery Challan service (Store slice 3).
//
// Outward = Returnable Gate Pass when sending material out for job work.
// Inward = receiving processed/returned material back from JW vendor.
// Mirrors legacy renderJWDC + _jwdcNewOutward + _jwdcNewInward
// (HTML L24434 / L24489 / L24692).
//
// Stock cascades:
//   Outward line: items.stock_qty -= sentQty; emit
//     store_transactions(txn_type='out', source_type='jw_out').
//   Inward line: if okQty>0, items.stock_qty += okQty; emit
//     store_transactions(txn_type='in', source_type='jw_in').
//   Rejected qty stored on the row; downstream NC integration deferred.

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateJwDcInwardInput,
  CreateJwDcOutwardInput,
  JwDcInward,
  JwDcOutward,
  JwDcOutwardDetail,
  JwDcOutwardListItem,
  JwDcInwardListItem,
  JwDcPoLinesResponse,
  ListJwDcInwardQuery,
  ListJwDcInwardResponse,
  ListJwDcOutwardQuery,
  ListJwDcOutwardResponse,
} from '@innovic/shared';
import {
  jwDcInward,
  jwDcInwardLines,
  jwDcOutward,
  jwDcOutwardLines,
  purchaseOrderLines,
  purchaseOrders,
  storeTransactions,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ─── Numbering ─────────────────────────────────────────────────────────────

async function nextOutwardCode(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^JWDC-OUT-', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.jw_dc_outward
    WHERE company_id = ${companyId}::uuid
      AND code LIKE 'JWDC-OUT-%'
      AND code ~ '^JWDC-OUT-\\d+$'
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `JWDC-OUT-${String(next).padStart(4, '0')}`;
}

async function nextInwardCode(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^JWIN-', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.jw_dc_inward
    WHERE company_id = ${companyId}::uuid
      AND code LIKE 'JWIN-%'
      AND code ~ '^JWIN-\\d+$'
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `JWIN-${String(next).padStart(4, '0')}`;
}

// ─── Outward — list ───────────────────────────────────────────────────────

export async function listJwDcOutward(
  input: ListJwDcOutwardQuery,
  user: AuthContext,
): Promise<ListJwDcOutwardResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          jdo.code ILIKE ${term}
          OR jdo.jwpo_code_text ILIKE ${term}
          OR jdo.vendor_name_text ILIKE ${term}
          OR jdo.vendor_code_text ILIKE ${term}
        )`
      : sql``;
    const vendorFrag = input.vendorId
      ? sql`AND jdo.vendor_id = ${input.vendorId}::uuid`
      : sql``;
    const poFrag = input.purchaseOrderId
      ? sql`AND jdo.purchase_order_id = ${input.purchaseOrderId}::uuid`
      : sql``;
    const statusFrag = input.returnStatus
      ? sql`AND (
          CASE
            WHEN COALESCE(rs.pending, 0) = 0 AND COALESCE(rs.total_sent, 0) > 0 THEN 'fully_returned'
            WHEN COALESCE(rs.total_returned, 0) > 0 THEN 'partial'
            ELSE 'out'
          END
        ) = ${input.returnStatus}`
      : sql``;

    const result = await tx.execute(sql`
      WITH return_stats AS (
        SELECT
          jdol.jw_dc_outward_id AS dc_id,
          SUM(jdol.sent_qty)::int AS total_sent,
          COUNT(*)::int AS lines_count,
          COALESCE(SUM(rl.returned_qty)::int, 0) AS total_returned
        FROM public.jw_dc_outward_lines jdol
        LEFT JOIN LATERAL (
          SELECT SUM(jdil.received_qty)::int AS returned_qty
          FROM public.jw_dc_inward_lines jdil
          WHERE jdil.jw_dc_outward_line_id = jdol.id
            AND jdil.deleted_at IS NULL
        ) rl ON true
        WHERE jdol.deleted_at IS NULL
        GROUP BY jdol.jw_dc_outward_id
      )
      SELECT
        jdo.id, jdo.company_id AS "companyId", jdo.code,
        jdo.dc_date AS "dcDate",
        jdo.purchase_order_id AS "purchaseOrderId",
        jdo.jwpo_code_text AS "jwpoCodeText",
        jdo.vendor_id AS "vendorId",
        jdo.vendor_code_text AS "vendorCodeText",
        jdo.vendor_name_text AS "vendorNameText",
        jdo.vehicle_no AS "vehicleNo",
        jdo.remarks,
        jdo.created_at AS "createdAt", jdo.created_by AS "createdBy",
        jdo.updated_at AS "updatedAt", jdo.updated_by AS "updatedBy",
        jdo.deleted_at AS "deletedAt",
        COALESCE(rs.lines_count, 0)::int AS "linesCount",
        COALESCE(rs.total_sent, 0)::int AS "totalSentQty",
        COALESCE(rs.total_returned, 0)::int AS "totalReturnedQty",
        GREATEST(0, COALESCE(rs.total_sent, 0) - COALESCE(rs.total_returned, 0))::int AS "pendingQty",
        CASE
          WHEN COALESCE(rs.total_sent, 0) > 0
            AND COALESCE(rs.total_returned, 0) >= COALESCE(rs.total_sent, 0) THEN 'fully_returned'
          WHEN COALESCE(rs.total_returned, 0) > 0 THEN 'partial'
          ELSE 'out'
        END AS "returnStatus"
      FROM public.jw_dc_outward jdo
      LEFT JOIN return_stats rs ON rs.dc_id = jdo.id
      WHERE jdo.company_id = ${companyId}::uuid
        AND jdo.deleted_at IS NULL
        ${searchFrag}
        ${vendorFrag}
        ${poFrag}
        ${statusFrag}
      ORDER BY jdo.dc_date DESC, jdo.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(jwDcOutward.companyId, companyId), isNull(jwDcOutward.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(jwDcOutward)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(
      toOutwardListItem,
    );
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

function toOutwardListItem(r: Record<string, unknown>): JwDcOutwardListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    dcDate: dateLike(r['dcDate']),
    purchaseOrderId: (r['purchaseOrderId'] as string | null) ?? null,
    jwpoCodeText: (r['jwpoCodeText'] as string | null) ?? null,
    vendorId: (r['vendorId'] as string | null) ?? null,
    vendorCodeText: (r['vendorCodeText'] as string | null) ?? null,
    vendorNameText: (r['vendorNameText'] as string | null) ?? null,
    vehicleNo: (r['vehicleNo'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    linesCount: Number(r['linesCount'] ?? 0),
    totalSentQty: Number(r['totalSentQty'] ?? 0),
    totalReturnedQty: Number(r['totalReturnedQty'] ?? 0),
    pendingQty: Number(r['pendingQty'] ?? 0),
    returnStatus: (r['returnStatus'] as 'out' | 'partial' | 'fully_returned') ?? 'out',
  };
}

// ─── Outward — detail ─────────────────────────────────────────────────────

export async function getJwDcOutwardDetail(
  id: string,
  user: AuthContext,
): Promise<JwDcOutwardDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headerRows = await tx
      .select()
      .from(jwDcOutward)
      .where(
        and(
          eq(jwDcOutward.id, id),
          eq(jwDcOutward.companyId, companyId),
          isNull(jwDcOutward.deletedAt),
        ),
      )
      .limit(1);
    const header = headerRows[0];
    if (!header) throw new NotFoundError(`JW DC Outward ${id} not found`);

    const lineRows = (await tx.execute(sql`
      SELECT
        jdol.id, jdol.company_id AS "companyId", jdol.jw_dc_outward_id AS "jwDcOutwardId",
        jdol.line_no AS "lineNo",
        jdol.purchase_order_line_id AS "purchaseOrderLineId",
        jdol.item_id AS "itemId",
        jdol.item_code_text AS "itemCodeText",
        jdol.item_name_text AS "itemNameText",
        jdol.process_text AS "processText",
        jdol.po_qty AS "poQty",
        jdol.sent_qty AS "sentQty",
        jdol.store_transaction_id AS "storeTransactionId",
        jdol.created_at AS "createdAt", jdol.created_by AS "createdBy",
        jdol.updated_at AS "updatedAt", jdol.updated_by AS "updatedBy",
        jdol.deleted_at AS "deletedAt",
        COALESCE(ret.returned, 0)::int AS "alreadyReturned"
      FROM public.jw_dc_outward_lines jdol
      LEFT JOIN LATERAL (
        SELECT SUM(received_qty)::int AS returned
        FROM public.jw_dc_inward_lines jdil
        WHERE jdil.jw_dc_outward_line_id = jdol.id
          AND jdil.deleted_at IS NULL
      ) ret ON true
      WHERE jdol.jw_dc_outward_id = ${id}::uuid
        AND jdol.deleted_at IS NULL
      ORDER BY jdol.line_no
    `)) as unknown as Array<Record<string, unknown>>;

    const lines = lineRows.map((r) => {
      const sent = Number(r['sentQty'] ?? 0);
      const ret = Number(r['alreadyReturned'] ?? 0);
      const pending = Math.max(0, sent - ret);
      return {
        id: r['id'] as string,
        companyId: r['companyId'] as string,
        jwDcOutwardId: r['jwDcOutwardId'] as string,
        lineNo: Number(r['lineNo']),
        purchaseOrderLineId: (r['purchaseOrderLineId'] as string | null) ?? null,
        itemId: (r['itemId'] as string | null) ?? null,
        itemCodeText: String(r['itemCodeText'] ?? ''),
        itemNameText: (r['itemNameText'] as string | null) ?? null,
        processText: (r['processText'] as string | null) ?? null,
        poQty: Number(r['poQty'] ?? 0),
        sentQty: sent,
        storeTransactionId: (r['storeTransactionId'] as string | null) ?? null,
        createdAt: tsLike(r['createdAt']),
        createdBy: r['createdBy'] as string,
        updatedAt: tsLike(r['updatedAt']),
        updatedBy: r['updatedBy'] as string,
        deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
        alreadyReturned: ret,
        pending,
      };
    });

    const totalSent = lines.reduce((s, l) => s + l.sentQty, 0);
    const totalReturned = lines.reduce((s, l) => s + l.alreadyReturned, 0);
    const pendingQty = Math.max(0, totalSent - totalReturned);
    const returnStatus: 'out' | 'partial' | 'fully_returned' =
      totalSent > 0 && totalReturned >= totalSent
        ? 'fully_returned'
        : totalReturned > 0
          ? 'partial'
          : 'out';

    return {
      id: header.id,
      companyId: header.companyId,
      code: header.code,
      dcDate: dateLike(header.dcDate),
      purchaseOrderId: header.purchaseOrderId,
      jwpoCodeText: header.jwpoCodeText,
      vendorId: header.vendorId,
      vendorCodeText: header.vendorCodeText,
      vendorNameText: header.vendorNameText,
      vehicleNo: header.vehicleNo,
      remarks: header.remarks,
      createdAt: tsLike(header.createdAt),
      createdBy: header.createdBy,
      updatedAt: tsLike(header.updatedAt),
      updatedBy: header.updatedBy,
      deletedAt: header.deletedAt != null ? tsLike(header.deletedAt) : null,
      linesCount: lines.length,
      totalSentQty: totalSent,
      totalReturnedQty: totalReturned,
      pendingQty,
      returnStatus,
      lines,
    };
  });
}

// ─── Outward — PO line loader (for new modal) ────────────────────────────

export async function getJwDcPoLines(
  purchaseOrderId: string,
  user: AuthContext,
): Promise<JwDcPoLinesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const poRows = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, purchaseOrderId),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const po = poRows[0];
    if (!po) throw new NotFoundError(`Purchase Order ${purchaseOrderId} not found`);
    if (po.poType !== 'job_work') {
      throw new ValidationError(`PO ${po.code} is not a Job Work PO (type=${po.poType})`);
    }

    const lineRows = (await tx.execute(sql`
      SELECT
        pol.id AS "purchaseOrderLineId",
        pol.item_id AS "itemId",
        COALESCE(i.code, pol.item_code_text, '') AS "itemCode",
        pol.item_name AS "itemName",
        pol.line_remarks AS "processText",
        pol.qty AS "poQty",
        COALESCE(sent.total_sent, 0)::int AS "alreadySent"
      FROM public.purchase_order_lines pol
      LEFT JOIN public.items i ON i.id = pol.item_id AND i.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT SUM(jdol.sent_qty)::int AS total_sent
        FROM public.jw_dc_outward_lines jdol
        JOIN public.jw_dc_outward jdo ON jdo.id = jdol.jw_dc_outward_id AND jdo.deleted_at IS NULL
        WHERE jdol.purchase_order_line_id = pol.id
          AND jdol.deleted_at IS NULL
      ) sent ON true
      WHERE pol.purchase_order_id = ${purchaseOrderId}::uuid
        AND pol.deleted_at IS NULL
      ORDER BY pol.line_no
    `)) as unknown as Array<Record<string, unknown>>;

    const lines = lineRows.map((r) => {
      const poQty = Number(r['poQty'] ?? 0);
      const sent = Number(r['alreadySent'] ?? 0);
      return {
        purchaseOrderLineId: r['purchaseOrderLineId'] as string,
        itemId: (r['itemId'] as string | null) ?? null,
        itemCode: String(r['itemCode'] ?? ''),
        itemName: String(r['itemName'] ?? ''),
        processText: (r['processText'] as string | null) ?? null,
        poQty,
        alreadySent: sent,
        available: Math.max(0, poQty - sent),
      };
    });

    return {
      purchaseOrderId: po.id,
      poCodeText: po.code,
      vendorCodeText: po.vendorCodeText ?? null,
      vendorNameText: null,
      lines,
    };
  });
}

// ─── Outward — create ─────────────────────────────────────────────────────

export async function createJwDcOutward(
  input: CreateJwDcOutwardInput,
  user: AuthContext,
): Promise<JwDcOutward> {
  const companyId = requireCompany(user);
  const userId = user.id;
  if (input.lines.length === 0) {
    throw new ValidationError('At least one line is required');
  }

  return withUserContext(user, async (tx) => {
    // 1) Load PO + vendor info
    const poRows = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, input.purchaseOrderId),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);
    const po = poRows[0];
    if (!po) throw new NotFoundError(`Purchase Order ${input.purchaseOrderId} not found`);
    if (po.poType !== 'job_work') {
      throw new ValidationError(`PO ${po.code} is not a Job Work PO`);
    }

    // 2) Load PO lines we'll dispatch against
    const poLineIds = input.lines.map((l) => l.purchaseOrderLineId);
    const poLineRows = await tx
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.purchaseOrderId, po.id),
          isNull(purchaseOrderLines.deletedAt),
        ),
      );
    const polById = new Map(poLineRows.map((p) => [p.id, p]));
    for (const id of poLineIds) {
      if (!polById.has(id)) {
        throw new NotFoundError(`PO line ${id} not found on PO ${po.code}`);
      }
    }

    // 3) Validate available qty (poQty - alreadySent) >= sentQty per line
    const sentSoFar = (await tx.execute(sql`
      SELECT
        jdol.purchase_order_line_id AS pol_id,
        SUM(jdol.sent_qty)::int AS total_sent
      FROM public.jw_dc_outward_lines jdol
      JOIN public.jw_dc_outward jdo ON jdo.id = jdol.jw_dc_outward_id AND jdo.deleted_at IS NULL
      WHERE jdol.deleted_at IS NULL
        AND jdol.purchase_order_line_id = ANY(${poLineIds}::uuid[])
      GROUP BY jdol.purchase_order_line_id
    `)) as unknown as Array<{ pol_id: string; total_sent: number }>;
    const sentMap = new Map(sentSoFar.map((r) => [r.pol_id, Number(r.total_sent)]));
    for (const ln of input.lines) {
      const pol = polById.get(ln.purchaseOrderLineId)!;
      const available = Math.max(0, pol.qty - (sentMap.get(pol.id) ?? 0));
      if (ln.sentQty > available) {
        throw new ConflictError(
          `Line ${pol.itemCodeText ?? pol.itemName}: send qty ${ln.sentQty} exceeds available ${available}`,
        );
      }
    }

    // 4) Lock item rows for stock update
    const itemIds = Array.from(
      new Set(input.lines.map((l) => polById.get(l.purchaseOrderLineId)!.itemId).filter(Boolean) as string[]),
    );
    for (const id of itemIds) {
      await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${id}::uuid FOR UPDATE`);
    }

    // 5) Snapshot vendor name for the header (legacy denorm)
    let vendorNameText: string | null = null;
    if (po.vendorId) {
      const vRows = (await tx.execute(sql`
        SELECT name FROM public.vendors WHERE id = ${po.vendorId}::uuid LIMIT 1
      `)) as unknown as Array<{ name: string }>;
      vendorNameText = vRows[0]?.name ?? null;
    }

    // 6) Insert header
    const code = await nextOutwardCode(tx, companyId);
    const inserted = await tx
      .insert(jwDcOutward)
      .values({
        companyId,
        code,
        dcDate: input.dcDate,
        purchaseOrderId: po.id,
        jwpoCodeText: po.code,
        vendorId: po.vendorId ?? null,
        vendorCodeText: po.vendorCodeText ?? null,
        vendorNameText,
        vehicleNo: input.vehicleNo ?? null,
        remarks: input.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const header = inserted[0];
    if (!header) throw new ValidationError('Failed to insert JW DC outward header');

    // 7) Insert lines + emit store_transactions + decrement item stock
    for (const [idx, ln] of input.lines.entries()) {
      const pol = polById.get(ln.purchaseOrderLineId)!;
      let storeTxnId: string | null = null;

      if (pol.itemId) {
        const balRows = (await tx.execute(sql`
          SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
          FROM public.v_item_stock
          WHERE company_id = ${companyId}::uuid AND item_id = ${pol.itemId}::uuid
        `)) as unknown as Array<{ on_hand: number }>;
        const stockBefore = Number(balRows[0]?.on_hand ?? 0);
        const stockAfter = Math.max(0, stockBefore - ln.sentQty);
        const stRows = await tx
          .insert(storeTransactions)
          .values({
            companyId,
            txnDate: input.dcDate,
            itemId: pol.itemId,
            itemCodeText: pol.itemCodeText ?? null,
            txnType: 'out',
            qty: ln.sentQty,
            sourceType: 'jw_out',
            sourceRef: `${code} · ${pol.itemCodeText ?? pol.itemName}`,
            stockBefore,
            stockAfter,
            remarks: `JW DC Outward · to ${vendorNameText ?? po.vendorCodeText ?? ''} for ${pol.lineRemarks ?? ''}`.trim(),
            createdBy: userId,
          })
          .returning({ id: storeTransactions.id });
        storeTxnId = stRows[0]?.id ?? null;
      }

      await tx.insert(jwDcOutwardLines).values({
        companyId,
        jwDcOutwardId: header.id,
        lineNo: idx + 1,
        purchaseOrderLineId: pol.id,
        itemId: pol.itemId ?? null,
        itemCodeText: pol.itemCodeText ?? pol.itemName,
        itemNameText: pol.itemName,
        processText: pol.lineRemarks ?? null,
        poQty: pol.qty,
        sentQty: ln.sentQty,
        storeTransactionId: storeTxnId,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    return rowToOutward(header);
  });
}

function rowToOutward(row: typeof jwDcOutward.$inferSelect): JwDcOutward {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    dcDate: dateLike(row.dcDate),
    purchaseOrderId: row.purchaseOrderId,
    jwpoCodeText: row.jwpoCodeText,
    vendorId: row.vendorId,
    vendorCodeText: row.vendorCodeText,
    vendorNameText: row.vendorNameText,
    vehicleNo: row.vehicleNo,
    remarks: row.remarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}

// ─── Inward — list ────────────────────────────────────────────────────────

export async function listJwDcInward(
  input: ListJwDcInwardQuery,
  user: AuthContext,
): Promise<ListJwDcInwardResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          jdi.code ILIKE ${term}
          OR jdi.dc_code_text ILIKE ${term}
          OR jdi.vendor_challan_no ILIKE ${term}
          OR jdo.vendor_name_text ILIKE ${term}
        )`
      : sql``;
    const outFrag = input.jwDcOutwardId
      ? sql`AND jdi.jw_dc_outward_id = ${input.jwDcOutwardId}::uuid`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        jdi.id, jdi.company_id AS "companyId", jdi.code,
        jdi.inward_date AS "inwardDate",
        jdi.jw_dc_outward_id AS "jwDcOutwardId",
        jdi.dc_code_text AS "dcCodeText",
        jdi.vendor_challan_no AS "vendorChallanNo",
        jdi.vehicle_no AS "vehicleNo",
        jdi.remarks,
        jdi.created_at AS "createdAt", jdi.created_by AS "createdBy",
        jdi.updated_at AS "updatedAt", jdi.updated_by AS "updatedBy",
        jdi.deleted_at AS "deletedAt",
        jdo.vendor_name_text AS "vendorNameText",
        COALESCE(agg.total_received, 0)::int AS "totalReceivedQty",
        COALESCE(agg.total_ok, 0)::int AS "totalOkQty",
        COALESCE(agg.total_rej, 0)::int AS "totalRejectedQty"
      FROM public.jw_dc_inward jdi
      LEFT JOIN public.jw_dc_outward jdo ON jdo.id = jdi.jw_dc_outward_id AND jdo.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT
          SUM(received_qty)::int AS total_received,
          SUM(ok_qty)::int AS total_ok,
          SUM(rejected_qty)::int AS total_rej
        FROM public.jw_dc_inward_lines jdil
        WHERE jdil.jw_dc_inward_id = jdi.id AND jdil.deleted_at IS NULL
      ) agg ON true
      WHERE jdi.company_id = ${companyId}::uuid
        AND jdi.deleted_at IS NULL
        ${searchFrag}
        ${outFrag}
      ORDER BY jdi.inward_date DESC, jdi.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(jwDcInward.companyId, companyId), isNull(jwDcInward.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(jwDcInward)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(
      (r): JwDcInwardListItem => ({
        id: r['id'] as string,
        companyId: r['companyId'] as string,
        code: r['code'] as string,
        inwardDate: dateLike(r['inwardDate']),
        jwDcOutwardId: r['jwDcOutwardId'] as string,
        dcCodeText: (r['dcCodeText'] as string | null) ?? null,
        vendorChallanNo: (r['vendorChallanNo'] as string | null) ?? null,
        vehicleNo: (r['vehicleNo'] as string | null) ?? null,
        remarks: (r['remarks'] as string | null) ?? null,
        createdAt: tsLike(r['createdAt']),
        createdBy: r['createdBy'] as string,
        updatedAt: tsLike(r['updatedAt']),
        updatedBy: r['updatedBy'] as string,
        deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
        vendorNameText: (r['vendorNameText'] as string | null) ?? null,
        totalReceivedQty: Number(r['totalReceivedQty'] ?? 0),
        totalOkQty: Number(r['totalOkQty'] ?? 0),
        totalRejectedQty: Number(r['totalRejectedQty'] ?? 0),
      }),
    );
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

// ─── Inward — create ─────────────────────────────────────────────────────

export async function createJwDcInward(
  input: CreateJwDcInwardInput,
  user: AuthContext,
): Promise<JwDcInward> {
  const companyId = requireCompany(user);
  const userId = user.id;
  if (input.lines.length === 0) {
    throw new ValidationError('At least one line is required');
  }

  return withUserContext(user, async (tx) => {
    // 1) Load outward DC
    const outRows = await tx
      .select()
      .from(jwDcOutward)
      .where(
        and(
          eq(jwDcOutward.id, input.jwDcOutwardId),
          eq(jwDcOutward.companyId, companyId),
          isNull(jwDcOutward.deletedAt),
        ),
      )
      .limit(1);
    const out = outRows[0];
    if (!out) throw new NotFoundError(`JW DC Outward ${input.jwDcOutwardId} not found`);

    // 2) Load outward lines being received against
    const outLineIds = Array.from(new Set(input.lines.map((l) => l.jwDcOutwardLineId)));
    const outLineRows = await tx
      .select()
      .from(jwDcOutwardLines)
      .where(
        and(
          eq(jwDcOutwardLines.jwDcOutwardId, out.id),
          isNull(jwDcOutwardLines.deletedAt),
        ),
      );
    const olById = new Map(outLineRows.map((p) => [p.id, p]));
    for (const id of outLineIds) {
      if (!olById.has(id)) {
        throw new NotFoundError(`Outward line ${id} not found on DC ${out.code}`);
      }
    }

    // 3) Per-outward-line: returned-so-far + pending bound
    const returnedSoFar = (await tx.execute(sql`
      SELECT
        jdil.jw_dc_outward_line_id AS line_id,
        SUM(jdil.received_qty)::int AS total_returned
      FROM public.jw_dc_inward_lines jdil
      WHERE jdil.deleted_at IS NULL
        AND jdil.jw_dc_outward_line_id = ANY(${outLineIds}::uuid[])
      GROUP BY jdil.jw_dc_outward_line_id
    `)) as unknown as Array<{ line_id: string; total_returned: number }>;
    const returnedMap = new Map(returnedSoFar.map((r) => [r.line_id, Number(r.total_returned)]));

    for (const ln of input.lines) {
      const ol = olById.get(ln.jwDcOutwardLineId)!;
      const alreadyReturned = returnedMap.get(ol.id) ?? 0;
      const pending = Math.max(0, ol.sentQty - alreadyReturned);
      if (ln.receivedQty > pending) {
        throw new ConflictError(
          `Line ${ol.itemCodeText}: received qty ${ln.receivedQty} exceeds pending ${pending}`,
        );
      }
    }

    // 4) Lock relevant item rows
    const itemIds = Array.from(
      new Set(outLineRows.map((o) => o.itemId).filter(Boolean) as string[]),
    );
    for (const id of itemIds) {
      await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${id}::uuid FOR UPDATE`);
    }

    // 5) Insert header
    const code = await nextInwardCode(tx, companyId);
    const inserted = await tx
      .insert(jwDcInward)
      .values({
        companyId,
        code,
        inwardDate: input.inwardDate,
        jwDcOutwardId: out.id,
        dcCodeText: out.code,
        vendorChallanNo: input.vendorChallanNo ?? null,
        vehicleNo: input.vehicleNo ?? null,
        remarks: input.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const header = inserted[0];
    if (!header) throw new ValidationError('Failed to insert JW DC inward header');

    // 6) Insert lines + restore stock for OK qty
    for (const ln of input.lines) {
      const ol = olById.get(ln.jwDcOutwardLineId)!;
      let storeTxnId: string | null = null;

      if (ln.okQty > 0 && ol.itemId) {
        const balRows = (await tx.execute(sql`
          SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
          FROM public.v_item_stock
          WHERE company_id = ${companyId}::uuid AND item_id = ${ol.itemId}::uuid
        `)) as unknown as Array<{ on_hand: number }>;
        const stockBefore = Number(balRows[0]?.on_hand ?? 0);
        const stockAfter = stockBefore + ln.okQty;
        const stRows = await tx
          .insert(storeTransactions)
          .values({
            companyId,
            txnDate: input.inwardDate,
            itemId: ol.itemId,
            itemCodeText: ol.itemCodeText,
            txnType: 'in',
            qty: ln.okQty,
            sourceType: 'jw_in',
            sourceRef: `${code} · ${ol.itemCodeText}`,
            stockBefore,
            stockAfter,
            remarks: `JW DC Inward · returned from ${out.vendorNameText ?? out.vendorCodeText ?? ''} (${ol.processText ?? ''})`.trim(),
            createdBy: userId,
          })
          .returning({ id: storeTransactions.id });
        storeTxnId = stRows[0]?.id ?? null;
      }

      await tx.insert(jwDcInwardLines).values({
        companyId,
        jwDcInwardId: header.id,
        jwDcOutwardLineId: ol.id,
        itemId: ol.itemId ?? null,
        itemCodeText: ol.itemCodeText,
        itemNameText: ol.itemNameText,
        processText: ol.processText,
        sentQty: ol.sentQty,
        receivedQty: ln.receivedQty,
        okQty: ln.okQty,
        rejectedQty: ln.rejectedQty,
        remarks: ln.remarks ?? null,
        storeTransactionId: storeTxnId,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    return {
      id: header.id,
      companyId: header.companyId,
      code: header.code,
      inwardDate: dateLike(header.inwardDate),
      jwDcOutwardId: header.jwDcOutwardId,
      dcCodeText: header.dcCodeText,
      vendorChallanNo: header.vendorChallanNo,
      vehicleNo: header.vehicleNo,
      remarks: header.remarks,
      createdAt: tsLike(header.createdAt),
      createdBy: header.createdBy,
      updatedAt: tsLike(header.updatedAt),
      updatedBy: header.updatedBy,
      deletedAt: header.deletedAt != null ? tsLike(header.deletedAt) : null,
    };
  });
}
