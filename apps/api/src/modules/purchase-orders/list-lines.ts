// ADR-261 — the Purchase Order list, ONE ROW PER PO LINE (GET /purchase-orders/lines).
//
// The PO list screen opens with the six lead columns (SO No. · Internal SO No. ·
// POL · Created On · Item Code · Item Name), which only make sense per line, so
// the screen reads this endpoint. GET /purchase-orders (one row per PO) is left
// exactly as it was: pickers, dashboards and other screens read it.
//
// Same query params, same company scope (withUserContext + po.company_id), the
// same price gate (canSeeFormPrice 'po_create' — rate / amount nulled and the
// money Sort & Filter fields refused) as listPurchaseOrders. Paged on LINES.
//
// SO / POL / revision come off the SAME joins getPurchaseOrder uses for a line:
// the SO line the PO line was raised against (source_so_line_id), else the
// job-work line behind the JC op it sends out (source_jc_op_id → job card →
// source_jw_line_id). Each hop is a single-row FK, so no line is multiplied.
// GRN Received / Accepted / Pending are the ONE definitions (lib/po-grn-received,
// lib/po-accepted, lib/po-pending) as grouped LEFT JOINs.

import type { ListPurchaseOrderLinesResponse, PurchaseOrderLineListItem } from '@innovic/shared';
import { sql } from 'drizzle-orm';

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { day, iso, str } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import { polSql } from '../../lib/pol';
import { poLineAcceptedGroupedSql } from '../../lib/po-accepted';
import { poLineGrnReceivedGroupedSql } from '../../lib/po-grn-received';
import { poLinePendingSql } from '../../lib/po-pending';
import type { ListPurchaseOrdersQuery } from './schema';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

// The ONE PO-line Pending (lib/po-pending, ADR-184/189): qty − ACCEPTED, 0 once
// the PO is closed / short-closed / cancelled. Row value and Sort & Filter both.
const PENDING = sql`${poLinePendingSql('pol', 'po')}::float8`;
const ITEM_CODE = sql`COALESCE(i.code, pol.item_code_text)`;
const REVISION = sql`COALESCE(sol.revision::text, rev_jwl.revision::text)`;

/** Sort & Filter fields of the line list. Names the old per-PO list used keep
 *  their names (poCode, totalQty, totalAmount…) so a saved ▾ filter still reads. */
export const PO_LINE_SF_COLUMNS: SfColumnMap = {
  soCode: { sql: sql`COALESCE(so.code, jwo.code)`, type: 'text' },
  soInternalNo: { sql: sql`so.internal_so_no`, type: 'text' },
  clientPoLineNo: { sql: polSql('sol', 'rev_jwl'), type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(pol.created_at, po.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  // CODE/REV as the cell prints it (itemCodeWithRev).
  itemCode: {
    sql: sql`(btrim(${ITEM_CODE}) || COALESCE('/' || NULLIF(btrim(${REVISION}), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`COALESCE(pol.item_name, i.name)`, type: 'text' },
  poCode: { sql: sql`po.code`, type: 'text' },
  poDate: { sql: sql`po.po_date`, type: 'date' },
  poType: { sql: sql`po.po_type`, type: 'list' },
  vendorName: { sql: sql`COALESCE(v.name, po.vendor_code_text)`, type: 'text' },
  prCodeText: { sql: sql`COALESCE(spr.code, po.pr_code_text)`, type: 'text' },
  totalQty: { sql: sql`pol.qty::float8`, type: 'num' },
  receivedQty: { sql: sql`pol.received_qty::float8`, type: 'num' },
  grnReceivedQty: { sql: sql`COALESCE(grnr.grn_received, 0)::float8`, type: 'num' },
  qcAcceptedQty: { sql: sql`COALESCE(acc.accepted, 0)::float8`, type: 'num' },
  pendingQty: { sql: PENDING, type: 'num' },
  totalAmount: { sql: sql`(pol.qty * pol.rate)::float8`, type: 'num', price: true },
  status: { sql: sql`po.status`, type: 'list' },
};

export async function listPurchaseOrderLines(
  input: ListPurchaseOrdersQuery,
  user: AuthContext,
): Promise<ListPurchaseOrderLinesResponse> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'po_create');
  return withUserContext(user, async (tx) => {
    // Search: the PO header fields the old list matched, plus THIS line's item,
    // its SO / JWSO number and POL. Never a money or quantity column.
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          po.code ILIKE ${term} ESCAPE '\\'
          OR po.pr_code_text ILIKE ${term} ESCAPE '\\'
          OR spr.code ILIKE ${term} ESCAPE '\\'
          OR po.vendor_code_text ILIKE ${term} ESCAPE '\\'
          OR v.name ILIKE ${term} ESCAPE '\\'
          OR v.code ILIKE ${term} ESCAPE '\\'
          OR po.status::text ILIKE ${term} ESCAPE '\\'
          OR po.po_type::text ILIKE ${term} ESCAPE '\\'
          OR po.po_date::text ILIKE ${term} ESCAPE '\\'
          OR pol.item_code_text ILIKE ${term} ESCAPE '\\'
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR pol.item_name ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
          OR so.code ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR jwo.code ILIKE ${term} ESCAPE '\\'
          OR ${polSql('sol', 'rev_jwl')} ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    // Same widening of Open as listPurchaseOrders (ADR-222).
    const statusFrag = input.status
      ? input.status === 'open'
        ? sql`AND po.status IN ('open'::po_status, 'partial'::po_status, 'qc_pending'::po_status)`
        : sql`AND po.status = ${input.status}::po_status`
      : sql``;
    const typeFrag = input.poType ? sql`AND po.po_type = ${input.poType}::po_type` : sql``;
    const vendorFrag = input.vendorId ? sql`AND po.vendor_id = ${input.vendorId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND po.po_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND po.po_date <= ${input.toDate}::date` : sql``;
    // `?jobWorkOrderId=` — per line here: the line's own JC op (or its PR's)
    // reaches a job card sourced from that JWSO.
    const jwFrag = input.jobWorkOrderId
      ? sql`AND po.po_type IN ('job_work', 'service')
          AND EXISTS (
            SELECT 1
            FROM public.jc_ops jop
            JOIN public.job_cards jjc ON jjc.id = jop.job_card_id AND jjc.deleted_at IS NULL
            JOIN public.job_work_order_lines jjwl
              ON jjwl.id = jjc.source_jw_line_id AND jjwl.deleted_at IS NULL
            WHERE jop.id = COALESCE(pol.source_jc_op_id, spr.source_jc_op_id)
              AND jjwl.job_work_order_id = ${input.jobWorkOrderId}::uuid
          )`
      : sql``;

    const sf = readSf(input.sf);
    const sfOpts = { canSeePrice: showMoney };
    const sfFrag = sfWhere(PO_LINE_SF_COLUMNS, sf, sfOpts);
    const orderBy = sfOrderBy(
      PO_LINE_SF_COLUMNS,
      sf,
      sql`po.po_date DESC, po.code DESC, pol.line_no ASC, pol.id`,
      sfOpts,
    );

    const qtyJoins = sql`
      LEFT JOIN ${poLineAcceptedGroupedSql(companyId)} acc ON acc.purchase_order_line_id = pol.id
      LEFT JOIN ${poLineGrnReceivedGroupedSql(companyId)} grnr ON grnr.purchase_order_line_id = pol.id`;
    // The count needs the qty joins only when a ▾ filter may read them.
    const countQtyJoins = sf && sf.filters.length > 0 ? qtyJoins : sql``;

    const from = (extra: typeof qtyJoins) => sql`
      FROM public.purchase_order_lines pol
      JOIN public.purchase_orders po
        ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.vendors v ON v.id = po.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = pol.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.purchase_requests spr
        ON spr.id = pol.source_pr_id AND spr.deleted_at IS NULL
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
      ${extra}
      WHERE pol.company_id = ${companyId}::uuid
        AND po.company_id = ${companyId}::uuid
        AND pol.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${typeFrag}
        ${vendorFrag}
        ${fromFrag}
        ${toFrag}
        ${jwFrag}
        ${sfFrag}`;

    const rows = (await tx.execute(sql`
      SELECT
        pol.id AS "lineId", pol.line_no AS "lineNo",
        po.id AS "docId", po.code AS "docCode", po.po_date AS "docDate",
        po.status AS "docStatus", po.po_type AS "poType",
        po.vendor_id AS "vendorId", v.name AS "vendorName",
        po.vendor_code_text AS "vendorCodeText",
        COALESCE(spr.code, po.pr_code_text) AS "prCodeText",
        COALESCE(so.code, jwo.code) AS "soCode",
        so.internal_so_no AS "soInternalNo",
        jwo.code AS "jwCode",
        ${polSql('sol', 'rev_jwl')} AS "clientPoLineNo",
        COALESCE(pol.created_at, po.created_at) AS "createdAt",
        ${ITEM_CODE} AS "itemCode",
        ${REVISION} AS "itemRevision",
        COALESCE(pol.item_name, i.name) AS "itemName",
        pol.qty::float8 AS "qty",
        COALESCE(grnr.grn_received, 0)::float8 AS "grnReceivedQty",
        COALESCE(acc.accepted, 0)::float8 AS "qcAcceptedQty",
        ${PENDING} AS "pendingQty",
        pol.rate::float8 AS "rate",
        (pol.qty * pol.rate)::float8 AS "amount"
      ${from(qtyJoins)}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total ${from(countQtyJoins)}
    `)) as unknown as Array<Record<string, unknown>>;
    const total = Number(countRows[0]?.['total'] ?? 0);

    const items = rows.map((r) => toLineItem(r, showMoney));
    return { items, total, limit: input.limit, offset: input.offset };
  });
}

function toLineItem(r: Record<string, unknown>, showMoney: boolean): PurchaseOrderLineListItem {
  return {
    lineId: r['lineId'] as string,
    lineNo: Number(r['lineNo'] ?? 0),
    docId: r['docId'] as string,
    docCode: r['docCode'] as string,
    docDate: day(r['docDate']),
    docStatus: r['docStatus'] as PurchaseOrderLineListItem['docStatus'],
    poType: r['poType'] as PurchaseOrderLineListItem['poType'],
    vendorId: str(r['vendorId']),
    vendorName: str(r['vendorName']),
    vendorCodeText: str(r['vendorCodeText']),
    prCodeText: str(r['prCodeText']),
    soCode: str(r['soCode']),
    soInternalNo: str(r['soInternalNo']),
    jwCode: str(r['jwCode']),
    clientPoLineNo: str(r['clientPoLineNo']),
    createdAt: iso(r['createdAt']),
    itemCode: str(r['itemCode']),
    itemRevision: str(r['itemRevision']),
    itemName: str(r['itemName']),
    qty: Number(r['qty'] ?? 0),
    grnReceivedQty: Number(r['grnReceivedQty'] ?? 0),
    qcAcceptedQty: Number(r['qcAcceptedQty'] ?? 0),
    pendingQty: Number(r['pendingQty'] ?? 0),
    rate: showMoney ? Number(r['rate'] ?? 0) : null,
    amount: showMoney ? Number(r['amount'] ?? 0) : null,
  };
}
