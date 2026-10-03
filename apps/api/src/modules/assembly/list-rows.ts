// Assembly Tracker list (ADR-201) — the Equipment SO rows the list starts from,
// narrowed by the search box and Sort & Filter (ADR-200) on the SERVER and in
// the order the screen asked for. Status (waiting / ready / assembling / done)
// is derived per SO from stock readiness after this query, so the service
// filters, counts and pages on it once every matching row has its status.

import { sql } from 'drizzle-orm';

import type { DbTransaction } from '../../db/with-user-context';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';

/** The list's sortable / filterable fields — each the SAME expression the row shows. */
export const ASSEMBLY_SF_COLUMNS: SfColumnMap = {
  soCode: { sql: sql`so.code`, type: 'text' },
  customerName: { sql: sql`so.customer_name`, type: 'text' },
  bomCode: { sql: sql`bm.bom_no`, type: 'text' },
  dueDate: { sql: sql`agg.due_date`, type: 'date' },
  orderQty: { sql: sql`COALESCE(agg.order_qty, 0)`, type: 'num' },
};

export interface AssemblySoRow {
  soId: string;
  soCode: string;
  /** ADR-207 — the SO's Internal SO No. (live). */
  soInternalNo: string | null;
  customerName: string | null;
  bomMasterId: string | null;
}

export async function loadAssemblySoRows(
  tx: DbTransaction,
  companyId: string,
  input: { search?: string | undefined; sf?: string | undefined },
): Promise<AssemblySoRow[]> {
  const term = input.search ? `%${likeEscape(input.search)}%` : null;
  // SO no., customer, BOM no. and BOM name (the ▸ row) — the row's text.
  const searchFrag = term
    ? sql`AND (so.code ILIKE ${term} ESCAPE '\\' OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
        OR so.customer_name ILIKE ${term} ESCAPE '\\'
        OR bm.bom_no ILIKE ${term} ESCAPE '\\' OR bm.bom_name ILIKE ${term} ESCAPE '\\')`
    : sql``;
  const sf = readSf(input.sf);
  const sfFrag = sfWhere(ASSEMBLY_SF_COLUMNS, sf);
  const orderBy = sfOrderBy(ASSEMBLY_SF_COLUMNS, sf, sql`so.code ASC, so.id ASC`);
  const rows = await tx.execute(sql`
    SELECT so.id AS "soId", so.code AS "soCode", so.internal_so_no AS "soInternalNo",
           so.customer_name AS "customerName",
           so.bom_master_id AS "bomMasterId"
    FROM public.sales_orders so
    LEFT JOIN public.bom_masters bm ON bm.id = so.bom_master_id AND bm.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT SUM(l.order_qty) AS order_qty, MIN(l.due_date) AS due_date
      FROM public.sales_order_lines l
      WHERE l.sales_order_id = so.id AND l.deleted_at IS NULL
    ) agg ON TRUE
    WHERE so.company_id = ${companyId}::uuid
      AND so.deleted_at IS NULL
      AND so.type = 'equipment'
      -- Closed orders have nothing left to assemble (legacy _atBuildAssemblies,
      -- HTML L28675); a cancelled SO still shows.
      AND so.status <> 'closed'
      ${searchFrag}
      ${sfFrag}
    ORDER BY ${orderBy}
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    soId: r['soId'] as string,
    soCode: r['soCode'] as string,
    soInternalNo: (r['soInternalNo'] as string | null) ?? null,
    customerName: (r['customerName'] as string | null) ?? null,
    bomMasterId: (r['bomMasterId'] as string | null) ?? null,
  }));
}
