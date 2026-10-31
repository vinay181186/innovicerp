// ADR-261 — OSP Outward DC list, ONE ROW PER DC LINE (GET /delivery-challans/lines).
//
// The existing GET /delivery-challans (one row per DC) stays as it is — the GRN
// forms pick DCs from it. This read pages on LINES: every live line of a live DC
// in the user's company, with the six lead facts and the header facts the old
// list showed. Same guard as listDeliveryChallans (company + RLS through
// withUserContext), same query params, same response envelope + summary.
//
// Which order a line belongs to (each hop is a single-row FK, so no join can
// multiply the lines):
//   SO line  = the line's PO line's source_so_line_id, else the DC's own
//              sales_order_line_id, else the job card's source_so_line_id;
//   job card = PO line → JC op → job card, else the DC's own job card (NC return);
//   JWSO line = that job card's source_jw_line_id;
//   no link  → the DC's free-text SO ref (so_ref_text) is shown as the SO No.
// POL is polSql (SO line first, else JWSO line). The drawing revision follows
// the DC detail's same-item rule (DC_LINE_REV_SQL).

import { sql } from 'drizzle-orm';
import type {
  DeliveryChallanListLine,
  ListDeliveryChallanLinesResponse,
  ListDeliveryChallansQuery,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { day, iso, str } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { polSql } from '../../lib/pol';
import { DC_LINE_REV_SQL, DC_LINE_SF_COLUMNS } from './sf-columns';

/** The ONE FROM clause: page, count and summary all read it, so every
 *  DC_LINE_SF_COLUMNS alias is valid in all three. */
const DC_LINE_FROM = sql`
  FROM public.delivery_challan_lines dcl
  JOIN public.delivery_challans dc
    ON dc.id = dcl.delivery_challan_id AND dc.deleted_at IS NULL
  LEFT JOIN public.vendors v ON v.id = dc.vendor_id AND v.deleted_at IS NULL
  LEFT JOIN public.items i ON i.id = dcl.item_id AND i.deleted_at IS NULL
  LEFT JOIN public.purchase_orders po
    ON po.id = dc.purchase_order_id AND po.deleted_at IS NULL
  LEFT JOIN public.nc_register nc ON nc.id = dc.nc_id AND nc.deleted_at IS NULL
  LEFT JOIN public.purchase_order_lines pol
    ON pol.id = dcl.purchase_order_line_id AND pol.deleted_at IS NULL
  LEFT JOIN public.jc_ops ljo ON ljo.id = pol.source_jc_op_id AND ljo.deleted_at IS NULL
  LEFT JOIN public.job_cards ljc
    ON ljc.id = COALESCE(ljo.job_card_id, dc.job_card_id) AND ljc.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = COALESCE(pol.source_so_line_id, dc.sales_order_line_id, ljc.source_so_line_id)
   AND sol.deleted_at IS NULL
  LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines jwl
    ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL
  LEFT JOIN public.job_work_orders jw
    ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
  -- No SO / JWSO link: the SO a free-text so_ref_text names (code is unique per
  -- company) — for its Internal SO No. (ADR-207).
  LEFT JOIN public.sales_orders so_ref
    ON so.id IS NULL AND jw.id IS NULL
   AND so_ref.company_id = dc.company_id AND so_ref.code = dc.so_ref_text
   AND so_ref.deleted_at IS NULL`;

export async function listDeliveryChallanLines(
  input: ListDeliveryChallansQuery,
  user: AuthContext,
): Promise<ListDeliveryChallanLinesResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  return withUserContext(user, async (tx) => {
    // Search: the header fields the DC list searched, plus this line's own
    // lead facts (item code / name, SO / JWSO / Internal SO No., POL). Numbers
    // and money are not searched (same reasons as listDeliveryChallans).
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          dc.code ILIKE ${term} ESCAPE '\\'
          OR v.name ILIKE ${term} ESCAPE '\\'
          OR dc.vendor_code_text ILIKE ${term} ESCAPE '\\'
          OR dc.po_code_text ILIKE ${term} ESCAPE '\\'
          OR po.code ILIKE ${term} ESCAPE '\\'
          OR nc.code ILIKE ${term} ESCAPE '\\'
          OR dc.status::text ILIKE ${term} ESCAPE '\\'
          OR dc.dc_date::text ILIKE ${term} ESCAPE '\\'
          OR dc.transport ILIKE ${term} ESCAPE '\\'
          OR dc.so_ref_text ILIKE ${term} ESCAPE '\\'
          OR so.code ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR so_ref.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR jw.code ILIKE ${term} ESCAPE '\\'
          OR ${polSql('sol', 'jwl')} ILIKE ${term} ESCAPE '\\'
          OR ljc.code ILIKE ${term} ESCAPE '\\'
          OR dcl.item_code_text ILIKE ${term} ESCAPE '\\'
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR dcl.item_name_text ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const statusFrag = input.status ? sql`AND dc.status = ${input.status}::dc_status` : sql``;
    const vendorFrag = input.vendorId ? sql`AND dc.vendor_id = ${input.vendorId}::uuid` : sql``;
    const poFrag = input.purchaseOrderId
      ? sql`AND dc.purchase_order_id = ${input.purchaseOrderId}::uuid`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND dc.dc_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND dc.dc_date <= ${input.toDate}::date` : sql``;
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(DC_LINE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(
      DC_LINE_SF_COLUMNS,
      sf,
      sql`dc.dc_date DESC, dc.code DESC, dcl.line_no ASC, dcl.id ASC`,
    );

    const fromWhere = sql`
      ${DC_LINE_FROM}
      WHERE dcl.company_id = ${companyId}::uuid
        AND dc.company_id = ${companyId}::uuid
        AND dcl.deleted_at IS NULL
        ${searchFrag} ${statusFrag} ${vendorFrag} ${poFrag} ${fromFrag} ${toFrag} ${sfFrag}`;

    const result = await tx.execute(sql`
      SELECT
        dcl.id AS "lineId", dc.id AS "docId", dc.code AS "docCode",
        dc.dc_date AS "docDate", dc.status AS "docStatus", dcl.line_no AS "lineNo",
        dc.vendor_id AS "vendorId", v.name AS "vendorName",
        dc.vendor_code_text AS "vendorCodeText",
        dc.purchase_order_id AS "purchaseOrderId", po.code AS "poCode",
        dc.po_code_text AS "poCodeText",
        dc.nc_id AS "ncId", nc.code AS "ncCode",
        ljc.code AS "jobCardCode", dc.transport,
        COALESCE(so.code, CASE WHEN jw.id IS NULL THEN dc.so_ref_text END) AS "soCode",
        COALESCE(so.internal_so_no, so_ref.internal_so_no) AS "soInternalNo",
        jw.code AS "jwCode",
        ${polSql('sol', 'jwl')} AS "clientPoLineNo",
        COALESCE(dcl.created_at, dc.created_at) AS "createdAt",
        COALESCE(i.code, dcl.item_code_text) AS "itemCode",
        ${DC_LINE_REV_SQL} AS "itemRevision",
        COALESCE(i.name, dcl.item_name_text) AS "itemName",
        dcl.qty::text AS qty, dcl.uom
      ${fromWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Count + the three KPI totals over the SAME filtered lines, one read.
    const aggRows = await tx.execute(sql`
      SELECT COUNT(*)::int AS total,
             COALESCE(SUM(dcl.qty), 0)::float AS total_dispatched,
             COUNT(DISTINCT dcl.item_id)::int AS item_count
      ${fromWhere}
    `);
    const agg = (aggRows as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const total = Number(agg['total'] ?? 0);

    const items = (result as unknown as Array<Record<string, unknown>>).map(
      (r): DeliveryChallanListLine => ({
        lineId: String(r['lineId']),
        docId: String(r['docId']),
        docCode: String(r['docCode']),
        docDate: day(r['docDate']),
        docStatus: r['docStatus'] as DeliveryChallanListLine['docStatus'],
        lineNo: Number(r['lineNo'] ?? 0),
        vendorId: String(r['vendorId']),
        vendorName: str(r['vendorName']),
        vendorCodeText: String(r['vendorCodeText'] ?? ''),
        purchaseOrderId: str(r['purchaseOrderId']),
        poCode: str(r['poCode']),
        poCodeText: String(r['poCodeText'] ?? ''),
        ncId: str(r['ncId']),
        ncCode: str(r['ncCode']),
        jobCardCode: str(r['jobCardCode']),
        transport: str(r['transport']),
        soCode: str(r['soCode']),
        soInternalNo: str(r['soInternalNo']),
        jwCode: str(r['jwCode']),
        clientPoLineNo: str(r['clientPoLineNo']),
        createdAt: iso(r['createdAt']),
        itemCode: str(r['itemCode']),
        itemRevision: str(r['itemRevision']),
        itemName: str(r['itemName']),
        qty: String(r['qty']),
        uom: r['uom'] as DeliveryChallanListLine['uom'],
      }),
    );
    return {
      items,
      total,
      limit: input.limit,
      offset: input.offset,
      summary: {
        totalDispatched: Number(agg['total_dispatched'] ?? 0),
        entryCount: total,
        itemCount: Number(agg['item_count'] ?? 0),
      },
    };
  });
}
