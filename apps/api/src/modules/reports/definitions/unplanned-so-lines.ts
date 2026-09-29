// Unplanned SO / JWSO lines — open Sales Order and Job Work Sales Order lines
// that still have qty To Plan, oldest Due Date first. Covered / To Plan use
// the ADR-185 one rule (lib/so-line-coverage.ts) so this agrees with Planning.
// Modelled on ERPNext's "Pending SO Items For Purchase Request" / Production Planning pending items.

import { sql } from 'drizzle-orm';
import { soLineCoveredRaw } from '../../../lib/so-line-coverage';
import type { RegisteredReport } from '../registry';
import { dateCell, likeFilter, numCell, type SqlRow, textCell } from './report-helpers';

// ADR-185 — a JWSO line's Covered, the SQL twin of the JW branch of
// so-planning/service.ts (getPlanningJwDetail steps 3 + 6): live,
// non-cancelled plans on the line + DIRECT Job Cards for the line's own item
// (no Production Order, not a plan's card). lib/so-line-coverage.ts has no JW
// twin, so this mirrors that TypeScript exactly (it does not skip rework
// children, and neither does this).
const JW_LINE_COVERED_SQL = sql.raw(`(
  COALESCE((SELECT SUM(p_c.plan_qty) FROM public.plans p_c
            WHERE p_c.jw_line_id = jwl.id AND p_c.deleted_at IS NULL
              AND p_c.plan_status <> 'cancelled'), 0)
  + COALESCE((SELECT SUM(jc_c.order_qty) FROM public.job_cards jc_c
              WHERE jc_c.source_jw_line_id = jwl.id AND jc_c.deleted_at IS NULL
                AND jc_c.item_id IS NOT DISTINCT FROM jwl.item_id
                AND jc_c.production_order_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.plans pj_c
                                WHERE pj_c.jc_id = jc_c.id AND pj_c.deleted_at IS NULL
                                  AND pj_c.plan_status <> 'cancelled')), 0)
)::int`);

export const unplannedSoLinesReport: RegisteredReport = {
  definition: {
    slug: 'unplanned-so-lines',
    title: 'Unplanned SO / JWSO lines',
    description:
      'Open SO and JWSO lines with qty still To Plan (Order Qty minus Covered by plans, Buy-item PRs and direct Job Cards — the same rule as the Planning screen). Sorted by Due Date.',
    group: 'Planning',
    dept: 'planning',
    filters: [{ key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' }],
    columns: [
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'order_code', label: 'SO / JWSO', type: 'text' },
      { key: 'order_date', label: 'Order Date', type: 'date' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'order_qty', label: 'Order Qty', type: 'number' },
      { key: 'covered_qty', label: 'Covered', type: 'number' },
      { key: 'to_plan_qty', label: 'To Plan', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'days_since_order', label: 'Days Since Order', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const customer = likeFilter(filters['customer']);
    const soCustomerFrag = customer
      ? sql`AND COALESCE(cl.name, so.customer_name, '') ILIKE ${customer}`
      : sql``;
    const jwCustomerFrag = customer
      ? sql`AND COALESCE(cl.name, jwo.customer_name, '') ILIKE ${customer}`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        u.source, u.order_code, u.order_date, u.client_name, u.client_po_line_no,
        u.item_code, u.item_revision, u.order_qty, u.covered_qty, u.to_plan_qty,
        u.due_date, u.days_since_order
      FROM (
        SELECT
          'SO'                                        AS source,
          so.code                                     AS order_code,
          so.so_date::text                                  AS order_date,
          COALESCE(cl.name, so.customer_name, '—')    AS client_name,
          sol.client_po_line_no                       AS client_po_line_no,
          COALESCE(it.code, sol.item_code_text)  AS item_code,
          sol.revision::text                          AS item_revision,
          sol.order_qty                               AS order_qty,
          cov.covered                                 AS covered_qty,
          GREATEST(sol.order_qty - cov.covered, 0)    AS to_plan_qty,
          sol.due_date::text                                AS due_date,
          (CURRENT_DATE - so.so_date)                 AS days_since_order,
          sol.line_no                                 AS line_no
        FROM public.sales_order_lines sol
        JOIN public.sales_orders so
          ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
        LEFT JOIN public.items it
          ON it.id = sol.item_id AND it.deleted_at IS NULL
        LEFT JOIN public.clients cl
          ON cl.id = so.client_id AND cl.deleted_at IS NULL
        CROSS JOIN LATERAL (SELECT ${sql.raw(soLineCoveredRaw('sol'))} AS covered) cov
        WHERE sol.company_id = ${companyId}::uuid
          AND sol.deleted_at IS NULL
          AND so.status = 'open'
          AND sol.status = 'open'
          AND sol.order_qty > cov.covered
          ${soCustomerFrag}

        UNION ALL

        SELECT
          'JWSO'                                      AS source,
          jwo.code                                    AS order_code,
          jwo.jw_date::text                                 AS order_date,
          COALESCE(cl.name, jwo.customer_name, '—')   AS client_name,
          NULL::text                                  AS client_po_line_no,
          COALESCE(it.code, jwl.item_code_text)  AS item_code,
          jwl.revision::text                          AS item_revision,
          jwl.order_qty                               AS order_qty,
          cov.covered                                 AS covered_qty,
          GREATEST(jwl.order_qty - cov.covered, 0)    AS to_plan_qty,
          jwl.due_date::text                                AS due_date,
          (CURRENT_DATE - jwo.jw_date)                AS days_since_order,
          jwl.line_no                                 AS line_no
        FROM public.job_work_order_lines jwl
        JOIN public.job_work_orders jwo
          ON jwo.id = jwl.job_work_order_id AND jwo.deleted_at IS NULL
        LEFT JOIN public.items it
          ON it.id = jwl.item_id AND it.deleted_at IS NULL
        LEFT JOIN public.clients cl
          ON cl.id = jwo.client_id AND cl.deleted_at IS NULL
        CROSS JOIN LATERAL (SELECT ${JW_LINE_COVERED_SQL} AS covered) cov
        WHERE jwl.company_id = ${companyId}::uuid
          AND jwl.deleted_at IS NULL
          AND jwo.status = 'open'
          AND jwl.status = 'open'
          AND jwl.order_qty > cov.covered
          ${jwCustomerFrag}
      ) u
      ORDER BY u.due_date ASC NULLS LAST, u.order_code, u.line_no
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      source: String(r['source'] ?? ''),
      order_code: String(r['order_code'] ?? ''),
      order_date: dateCell(r['order_date']),
      client_name: String(r['client_name'] ?? ''),
      client_po_line_no: textCell(r['client_po_line_no']),
      item_code: String(r['item_code'] ?? '—'),
      item_revision: textCell(r['item_revision']),
      order_qty: numCell(r['order_qty']),
      covered_qty: numCell(r['covered_qty']),
      to_plan_qty: numCell(r['to_plan_qty']),
      due_date: dateCell(r['due_date']),
      days_since_order: numCell(r['days_since_order']),
    }));

    return { columns: unplannedSoLinesReport.definition.columns, rows };
  },
};
