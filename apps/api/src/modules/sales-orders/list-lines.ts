// ADR-261 — SO Master, ONE ROW PER SO LINE (GET /sales-orders/lines).
//
// Same query params, company scope, money rule and envelope as listSalesOrders
// (GET /sales-orders, which stays as it is — pickers and other screens use it).
// Each row is the order's full list item (same SELECT, same derived tables, so
// the row ⋯ menu / row click / tint act on the ORDER exactly as before) plus
// the line's own facts for the lead columns (POL, Created On, Item Code/Rev,
// Item Name) and the line's Order / JC / Dispatched qty and Due Date.
// Paged on LINES: one row per live line (not deleted, not cancelled) of a live
// SO. Driven FROM sales_orders LEFT JOIN its live lines, so an SO with no live
// line (an Equipment SO saved with none, or every line deleted / cancelled)
// still lists as ONE row with null line fields.

import type {
  ListSalesOrderLinesResponse,
  ListSalesOrdersQuery,
  SalesOrderLineListItem,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { jcEffectiveQtySql } from '../../lib/jc-effective-qty';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { hideSoHeaderMoney, toListItem } from './service';
import { SO_LINE_SF_COLUMNS } from './sf-columns';

function tsText(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function listSalesOrderLines(
  input: ListSalesOrdersQuery,
  user: AuthContext,
): Promise<ListSalesOrderLinesResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const showMoney = await canSeeFormPrice(user, 'so_create');
  return withUserContext(user, async (tx) => {
    // A line is listed when its ORDER matches (every line of it) or the LINE
    // itself matches (only that line) — so an SO number lists the whole order
    // and an item code lists just the lines carrying it.
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          so.code ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR so.customer_name ILIKE ${term} ESCAPE '\\'
          OR so.client_po_no ILIKE ${term} ESCAPE '\\'
          OR so.remarks ILIKE ${term} ESCAPE '\\'
          OR so.type::text ILIKE ${term} ESCAPE '\\'
          OR replace(so.type::text, '_', ' ') ILIKE ${term} ESCAPE '\\'
          OR so.status::text ILIKE ${term} ESCAPE '\\'
          OR so.bom_status ILIKE ${term} ESCAPE '\\'
          OR so.so_date::text ILIKE ${term} ESCAPE '\\'
          OR cu.full_name ILIKE ${term} ESCAPE '\\'
          OR l.part_name ILIKE ${term} ESCAPE '\\'
          OR l.item_code_text ILIKE ${term} ESCAPE '\\'
          OR it.code ILIKE ${term} ESCAPE '\\'
          OR it.name ILIKE ${term} ESCAPE '\\'
          OR l.client_po_line_no ILIKE ${term} ESCAPE '\\'
          OR l.due_date::text ILIKE ${term} ESCAPE '\\'
          OR l.status::text ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const statusFrag = input.status ? sql`AND so.status = ${input.status}::so_status` : sql``;
    const typeFrag = input.type ? sql`AND so.type = ${input.type}::so_type` : sql``;
    const clientFrag = input.clientId ? sql`AND so.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND so.so_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND so.so_date <= ${input.toDate}::date` : sql``;
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(SO_LINE_SF_COLUMNS, sf);
    // Newest order first (as GET /sales-orders), its lines in line order; the
    // line id closes the order so pages never skip / repeat a line.
    // so.id closes a line-less row (its l.id is null).
    const orderBy = sfOrderBy(
      SO_LINE_SF_COLUMNS,
      sf,
      sql`so.so_date DESC, so.code DESC, so.id DESC, l.line_no ASC, l.id ASC`,
    );

    // The ONE FROM (order LEFT JOIN its live lines) + scope + filter, used by
    // the page AND the count.
    const fromLines = sql`
      FROM public.sales_orders so
      LEFT JOIN public.sales_order_lines l
        ON l.sales_order_id = so.id
        AND l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        AND l.status <> 'cancelled'
      LEFT JOIN public.users cu ON cu.id = so.created_by
      LEFT JOIN public.items it ON it.id = l.item_id AND it.deleted_at IS NULL`;
    const scopeWhere = sql`
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${typeFrag}
        ${clientFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}`;

    // Header columns + aggregates are listSalesOrders' SELECT (same derived
    // tables), so the order part of every row equals its GET /sales-orders row.
    const result = await tx.execute(sql`
      SELECT
        so.id, so.company_id AS "companyId", so.code,
        so.internal_so_no AS "internalSoNo", so.so_date AS "soDate",
        so.client_id AS "clientId", so.customer_name AS "customerName",
        so.client_po_no AS "clientPoNo", so.type, so.status,
        so.gst_percent::text AS "gstPercent",
        so.tax_type AS "taxType", so.place_of_supply AS "placeOfSupply",
        so.bom_master_id AS "bomMasterId", so.bom_status AS "bomStatus",
        so.cost_center AS "costCenter", so.remarks,
        so.created_at AS "createdAt", so.created_by AS "createdBy",
        so.updated_at AS "updatedAt", so.updated_by AS "updatedBy",
        so.deleted_at AS "deletedAt",
        so.cancel_reason AS "cancelReason", so.cancelled_at AS "cancelledAt",
        cu.full_name                          AS "createdByName",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(line_agg.total_qty, 0)::int AS "totalQty",
        COALESCE(line_agg.dispatched_qty, 0)::int AS "dispatchedQty",
        COALESCE(line_agg.short_closed_qty, 0)::int AS "shortClosedQty",
        COALESCE(line_agg.live_count, 0)::int AS "liveLineCount",
        COALESCE(line_agg.any_to_deliver, false) AS "anyToDeliver",
        COALESCE(line_agg.any_to_bill, false)    AS "anyToBill",
        COALESCE(line_agg.all_short_closed, false) AS "allShortClosed",
        line_agg.earliest_due_date::text      AS "earliestDueDate",
        COALESCE(jc_agg.jc_qty, 0)::int       AS "jcQty",
        cpo_file.storage_path                 AS "clientPoFilePath",
        -- The line's own facts.
        l.id AS "lineId", l.line_no AS "lineNo",
        COALESCE(l.created_at, so.created_at) AS "lineCreatedAt",
        COALESCE(it.code, l.item_code_text) AS "itemCode",
        NULLIF(btrim(l.revision::text), '') AS "itemRevision",
        l.part_name AS "itemName",
        l.client_po_line_no AS "clientPoLineNo",
        l.order_qty AS "lineOrderQty",
        COALESCE(ljc.jc_qty, 0)::int AS "lineJcQty",
        l.dispatched_qty AS "lineDispatchedQty",
        l.due_date::text AS "lineDueDate",
        l.status AS "lineStatus",
        l.short_closed_at AS "lineShortClosedAt"
      ${fromLines}
      -- The order's aggregates — the same derived tables as listSalesOrders.
      LEFT JOIN (
        SELECT al.sales_order_id,
               COUNT(*) AS line_count,
               SUM(al.order_qty) AS total_qty,
               SUM(al.dispatched_qty) AS dispatched_qty,
               MIN(al.due_date) AS earliest_due_date,
               SUM(CASE WHEN al.short_closed_at IS NOT NULL
                        THEN GREATEST(al.order_qty - al.dispatched_qty, 0) ELSE 0 END) AS short_closed_qty,
               COUNT(*) FILTER (WHERE al.status <> 'cancelled') AS live_count,
               BOOL_OR(al.status <> 'cancelled' AND al.short_closed_at IS NULL
                       AND al.dispatched_qty < al.order_qty) AS any_to_deliver,
               BOOL_OR(al.status <> 'cancelled'
                       AND COALESCE(b.billed, 0) < al.dispatched_qty) AS any_to_bill,
               BOOL_AND(al.short_closed_at IS NOT NULL)
                 FILTER (WHERE al.status <> 'cancelled') AS all_short_closed
        FROM public.sales_order_lines al
        LEFT JOIN (
          SELECT il.sales_order_line_id, SUM(il.qty) AS billed
          FROM public.invoice_lines il
          JOIN public.invoices inv ON inv.id = il.invoice_id AND inv.deleted_at IS NULL
            AND inv.status <> 'cancelled'
          WHERE il.company_id = ${companyId}::uuid
            AND il.deleted_at IS NULL
            AND il.sales_order_line_id IS NOT NULL
          GROUP BY il.sales_order_line_id
        ) b ON b.sales_order_line_id = al.id
        WHERE al.deleted_at IS NULL
          AND al.company_id = ${companyId}::uuid
        GROUP BY al.sales_order_id
      ) line_agg ON line_agg.sales_order_id = so.id
      LEFT JOIN (
        SELECT sol.sales_order_id, SUM(${jcEffectiveQtySql('jc')}) AS jc_qty
        FROM public.job_cards jc
        JOIN public.sales_order_lines sol ON jc.source_so_line_id = sol.id
        WHERE jc.deleted_at IS NULL
          AND jc.recovery_kind IS NULL
        GROUP BY sol.sales_order_id
      ) jc_agg ON jc_agg.sales_order_id = so.id
      -- THIS line's job-card qty (same rule: live cards, no rework children).
      LEFT JOIN LATERAL (
        SELECT SUM(${jcEffectiveQtySql('ljc_c')}) AS jc_qty
        FROM public.job_cards ljc_c
        WHERE ljc_c.source_so_line_id = l.id
          AND ljc_c.deleted_at IS NULL
          AND ljc_c.recovery_kind IS NULL
      ) ljc ON true
      LEFT JOIN LATERAL (
        SELECT fr.storage_path
        FROM public.file_registry fr
        WHERE fr.sales_order_id = so.id
          AND fr.category = 'client_po'
          AND fr.status = 'active'
          AND fr.deleted_at IS NULL
        ORDER BY fr.created_at DESC
        LIMIT 1
      ) cpo_file ON true
      ${scopeWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total = the same FROM + WHERE without the aggregate joins.
    const totalRows = await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      ${fromLines}
      ${scopeWhere}
    `);
    const total = Number(
      (totalRows as unknown as Array<Record<string, unknown>>)[0]?.['total'] ?? 0,
    );

    const items = (result as unknown as Array<Record<string, unknown>>).map((r) => {
      const head = toListItem(r);
      return {
        ...(showMoney ? head : hideSoHeaderMoney(head)),
        lineId: (r['lineId'] as string | null) ?? null,
        lineNo: r['lineNo'] != null ? Number(r['lineNo']) : null,
        lineCreatedAt: tsText(r['lineCreatedAt']),
        itemCode: (r['itemCode'] as string | null) ?? null,
        itemRevision: (r['itemRevision'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? '',
        clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
        lineOrderQty: Number(r['lineOrderQty'] ?? 0),
        lineJcQty: Number(r['lineJcQty'] ?? 0),
        lineDispatchedQty: Number(r['lineDispatchedQty'] ?? 0),
        lineDueDate: (r['lineDueDate'] as string | null) ?? null,
        lineStatus: (r['lineStatus'] ?? null) as SalesOrderLineListItem['lineStatus'],
        lineShortClosedAt: r['lineShortClosedAt'] != null ? tsText(r['lineShortClosedAt']) : null,
      };
    });
    return { items, total, limit: input.limit, offset: input.offset };
  });
}
