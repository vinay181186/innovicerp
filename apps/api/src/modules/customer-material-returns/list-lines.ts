// ADR-261 — the Customer Material Return register as ONE ROW PER RETURN LINE
// (GET /customer-material-returns/lines). The document list
// (listCustomerMaterialReturns) is unchanged — other screens read it.
//
// Same guard (party_create view), same company scope + RLS context, same query
// params and envelope as the document list. One row per live line of a live
// return; paged on LINES. The lead block is the JWSO line the material belongs
// to: JWSO No. · POL · Created On · Item Code/Rev · Item Name. No money on this
// document.

import { sql } from 'drizzle-orm';
import type {
  CustomerMaterialReturnKind,
  CustomerMaterialReturnLineRow,
  ListCustomerMaterialReturnLinesResponse,
  ListCustomerMaterialReturnsQuery,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { day, iso, str } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { CUSTOMER_MATERIAL_RETURN_LINE_SF_COLUMNS } from './sf-columns';

function toRow(r: Record<string, unknown>): CustomerMaterialReturnLineRow {
  return {
    lineId: String(r['lineId']),
    docId: String(r['docId']),
    docCode: String(r['docCode']),
    docDate: day(r['docDate']),
    docStatus: r['docStatus'] === 'cancelled' ? 'cancelled' : 'issued',
    cancelReason: str(r['cancelReason']),
    remarks: str(r['remarks']),
    clientId: str(r['clientId']),
    clientName: str(r['clientName']),
    vehicleNo: str(r['vehicleNo']),
    jobWorkOrderId: String(r['jobWorkOrderId']),
    jwCode: str(r['jwCode']),
    clientPoLineNo: str(r['clientPoLineNo']),
    createdAt: iso(r['createdAt']),
    itemCode: str(r['itemCode']),
    itemRevision: str(r['itemRevision']),
    itemName: str(r['itemName']),
    kind: r['kind'] as CustomerMaterialReturnKind,
    rmItemCode: str(r['rmItemCode']),
    partyGrnCode: str(r['partyGrnCode']),
    qty: Number(r['qty']),
  };
}

export async function listCustomerMaterialReturnLines(
  input: ListCustomerMaterialReturnsQuery,
  user: AuthContext,
): Promise<ListCustomerMaterialReturnLinesResponse> {
  await requireFormAccess(user, 'party_create', 'view');
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  return withUserContext(user, async (tx) => {
    // Search: the document list's fields (Return No., JWSO No., Customer,
    // Vehicle No.) plus this line's POL, item code and part name. No numbers.
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          r.code ILIKE ${term} ESCAPE '\\'
          OR jw.code ILIKE ${term} ESCAPE '\\'
          OR cl.name ILIKE ${term} ESCAPE '\\'
          OR r.vehicle_no ILIKE ${term} ESCAPE '\\'
          OR jwl.client_po_line_no ILIKE ${term} ESCAPE '\\'
          OR jwl.item_code_text ILIKE ${term} ESCAPE '\\'
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR jwl.part_name ILIKE ${term} ESCAPE '\\'
          OR ri.code ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const jwFrag = input.jobWorkOrderId
      ? sql`AND r.job_work_order_id = ${input.jobWorkOrderId}::uuid`
      : sql``;
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(CUSTOMER_MATERIAL_RETURN_LINE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(
      CUSTOMER_MATERIAL_RETURN_LINE_SF_COLUMNS,
      sf,
      sql`r.return_date DESC, r.code DESC, l.line_no, l.id`,
    );

    // ONE FROM + WHERE for the page and the count, so the pager agrees.
    const fromWhere = sql`
      FROM public.customer_material_return_lines l
      JOIN public.customer_material_returns r
        ON r.id = l.return_id AND r.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw ON jw.id = r.job_work_order_id
      LEFT JOIN public.clients cl ON cl.id = r.client_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = l.jw_line_id
      LEFT JOIN public.items i ON i.id = jwl.item_id
      LEFT JOIN public.party_materials pm ON pm.id = l.party_material_id
      LEFT JOIN public.items ri ON ri.id = pm.item_id
      LEFT JOIN public.party_grn_lines pgl ON pgl.id = l.party_grn_line_id
      LEFT JOIN public.party_grn pg ON pg.id = pgl.party_grn_id
      WHERE l.company_id = ${companyId}::uuid
        AND r.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        ${searchFrag}
        ${jwFrag}
        ${sfFrag}
    `;

    const rows = (await tx.execute(sql`
      SELECT
        l.id AS "lineId", r.id AS "docId", r.code AS "docCode",
        r.return_date AS "docDate", r.status AS "docStatus",
        r.cancel_reason AS "cancelReason", r.remarks,
        r.client_id AS "clientId", cl.name AS "clientName",
        r.vehicle_no AS "vehicleNo",
        r.job_work_order_id AS "jobWorkOrderId", jw.code AS "jwCode",
        jwl.client_po_line_no AS "clientPoLineNo",
        COALESCE(l.created_at, r.created_at) AS "createdAt",
        COALESCE(i.code, jwl.item_code_text) AS "itemCode",
        NULLIF(btrim(jwl.revision::text), '') AS "itemRevision",
        COALESCE(NULLIF(btrim(jwl.part_name), ''), i.name) AS "itemName",
        l.kind,
        COALESCE(ri.code, pm.item_code_text) AS "rmItemCode",
        pg.code AS "partyGrnCode",
        l.qty
      ${fromWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const totals = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n ${fromWhere}
    `)) as unknown as Array<{ n: number }>;

    return {
      items: rows.map(toRow),
      total: Number(totals[0]?.n ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}
