// ADR-261 — the GRN list, ONE ROW PER GRN LINE (GET /goods-receipt-notes/lines).
//
// The GRN list screen opens with the six lead columns (SO No. · Internal SO No.
// · POL · Created On · Item Code · Item Name), which only make sense per line.
// GET /goods-receipt-notes (one row per GRN) is left exactly as it was — other
// screens read it.
//
// Same query params, same company scope (withUserContext + company_id) as
// listGoodsReceiptNotes. Paged on LINES. `qcStatus` is read per LINE (the
// ADR-189 waiting rule applied to the row's own line). `summary` stays DOCUMENT
// counts — the same tiles as the per-GRN list, over the GRNs that have at least
// one matching line. No money on this list.
//
// SO / POL / revision: GRN line → its PO line → the SO line it was raised
// against (source_so_line_id), else the job-work line behind the PO line's JC
// op (source_jc_op_id → job card → source_jw_line_id) — the same joins the PO
// detail uses. Each hop is a single-row FK, so no line is multiplied.

import type {
  GoodsReceiptNoteLineListItem,
  GrnQcStatus,
  ListGoodsReceiptNoteLinesResponse,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { day, iso, str } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import { polSql } from '../../lib/pol';
import type { ListGoodsReceiptNotesQuery } from './schema';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

const ITEM_CODE = sql`COALESCE(i.code, gl.item_code_text)`;
const REVISION = sql`COALESCE(sol.revision::text, rev_jwl.revision::text)`;
/** ADR-189 — this line still waits for QC. */
const WAITING = sql`(gl.received_qty - gl.qc_accepted_qty - gl.qc_rejected_qty) > 0`;

/** Sort & Filter fields of the line list. The old per-GRN names (grnCode,
 *  totalReceivedQty…) are kept so a saved ▾ filter still reads; on this list
 *  the quantities are the LINE's own. */
export const GRN_LINE_SF_COLUMNS: SfColumnMap = {
  soCode: { sql: sql`COALESCE(so.code, jwo.code)`, type: 'text' },
  soInternalNo: { sql: sql`so.internal_so_no`, type: 'text' },
  clientPoLineNo: { sql: polSql('sol', 'rev_jwl'), type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(gl.created_at, grn.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  itemCode: {
    sql: sql`(btrim(${ITEM_CODE}) || COALESCE('/' || NULLIF(btrim(${REVISION}), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`COALESCE(gl.item_name, i.name)`, type: 'text' },
  grnCode: { sql: sql`grn.code`, type: 'text' },
  grnDate: { sql: sql`grn.grn_date`, type: 'date' },
  vendorName: { sql: sql`COALESCE(v.name, grn.vendor_code_text)`, type: 'text' },
  // Same rule as GRN_SF_COLUMNS.poNcCode (an NC return shows its NC code).
  poNcCode: {
    sql: sql`(CASE WHEN grn.nc_id IS NOT NULL
              THEN COALESCE(nc.code, grn.po_code_text)
              ELSE COALESCE(po.code, grn.po_code_text) END)`,
    type: 'text',
  },
  totalReceivedQty: { sql: sql`gl.received_qty::float8`, type: 'num' },
  totalQcAcceptedQty: { sql: sql`gl.qc_accepted_qty::float8`, type: 'num' },
  totalQcRejectedQty: { sql: sql`gl.qc_rejected_qty::float8`, type: 'num' },
};

export async function listGoodsReceiptNoteLines(
  input: Omit<ListGoodsReceiptNotesQuery, 'includeCancelled'> & { includeCancelled?: boolean },
  user: AuthContext,
): Promise<ListGoodsReceiptNoteLinesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Search: the GRN header fields the old list matched, plus THIS line's
    // item, its SO / JWSO number and POL. Never a quantity.
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          grn.code ILIKE ${term} ESCAPE '\\'
          OR grn.po_code_text ILIKE ${term} ESCAPE '\\'
          OR nc.code ILIKE ${term} ESCAPE '\\'
          OR po.code ILIKE ${term} ESCAPE '\\'
          OR v.name ILIKE ${term} ESCAPE '\\'
          OR grn.vendor_code_text ILIKE ${term} ESCAPE '\\'
          OR grn.grn_date::text ILIKE ${term} ESCAPE '\\'
          OR grn.dc_no ILIKE ${term} ESCAPE '\\'
          OR grn.invoice_no ILIKE ${term} ESCAPE '\\'
          OR gl.item_code_text ILIKE ${term} ESCAPE '\\'
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR gl.item_name ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
          OR so.code ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR jwo.code ILIKE ${term} ESCAPE '\\'
          OR ${polSql('sol', 'rev_jwl')} ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const vendorFrag = input.vendorId ? sql`AND grn.vendor_id = ${input.vendorId}::uuid` : sql``;
    const poFrag = input.purchaseOrderId
      ? sql`AND grn.purchase_order_id = ${input.purchaseOrderId}::uuid`
      : sql``;
    // Per LINE; a Cancelled GRN waits for nothing, so every QC filter keeps
    // live lines only (as the per-GRN filter does).
    const qcStatusFrag =
      input.qcStatus === 'pending'
        ? sql`AND grn.deleted_at IS NULL AND ${WAITING}`
        : input.qcStatus === 'in_progress'
          ? sql`AND grn.deleted_at IS NULL AND ${WAITING}
              AND (gl.qc_accepted_qty + gl.qc_rejected_qty) > 0`
          : input.qcStatus === 'completed'
            ? sql`AND grn.deleted_at IS NULL AND NOT ${WAITING}`
            : sql``;
    const fromFrag = input.fromDate ? sql`AND grn.grn_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND grn.grn_date <= ${input.toDate}::date` : sql``;
    // ADR-235 — includeCancelled adds a Cancelled GRN with the lines cancelled
    // WITH it (same deleted_at as the header), exactly as the per-GRN list.
    const scopeFrag =
      input.includeCancelled === true
        ? sql`((grn.deleted_at IS NULL AND gl.deleted_at IS NULL)
             OR (grn.cancelled_at IS NOT NULL AND gl.deleted_at = grn.deleted_at))`
        : sql`(grn.deleted_at IS NULL AND gl.deleted_at IS NULL)`;

    const sf = readSf(input.sf);
    const sfFrag = sfWhere(GRN_LINE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(
      GRN_LINE_SF_COLUMNS,
      sf,
      sql`grn.grn_date DESC, grn.code DESC, gl.line_no ASC, gl.id`,
    );

    const from = sql`
      FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes grn ON grn.id = gl.goods_receipt_note_id
      LEFT JOIN public.vendors v ON v.id = grn.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = grn.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.nc_register nc ON nc.id = grn.nc_id AND nc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = gl.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = gl.purchase_order_line_id AND pol.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = pol.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.jc_ops rev_op
        ON rev_op.id = pol.source_jc_op_id AND rev_op.deleted_at IS NULL
      LEFT JOIN public.job_cards rev_jc
        ON rev_jc.id = rev_op.job_card_id AND rev_jc.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines rev_jwl
        ON rev_jwl.id = rev_jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jwo
        ON jwo.id = rev_jwl.job_work_order_id AND jwo.deleted_at IS NULL
      WHERE gl.company_id = ${companyId}::uuid
        AND grn.company_id = ${companyId}::uuid
        AND ${scopeFrag}
        ${searchFrag}
        ${vendorFrag}
        ${poFrag}
        ${qcStatusFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}`;

    const rows = (await tx.execute(sql`
      SELECT
        gl.id AS "lineId", gl.line_no AS "lineNo",
        grn.id AS "docId", grn.code AS "docCode", grn.grn_date AS "docDate",
        grn.vendor_id AS "vendorId", v.name AS "vendorName",
        grn.vendor_code_text AS "vendorCodeText",
        grn.purchase_order_id AS "purchaseOrderId",
        grn.delivery_challan_id AS "deliveryChallanId",
        grn.nc_id AS "ncId",
        po.code AS "poCode", grn.po_code_text AS "poCodeText", nc.code AS "ncCode",
        grn.dc_no AS "dcNo", grn.invoice_no AS "invoiceNo",
        grn.cancelled_at AS "cancelledAt",
        (SELECT COUNT(*)::int FROM public.goods_receipt_note_lines wl
          WHERE wl.goods_receipt_note_id = grn.id AND wl.deleted_at IS NULL
            AND grn.deleted_at IS NULL
            AND wl.received_qty - wl.qc_accepted_qty - wl.qc_rejected_qty > 0
        ) AS "docQcPendingCount",
        COALESCE(so.code, jwo.code) AS "soCode",
        so.internal_so_no AS "soInternalNo",
        jwo.code AS "jwCode",
        ${polSql('sol', 'rev_jwl')} AS "clientPoLineNo",
        COALESCE(gl.created_at, grn.created_at) AS "createdAt",
        ${ITEM_CODE} AS "itemCode",
        ${REVISION} AS "itemRevision",
        COALESCE(gl.item_name, i.name) AS "itemName",
        gl.received_qty::float8 AS "receivedQty",
        gl.qc_accepted_qty::float8 AS "qcAcceptedQty",
        gl.qc_rejected_qty::float8 AS "qcRejectedQty",
        CASE
          WHEN NOT ${WAITING} THEN 'completed'
          WHEN (gl.qc_accepted_qty + gl.qc_rejected_qty) > 0 THEN 'in_progress'
          ELSE 'pending'
        END AS "lineQcStatus"
      ${from}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    // Pager total = matching LINES; the tiles = the per-GRN list's document
    // counts (same rules), over the GRNs those lines belong to.
    const [sumRow = {}] = (await tx.execute(sql`
      WITH m AS (SELECT grn.id AS grn_id ${from})
      SELECT
        (SELECT COUNT(*)::int FROM m) AS total_rows,
        COUNT(*) FILTER (WHERE grn.deleted_at IS NULL)::int AS total,
        COUNT(*) FILTER (WHERE grn.deleted_at IS NULL AND per_grn.has_pending)::int AS qc_pending,
        COUNT(*) FILTER (
          WHERE grn.deleted_at IS NULL AND NOT per_grn.has_pending AND per_grn.line_count > 0
        )::int AS qc_cleared,
        COUNT(*) FILTER (
          WHERE grn.deleted_at IS NULL
            AND grn.grn_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        )::int AS today
      FROM public.goods_receipt_notes grn
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS line_count,
               COALESCE(BOOL_OR(received_qty - qc_accepted_qty - qc_rejected_qty > 0), false)
                 AS has_pending
        FROM public.goods_receipt_note_lines gnl
        WHERE gnl.goods_receipt_note_id = grn.id AND gnl.deleted_at IS NULL
      ) per_grn ON TRUE
      WHERE grn.id IN (SELECT grn_id FROM m)
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      items: rows.map(toLineItem),
      total: Number(sumRow['total_rows'] ?? 0),
      limit: input.limit,
      offset: input.offset,
      summary: {
        total: Number(sumRow['total'] ?? 0),
        qcPending: Number(sumRow['qc_pending'] ?? 0),
        qcCleared: Number(sumRow['qc_cleared'] ?? 0),
        today: Number(sumRow['today'] ?? 0),
      },
    };
  });
}

function toLineItem(r: Record<string, unknown>): GoodsReceiptNoteLineListItem {
  return {
    lineId: r['lineId'] as string,
    lineNo: Number(r['lineNo'] ?? 0),
    docId: r['docId'] as string,
    docCode: r['docCode'] as string,
    docDate: day(r['docDate']),
    vendorId: str(r['vendorId']),
    vendorName: str(r['vendorName']),
    vendorCodeText: str(r['vendorCodeText']),
    purchaseOrderId: str(r['purchaseOrderId']),
    deliveryChallanId: str(r['deliveryChallanId']),
    ncId: str(r['ncId']),
    poCode: str(r['poCode']),
    poCodeText: str(r['poCodeText']),
    ncCode: str(r['ncCode']),
    dcNo: str(r['dcNo']),
    invoiceNo: str(r['invoiceNo']),
    cancelledAt: r['cancelledAt'] == null ? null : iso(r['cancelledAt']),
    docQcPendingCount: Number(r['docQcPendingCount'] ?? 0),
    soCode: str(r['soCode']),
    soInternalNo: str(r['soInternalNo']),
    jwCode: str(r['jwCode']),
    clientPoLineNo: str(r['clientPoLineNo']),
    createdAt: iso(r['createdAt']),
    itemCode: str(r['itemCode']),
    itemRevision: str(r['itemRevision']),
    itemName: str(r['itemName']),
    receivedQty: Number(r['receivedQty'] ?? 0),
    qcAcceptedQty: Number(r['qcAcceptedQty'] ?? 0),
    qcRejectedQty: Number(r['qcRejectedQty'] ?? 0),
    lineQcStatus: r['lineQcStatus'] as GrnQcStatus,
  };
}
