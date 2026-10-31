// ADR-261 — the JWSO Master list, ONE ROW PER JWSO LINE (GET /job-work-orders/lines).
//
// The header list (listJobWorkOrders) stays as it is: the Party GRN / CMR /
// JW Invoice / JW DC pickers and the dashboards read it. This read takes the
// same query params, the same guard (JW_READ_PAIRS) and the same company scope,
// and pages on LINES. Row = the line's lead facts (JWSO No., POL, Created On,
// Item Code/Rev, Item Name) + the JWSO header facts the old list showed.
//
// No money: the old list carried none, so neither does this one (no rate).
// Customer RM per line = the same one read the header list makes
// (customer-rm.ts), keyed by line instead of summed per JWSO.

import { sql } from 'drizzle-orm';
import { customerRmLine } from '@innovic/shared';
import type {
  JobWorkOrderLineListRow,
  ListJobWorkOrderLinesResponse,
  ListJobWorkOrdersQuery,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { jcEffectiveQtySql } from '../../lib/jc-effective-qty';
import { day, iso } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { partyCommittedQtySql } from '../party-grn/service';
import { customerRmByJw } from './customer-rm';
import { JW_READ_PAIRS } from './service';
import { JWSO_LINE_SF_COLUMNS } from './sf-columns';

export async function listJobWorkOrderLines(
  input: ListJobWorkOrdersQuery,
  user: AuthContext,
): Promise<ListJobWorkOrderLinesResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  await requireAnyFormAccess(user, JW_READ_PAIRS);
  return withUserContext(user, async (tx) => {
    // Search: the JWSO header fields the row shows, and THIS line's own fields
    // (not "any line of the JWSO" — the row is the line now). No quantities and
    // no rate, same reasons as the header list.
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (jw.code ILIKE ${term} ESCAPE '\\'
                 OR jw.customer_name ILIKE ${term} ESCAPE '\\'
                 OR jw.client_po_no ILIKE ${term} ESCAPE '\\'
                 OR jw.status::text ILIKE ${term} ESCAPE '\\'
                 OR jw.jw_date::text ILIKE ${term} ESCAPE '\\'
                 OR jw.remarks ILIKE ${term} ESCAPE '\\'
                 OR l.item_code_text ILIKE ${term} ESCAPE '\\'
                 OR i.code ILIKE ${term} ESCAPE '\\'
                 OR ri.code ILIKE ${term} ESCAPE '\\'
                 OR l.part_name ILIKE ${term} ESCAPE '\\'
                 OR l.material ILIKE ${term} ESCAPE '\\'
                 OR l.drawing_no ILIKE ${term} ESCAPE '\\'
                 OR l.client_po_line_no ILIKE ${term} ESCAPE '\\'
                 OR l.revision ILIKE ${term} ESCAPE '\\'
                 OR l.uom::text ILIKE ${term} ESCAPE '\\'
                 OR l.status::text ILIKE ${term} ESCAPE '\\'
                 OR l.due_date::text ILIKE ${term} ESCAPE '\\')`
      : sql``;
    const statusFrag = input.status ? sql`AND jw.status = ${input.status}::so_status` : sql``;
    const clientFrag = input.clientId ? sql`AND jw.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND jw.jw_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND jw.jw_date <= ${input.toDate}::date` : sql``;
    // Same "can still receive customer material" rule as the header list,
    // applied to the line itself.
    const receivableFrag =
      input.receivable === true
        ? sql`AND l.status = 'open' AND l.short_closed_at IS NULL
              AND l.party_material_id IS NOT NULL
              AND l.order_qty > ${partyCommittedQtySql(sql`l.id`)}`
        : sql``;

    const sf = readSf(input.sf);
    const sfFrag = sfWhere(JWSO_LINE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(
      JWSO_LINE_SF_COLUMNS,
      sf,
      sql`jw.code DESC, jw.id DESC, l.line_no ASC, l.id ASC`,
    );

    // FROM + WHERE shared by the page and the count (sf columns read jca).
    const fromWhere = sql`
      FROM public.job_work_order_lines l
      JOIN public.job_work_orders jw
        ON jw.id = l.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = l.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.items ri ON ri.id = l.rm_item_id AND ri.deleted_at IS NULL
      LEFT JOIN (
        SELECT jc.source_jw_line_id AS line_id, SUM(${jcEffectiveQtySql('jc')}) AS jc_qty
        FROM public.job_cards jc
        WHERE jc.company_id = ${companyId}::uuid
          AND jc.deleted_at IS NULL AND jc.source_jw_line_id IS NOT NULL
          -- Rework/repair children re-make pieces the parent JC already covers
          -- (same rule as the header list).
          AND jc.recovery_kind IS NULL
        GROUP BY jc.source_jw_line_id
      ) jca ON jca.line_id = l.id
      WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
        AND jw.company_id = ${companyId}::uuid
        ${searchFrag} ${statusFrag} ${clientFrag} ${fromFrag} ${toFrag} ${receivableFrag} ${sfFrag}`;

    const result = (await tx.execute(sql`
      SELECT
        l.id AS "lineId", jw.id AS "docId", jw.code AS "docCode",
        jw.jw_date AS "docDate", jw.status AS "docStatus",
        jw.cancel_reason AS "cancelReason",
        jw.client_id AS "clientId", jw.customer_name AS "customerName",
        jw.client_po_no AS "clientPoNo",
        l.line_no AS "lineNo", l.client_po_line_no AS "clientPoLineNo",
        COALESCE(l.created_at, jw.created_at) AS "createdAt",
        COALESCE(i.code, l.item_code_text) AS "itemCode",
        NULLIF(btrim(l.revision), '') AS "itemRevision",
        COALESCE(NULLIF(btrim(l.part_name), ''), i.name) AS "itemName",
        l.order_qty::int AS "orderQty",
        COALESCE(jca.jc_qty, 0)::int AS "jcQty",
        COALESCE(l.returned_qty, 0)::int AS "dispatchedQty",
        l.due_date::text AS "dueDate", l.status AS "lineStatus",
        l.short_closed_at AS "lineShortClosedAt"
      ${fromWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    const totalRows = (await tx.execute(
      sql`SELECT COUNT(*)::int AS c ${fromWhere}`,
    )) as unknown as Array<{ c: number }>;
    const total = Number(totalRows[0]?.c ?? 0);

    const rows: JobWorkOrderLineListRow[] = result.map((r) => {
      return {
        lineId: String(r['lineId']),
        docId: String(r['docId']),
        docCode: String(r['docCode']),
        jwCode: String(r['docCode']),
        docDate: day(r['docDate']),
        docStatus: r['docStatus'] as JobWorkOrderLineListRow['docStatus'],
        cancelReason: (r['cancelReason'] as string | null) ?? null,
        clientId: (r['clientId'] as string | null) ?? null,
        customerName: (r['customerName'] as string | null) ?? null,
        clientPoNo: (r['clientPoNo'] as string | null) ?? null,
        lineNo: Number(r['lineNo'] ?? 0),
        clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
        createdAt: iso(r['createdAt']),
        itemCode: (r['itemCode'] as string | null) ?? null,
        itemRevision: (r['itemRevision'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? null,
        orderQty: Number(r['orderQty'] ?? 0),
        jcQty: Number(r['jcQty'] ?? 0),
        dispatchedQty: Number(r['dispatchedQty'] ?? 0),
        dueDate: (r['dueDate'] as string | null) ?? null,
        lineStatus: r['lineStatus'] as JobWorkOrderLineListRow['lineStatus'],
        lineShortClosedAt: r['lineShortClosedAt'] != null ? iso(r['lineShortClosedAt']) : null,
      };
    });

    // OW-143 — Customer RM per line, ONE read for the page's JWSOs.
    if (input.receivable !== true && rows.length > 0) {
      const rmRows = await customerRmByJw(tx, companyId, [...new Set(rows.map((r) => r.docId))]);
      const byLine = new Map(rmRows.map((r) => [r.lineId, r.qty]));
      for (const row of rows) {
        const q = byLine.get(row.lineId);
        if (q) row.customerRm = customerRmLine(q, row.docStatus === 'cancelled');
      }
    }
    return { items: rows, total, limit: input.limit, offset: input.offset };
  });
}
