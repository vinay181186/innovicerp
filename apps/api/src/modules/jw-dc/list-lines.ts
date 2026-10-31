// ADR-261 — JW DC Outward / Inward Registers, ONE ROW PER LINE.
//
// New endpoints beside the document lists (which pickers still use, unchanged):
//   GET /jw-dc/outward/lines   GET /jw-dc/inward/lines
// Same query params and envelope as listJwDcOutward / listJwDcInward, same
// company scope (withUserContext + company_id), same Cancelled rule (ADR-235:
// live lines, plus — with includeCancelled — the lines cancelled with a
// Cancelled document). Paged on LINES.
//
// The order behind a line uses the very chain the outward detail reads:
//   DC line → purchase_order_lines → source_so_line_id (else the Job Card's
//   SO line) → sales_order_lines → sales_orders, or → source_jc_op_id → jc_ops
//   → job_cards → source_jw_line_id → job_work_order_lines → job_work_orders.
// Every hop joins on a primary key, so none can multiply the line.

import { type SQL, sql } from 'drizzle-orm';
import type {
  JwDcInwardLineRow,
  JwDcOutwardLineRow,
  ListJwDcInwardLinesResponse,
  ListJwDcInwardQuery,
  ListJwDcOutwardLinesResponse,
  ListJwDcOutwardQuery,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { day, iso, str } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { polSql } from '../../lib/pol';
import { JW_DC_INWARD_LINES_SF_COLUMNS, JW_DC_OUTWARD_LINES_SF_COLUMNS } from './sf-columns';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** The order hops off an outward line (alias jdol). Needs the line joined. */
const ORDER_JOINS_SQL = sql.raw(`
  LEFT JOIN public.items i ON i.id = jdol.item_id AND i.deleted_at IS NULL
  LEFT JOIN public.purchase_order_lines pol
    ON pol.id = jdol.purchase_order_line_id AND pol.deleted_at IS NULL
  LEFT JOIN public.jc_ops jco ON jco.id = pol.source_jc_op_id AND jco.deleted_at IS NULL
  LEFT JOIN public.job_cards jc ON jc.id = jco.job_card_id AND jc.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines jwl
    ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
  LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id AND jwo.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = COALESCE(pol.source_so_line_id, jc.source_so_line_id) AND sol.deleted_at IS NULL
  LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
`);

/** The six lead fields, off the joins above. `lineTs` = the row's created_at. */
function leadSelect(lineTs: SQL, itemCodeText: SQL, itemNameText: SQL): SQL {
  const rev = sql`COALESCE(sol.revision::text, jwl.revision::text)`;
  const code = sql`COALESCE(i.code, ${itemCodeText})`;
  return sql`
    so.code AS "soCode", so.internal_so_no AS "soInternalNo", jwo.code AS "jwCode",
    COALESCE(so.code, jwo.code) AS "orderCode",
    ${polSql('sol', 'jwl')} AS "clientPoLineNo",
    ${lineTs} AS "createdAt",
    (${lineTs} AT TIME ZONE 'Asia/Kolkata')::date AS "createdOn",
    ${code} AS "itemCode",
    ${rev} AS "itemRevision",
    (btrim(${code}) || COALESCE('/' || NULLIF(btrim(${rev}), ''), '')) AS "itemCodeRev",
    COALESCE(i.name, ${itemNameText}) AS "itemName"`;
}

/** Search over the header fields the old register searched + the line's lead. */
function leadSearch(term: string): SQL {
  return sql`
    OR i.code ILIKE ${term} OR jdol.item_code_text ILIKE ${term}
    OR i.name ILIKE ${term} OR jdol.item_name_text ILIKE ${term}
    OR so.code ILIKE ${term} OR so.internal_so_no ILIKE ${term} OR jwo.code ILIKE ${term}
    OR ${polSql('sol', 'jwl')} ILIKE ${term}`;
}

function leadOut(r: Record<string, unknown>) {
  return {
    lineId: String(r['lineId']),
    docId: String(r['docId']),
    docCode: String(r['docCode']),
    docDate: day(r['docDate']),
    cancelReason: str(r['cancelReason']),
    cancelledAt: r['cancelledAt'] != null ? iso(r['cancelledAt']) : null,
    jwpoCodeText: str(r['jwpoCodeText']),
    vendorName: str(r['vendorName']),
    vehicleNo: str(r['vehicleNo']),
    remarks: str(r['remarks']),
    soCode: str(r['soCode']),
    soInternalNo: str(r['soInternalNo']),
    jwCode: str(r['jwCode']),
    clientPoLineNo: str(r['clientPoLineNo']),
    createdAt: iso(r['createdAt']),
    itemCode: str(r['itemCode']),
    itemRevision: str(r['itemRevision']),
    itemName: str(r['itemName']),
    processText: str(r['processText']),
  };
}

// ─── Outward ────────────────────────────────────────────────────────────────

export async function listJwDcOutwardLines(
  input: ListJwDcOutwardQuery,
  user: AuthContext,
): Promise<ListJwDcOutwardLinesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          jdo.code ILIKE ${term}
          OR jdo.jwpo_code_text ILIKE ${term}
          OR jdo.vendor_name_text ILIKE ${term}
          OR jdo.vendor_code_text ILIKE ${term}
          OR v.name ILIKE ${term}
          ${leadSearch(term)}
        )`
      : sql``;
    const vendorFrag = input.vendorId ? sql`AND jdo.vendor_id = ${input.vendorId}::uuid` : sql``;
    const poFrag = input.purchaseOrderId
      ? sql`AND jdo.purchase_order_id = ${input.purchaseOrderId}::uuid`
      : sql``;
    const statusFrag = input.returnStatus
      ? sql`AND z."returnStatus" = ${input.returnStatus}`
      : sql``;
    const sf = readSf(input.sf);
    const outerWhere = sql`TRUE ${statusFrag} ${sfWhere(JW_DC_OUTWARD_LINES_SF_COLUMNS, sf)}`;
    const orderBy = sfOrderBy(
      JW_DC_OUTWARD_LINES_SF_COLUMNS,
      sf,
      sql`z."docDate" DESC, z."docCode" DESC, z."lineNo" ASC, z."lineId"`,
    );
    const headerScope =
      input.includeCancelled === true
        ? sql`(jdo.deleted_at IS NULL OR jdo.cancelled_at IS NOT NULL)`
        : sql`jdo.deleted_at IS NULL`;

    const base = sql`
      SELECT
        jdol.id AS "lineId", jdol.line_no AS "lineNo",
        jdo.id AS "docId", jdo.code AS "docCode", jdo.dc_date AS "docDate",
        jdo.cancel_reason AS "cancelReason", jdo.cancelled_at AS "cancelledAt",
        jdo.jwpo_code_text AS "jwpoCodeText",
        jdo.vendor_id AS "vendorId",
        COALESCE(v.name, jdo.vendor_name_text, jdo.vendor_code_text) AS "vendorName",
        jdo.vehicle_no AS "vehicleNo", jdo.remarks,
        jdol.process_text AS "processText",
        ${leadSelect(sql`COALESCE(jdol.created_at, jdo.created_at)`, sql`jdol.item_code_text`, sql`jdol.item_name_text`)},
        jdol.sent_qty::float8 AS "sentQty",
        COALESCE(ret.returned, 0)::float8 AS "receivedQty",
        -- Same rule as the document register, per line: a Cancelled challan has
        -- nothing at the vendor.
        CASE WHEN jdo.cancelled_at IS NOT NULL THEN 0
             ELSE GREATEST(0, jdol.sent_qty - COALESCE(ret.returned, 0))
        END::float8 AS "pendingQty",
        CASE
          WHEN jdo.cancelled_at IS NOT NULL THEN 'fully_returned'
          WHEN jdol.sent_qty > 0 AND COALESCE(ret.returned, 0) >= jdol.sent_qty THEN 'fully_returned'
          WHEN COALESCE(ret.returned, 0) > 0 THEN 'partial'
          ELSE 'out'
        END AS "returnStatus"
      FROM public.jw_dc_outward_lines jdol
      JOIN public.jw_dc_outward jdo ON jdo.id = jdol.jw_dc_outward_id
      LEFT JOIN public.vendors v ON v.id = jdo.vendor_id AND v.deleted_at IS NULL
      ${ORDER_JOINS_SQL}
      LEFT JOIN LATERAL (
        SELECT SUM(jdil.received_qty)::float8 AS returned
        FROM public.jw_dc_inward_lines jdil
        WHERE jdil.jw_dc_outward_line_id = jdol.id AND jdil.deleted_at IS NULL
      ) ret ON true
      WHERE jdo.company_id = ${companyId}::uuid
        AND jdol.company_id = ${companyId}::uuid
        AND ${headerScope}
        -- A challan's own lines: live ones, or on a Cancelled challan those
        -- cancelled with it (the header's deleted_at stamp).
        AND (jdol.deleted_at IS NULL
             OR (jdo.deleted_at IS NOT NULL AND jdol.deleted_at = jdo.deleted_at))
        ${searchFrag} ${vendorFrag} ${poFrag}
    `;

    const result = (await tx.execute(sql`
      SELECT * FROM (${base}) z
      WHERE ${outerWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM (${base}) z WHERE ${outerWhere}
    `)) as unknown as Array<{ total: number }>;

    const items = result.map(
      (r): JwDcOutwardLineRow => ({
        ...leadOut(r),
        vendorId: str(r['vendorId']),
        sentQty: Number(r['sentQty'] ?? 0),
        receivedQty: Number(r['receivedQty'] ?? 0),
        pendingQty: Number(r['pendingQty'] ?? 0),
        returnStatus: (r['returnStatus'] as JwDcOutwardLineRow['returnStatus']) ?? 'out',
      }),
    );
    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}

// ─── Inward ─────────────────────────────────────────────────────────────────

export async function listJwDcInwardLines(
  input: ListJwDcInwardQuery,
  user: AuthContext,
): Promise<ListJwDcInwardLinesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          jdi.code ILIKE ${term}
          OR jdi.dc_code_text ILIKE ${term}
          OR jdi.vendor_challan_no ILIKE ${term}
          OR jdo.vendor_name_text ILIKE ${term}
          OR jdo.jwpo_code_text ILIKE ${term}
          OR v.name ILIKE ${term}
          ${leadSearch(term)}
        )`
      : sql``;
    const outFrag = input.jwDcOutwardId
      ? sql`AND jdi.jw_dc_outward_id = ${input.jwDcOutwardId}::uuid`
      : sql``;
    const sf = readSf(input.sf);
    const outerWhere = sql`TRUE ${sfWhere(JW_DC_INWARD_LINES_SF_COLUMNS, sf)}`;
    const orderBy = sfOrderBy(
      JW_DC_INWARD_LINES_SF_COLUMNS,
      sf,
      sql`z."docDate" DESC, z."docCode" DESC, z."lineNo" ASC, z."lineId"`,
    );
    const headerScope =
      input.includeCancelled === true
        ? sql`(jdi.deleted_at IS NULL OR jdi.cancelled_at IS NOT NULL)`
        : sql`jdi.deleted_at IS NULL`;

    const base = sql`
      SELECT
        jdil.id AS "lineId", jdol.line_no AS "lineNo",
        jdi.id AS "docId", jdi.code AS "docCode", jdi.inward_date AS "docDate",
        jdi.cancel_reason AS "cancelReason", jdi.cancelled_at AS "cancelledAt",
        jdi.jw_dc_outward_id AS "jwDcOutwardId",
        jdi.dc_code_text AS "dcCodeText",
        jdi.vendor_challan_no AS "vendorChallanNo",
        jdi.vehicle_no AS "vehicleNo", jdi.remarks,
        jdi.goods_receipt_note_id AS "goodsReceiptNoteId",
        g.code AS "grnCode",
        jdo.jwpo_code_text AS "jwpoCodeText",
        COALESCE(v.name, jdo.vendor_name_text) AS "vendorName",
        jdil.process_text AS "processText",
        ${leadSelect(sql`COALESCE(jdil.created_at, jdi.created_at)`, sql`jdil.item_code_text`, sql`jdil.item_name_text`)},
        jdil.received_qty::float8 AS "receivedQty",
        -- From 0172 the receipt is inspected on its GRN: OK / Rejected are that
        -- GRN line's QC figures; older receipts keep their own.
        (CASE WHEN jdi.goods_receipt_note_id IS NULL THEN jdil.ok_qty
              ELSE COALESCE(gq.accepted, 0) END)::float8 AS "okQty",
        (CASE WHEN jdi.goods_receipt_note_id IS NULL THEN jdil.rejected_qty
              ELSE COALESCE(gq.rejected, 0) END)::float8 AS "rejectedQty"
      FROM public.jw_dc_inward_lines jdil
      JOIN public.jw_dc_inward jdi ON jdi.id = jdil.jw_dc_inward_id
      LEFT JOIN public.jw_dc_outward_lines jdol ON jdol.id = jdil.jw_dc_outward_line_id
      LEFT JOIN public.jw_dc_outward jdo ON jdo.id = jdi.jw_dc_outward_id
        AND (jdo.deleted_at IS NULL OR jdo.cancelled_at IS NOT NULL)
      LEFT JOIN public.vendors v ON v.id = jdo.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.goods_receipt_notes g
        ON g.id = jdi.goods_receipt_note_id AND g.deleted_at IS NULL
      ${ORDER_JOINS_SQL}
      -- The GRN line this inward line raised (createJwDcInward writes one GRN
      -- line per inward line, same PO line + received qty; there is no FK).
      LEFT JOIN LATERAL (
        SELECT gl.qc_accepted_qty AS accepted, gl.qc_rejected_qty AS rejected
        FROM public.goods_receipt_note_lines gl
        WHERE gl.goods_receipt_note_id = jdi.goods_receipt_note_id
          AND gl.deleted_at IS NULL
          AND gl.purchase_order_line_id IS NOT DISTINCT FROM jdol.purchase_order_line_id
        ORDER BY (gl.received_qty = jdil.received_qty) DESC, gl.line_no
        LIMIT 1
      ) gq ON true
      WHERE jdi.company_id = ${companyId}::uuid
        AND jdil.company_id = ${companyId}::uuid
        AND ${headerScope}
        AND (jdil.deleted_at IS NULL
             OR (jdi.cancelled_at IS NOT NULL AND jdil.deleted_at = jdi.deleted_at))
        ${searchFrag} ${outFrag}
    `;

    const result = (await tx.execute(sql`
      SELECT * FROM (${base}) z
      WHERE ${outerWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM (${base}) z WHERE ${outerWhere}
    `)) as unknown as Array<{ total: number }>;

    const items = result.map(
      (r): JwDcInwardLineRow => ({
        ...leadOut(r),
        jwDcOutwardId: String(r['jwDcOutwardId']),
        dcCodeText: str(r['dcCodeText']),
        vendorChallanNo: str(r['vendorChallanNo']),
        goodsReceiptNoteId: str(r['goodsReceiptNoteId']),
        grnCode: str(r['grnCode']),
        receivedQty: Number(r['receivedQty'] ?? 0),
        okQty: Number(r['okQty'] ?? 0),
        rejectedQty: Number(r['rejectedQty'] ?? 0),
      }),
    );
    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}
