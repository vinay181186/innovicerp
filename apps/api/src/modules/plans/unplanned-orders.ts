// ─── Needs Planning (PL-3b) ──────────────────────────────────────────────
// Lists open SO lines that don't yet have a non-cancelled plan covering
// their full quantity. Mirrors legacy renderPlanDashboard L10024–10041 when
// flt='unplanned'. SO-side only; JW lines join when JW planning lands.
//
// ADR-201 (2026-10-02): the Needs Planning table shows 25 lines a page. The
// search and Sort & Filter run HERE over every line (one WHERE shared by the
// page and the count), and `total` is that count. Called with no limit it
// still returns every line (older callers).

import type { UnplannedOrdersQuery, UnplannedOrdersResponse } from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import { soLineCoveredRaw } from '../../lib/so-line-coverage';

/** Sort & Filter fields — each reads the `u` CTE column the row shows. */
export const UNPLANNED_SF_COLUMNS: SfColumnMap = {
  soCode: { sql: sql`u.so_code`, type: 'text' },
  // ADR-207 — the office's own SO number is its own column on the Needs
  // Planning sheet, so it sorts and filters on its own. Same CTE, already
  // selected for the search box above.
  soInternalNo: { sql: sql`u.so_internal_no`, type: 'text' },
  lineNo: { sql: sql`u.line_no`, type: 'num' },
  clientPoLineNo: { sql: sql`u.client_po_line_no`, type: 'text' },
  // CODE/REV as the cell prints it (itemCodeWithRev).
  itemCode: {
    sql: sql`(u.item_code || COALESCE('/' || NULLIF(btrim(u.item_revision), ''), ''))`,
    type: 'text',
  },
  partName: { sql: sql`u.part_name`, type: 'text' },
  orderQty: { sql: sql`u.order_qty`, type: 'num' },
  plannedQty: { sql: sql`u.planned_qty`, type: 'num' },
  remainingQty: { sql: sql`u.remaining_qty`, type: 'num' },
  dueDate: { sql: sql`u.due_date`, type: 'date' },
  customerName: { sql: sql`u.customer_name`, type: 'text' },
};

type Row = {
  so_line_id: string;
  so_id: string;
  so_code: string;
  so_internal_no: string | null;
  line_no: number;
  item_code: string | null;
  item_revision: string | null;
  client_po_line_no: string | null;
  part_name: string | null;
  customer_name: string | null;
  due_date: string | null;
  order_qty: number;
  planned_qty: number;
  remaining_qty: number;
};

export async function getUnplannedOrders(
  user: AuthContext,
  query: UnplannedOrdersQuery = {},
): Promise<UnplannedOrdersResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const sf = readSf(query.sf);
  const sfFrag = sfWhere(UNPLANNED_SF_COLUMNS, sf);
  // Earliest due first; SO No. + line + line id make the order unique.
  const orderBy = sfOrderBy(
    UNPLANNED_SF_COLUMNS,
    sf,
    sql`u.due_date ASC NULLS LAST, u.so_code ASC, u.line_no ASC, u.so_line_id ASC`,
  );
  // Search on what the row shows: SO No., POL, CODE/REV, item name, customer.
  const term = query.search?.trim() ?? '';
  const pat = `%${likeEscape(term)}%`;
  const searchFrag: SQL =
    term === ''
      ? sql``
      : sql`AND (u.so_code ILIKE ${pat} ESCAPE '\\'
          OR u.so_internal_no ILIKE ${pat} ESCAPE '\\'
          OR u.client_po_line_no ILIKE ${pat} ESCAPE '\\'
          OR (u.item_code || COALESCE('/' || NULLIF(btrim(u.item_revision), ''), '')) ILIKE ${pat} ESCAPE '\\'
          OR u.part_name ILIKE ${pat} ESCAPE '\\'
          OR u.customer_name ILIKE ${pat} ESCAPE '\\')`;

  return withUserContext(user, async (tx) => {
    const base = sql`
      WITH u AS (
        SELECT
          sol.id            AS so_line_id,
          so.id             AS so_id,
          so.code           AS so_code,
          so.internal_so_no AS so_internal_no,
          sol.line_no       AS line_no,
          sol.item_code_text AS item_code,
          -- The customer's drawing revision typed on this very SO line — every
          -- row here IS an SO line, so it is never items.revision. Cast to text:
          -- a database without migration 0119 still holds the old integer.
          sol.revision::text AS item_revision,
          -- POL — the CUSTOMER's PO line number, never our sol.line_no.
          sol.client_po_line_no AS client_po_line_no,
          sol.part_name     AS part_name,
          -- Live customer name off the client master; the SO's saved name only
          -- when the SO has no client_id.
          COALESCE(cli.name, so.customer_name) AS customer_name,
          sol.due_date      AS due_date,
          sol.order_qty     AS order_qty,
          -- ADR-185 — the one "covered / to plan" rule (lib/so-line-coverage.ts),
          -- the same figures SO Planning states and the KPI tile counts.
          cov.covered       AS planned_qty,
          GREATEST(sol.order_qty - cov.covered, 0)::numeric AS remaining_qty
        FROM public.sales_order_lines sol
        JOIN public.sales_orders so ON so.id = sol.sales_order_id
        LEFT JOIN public.clients cli ON cli.id = so.client_id AND cli.deleted_at IS NULL
        CROSS JOIN LATERAL (SELECT ${sql.raw(soLineCoveredRaw('sol'))} AS covered) cov
        WHERE so.company_id = ${companyId}::uuid
          AND so.status = 'open'
          AND so.deleted_at IS NULL
          AND sol.deleted_at IS NULL
          AND sol.status = 'open'
          AND sol.order_qty > cov.covered
      )`;
    const where = sql`WHERE TRUE ${searchFrag} ${sfFrag}`;
    const paging =
      query.limit === undefined ? sql`` : sql`LIMIT ${query.limit} OFFSET ${query.offset ?? 0}`;

    const [rows, counted] = await Promise.all([
      tx.execute(sql`
        ${base}
        SELECT u.so_line_id, u.so_id, u.so_code, u.so_internal_no, u.line_no, u.item_code, u.item_revision,
               u.client_po_line_no, u.part_name, u.customer_name, u.due_date::text AS due_date,
               u.order_qty, u.planned_qty, u.remaining_qty
        FROM u ${where}
        ORDER BY ${orderBy}
        ${paging}
      `),
      tx.execute(sql`${base} SELECT count(*)::int AS n FROM u ${where}`),
    ]);
    const typed = rows as unknown as Row[];
    const total = Number((counted as unknown as Array<{ n: number }>)[0]?.n ?? 0);

    return {
      generatedAt: new Date().toISOString(),
      total,
      rows: typed.map((r) => ({
        soLineId: r.so_line_id,
        soId: r.so_id,
        soCode: r.so_code,
        soInternalNo: r.so_internal_no,
        lineNo: Number(r.line_no),
        itemCode: r.item_code,
        // Null passed through rather than blanked: a line with no revision
        // shows the bare code instead of a trailing slash.
        itemRevision: r.item_revision,
        clientPoLineNo: r.client_po_line_no,
        partName: r.part_name,
        customerName: r.customer_name,
        dueDate: r.due_date,
        orderQty: Number(r.order_qty),
        plannedQty: Number(r.planned_qty),
        remainingQty: Number(r.remaining_qty),
      })),
    };
  });
}
