// Pending SO Value service (PL-PSV-1).
//
// GET /pending-so-value?filter=open|all|overdue|completed
// Aggregates per-SO: order value (from sales_order_lines), dispatched value
// (from delivery_challan_lines), invoiced value + received value (from
// invoices). Mirrors legacy renderPendingSOValue (HTML L19272).
//
// Math (per SO):
//   orderValue       = SUM(sol.order_qty * sol.rate) across non-deleted lines
//   dispatchedValue  = SUM(dcl.qty * sol.rate) where dc-line links to SO via
//                      dcl.purchase_order_line_id → pol.source_so_line_id
//                      OR dc.sales_order_line_id directly (DC can be issued
//                      against either path).
//   pendingValue     = orderValue - dispatchedValue
//   invoicedValue    = SUM(inv.grand_total) for non-deleted invoices on this SO
//   receivedValue    = SUM(inv.total_paid)
//   outstandingValue = invoicedValue - receivedValue - SUM(inv.total_tds)  (0171)

import { sql, type SQL } from 'drizzle-orm';
import type {
  PendingSoValueQuery,
  PendingSoValueResponse,
  PendingSoValueRow,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { PSV_SF_COLUMNS } from './sf-columns';
function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

// Money-hiding for L1 Viewers ("Can See Price"). This whole report is money;
// it rides the Sales price permission (so_create).
function hidePsvRowMoney<T extends Record<string, unknown>>(r: T): T {
  return {
    ...r,
    orderValue: null,
    dispatchedValue: null,
    pendingValue: null,
    invoicedValue: null,
    receivedValue: null,
    outstandingValue: null,
  };
}

export async function getPendingSoValue(
  query: PendingSoValueQuery,
  user: AuthContext,
): Promise<PendingSoValueResponse> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'so_create');
  const filter = query.filter;
  // Read (and 400 on a bad value) before any DB work. Money columns can be
  // sorted / filtered only by a user who may see them.
  const sf = readSf(query.sf);
  const sfFrag = sfWhere(PSV_SF_COLUMNS, sf, { canSeePrice: showMoney });
  // Highest value-to-dispatch first; SO No. + id make the order unique so the
  // pages never skip or repeat an SO.
  const orderBy = sfOrderBy(
    PSV_SF_COLUMNS,
    sf,
    sql`psv.pending_value DESC, psv.so_code ASC, psv.so_id ASC`,
    { canSeePrice: showMoney },
  );
  const today = new Date().toISOString().slice(0, 10);

  // The SO Filter, now in SQL (was a JS filter over every row):
  //   open      — SO is open OR value is still to dispatch
  //   overdue   — due date passed AND value still to dispatch
  //   completed — closed / dispatched / cancelled
  const filterFrag: SQL =
    filter === 'open'
      ? sql`AND (psv.status = 'open' OR psv.pending_value > 0)`
      : filter === 'overdue'
        ? sql`AND psv.due_date IS NOT NULL AND psv.due_date < ${today}::date AND psv.pending_value > 0`
        : filter === 'completed'
          ? sql`AND psv.status IN ('closed', 'dispatched', 'cancelled')`
          : sql``;
  const term = query.search?.trim() ?? '';
  const searchFrag: SQL =
    term === ''
      ? sql``
      : sql`AND (psv.so_code ILIKE ${`%${likeEscape(term)}%`} ESCAPE '\\'
              OR psv.internal_so_no ILIKE ${`%${likeEscape(term)}%`} ESCAPE '\\'
              OR psv.customer_name ILIKE ${`%${likeEscape(term)}%`} ESCAPE '\\')`;

  return withUserContext(user, async (tx) => {
    // One aggregating CTE: per-SO sums of order / dispatched / invoiced /
    // received (`psv`), then the page and the totals both read it with the
    // SAME WHERE (filter + search + Sort & Filter).
    //
    // Dispatched value uses the SO-line rate (not the DC line which doesn't
    // carry rate) — multiply dispatched qty by the line's rate.
    const base = sql`
      WITH so_order_value AS (
        SELECT
          sol.sales_order_id AS so_id,
          SUM(sol.order_qty::numeric * sol.rate)::numeric(14, 2) AS order_value,
          MIN(sol.due_date) AS earliest_due_date,
          jsonb_object_agg(sol.id, sol.rate) AS rate_by_line
        FROM public.sales_order_lines sol
        WHERE sol.deleted_at IS NULL
        GROUP BY sol.sales_order_id
      ),
      so_dispatched AS (
        SELECT
          sol.sales_order_id AS so_id,
          COALESCE(SUM(dcl.qty * sol.rate), 0)::numeric(14, 2) AS dispatched_value
        FROM public.sales_order_lines sol
        LEFT JOIN public.delivery_challan_lines dcl
          ON (
            -- DC line linked through PO line → SO line:
            (dcl.purchase_order_line_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.purchase_order_lines pol
                WHERE pol.id = dcl.purchase_order_line_id
                  AND pol.source_so_line_id = sol.id
                  AND pol.deleted_at IS NULL
              ))
            OR
            -- DC linked directly to the SO line:
            EXISTS (
              SELECT 1 FROM public.delivery_challans dc2
              WHERE dc2.id = dcl.delivery_challan_id
                AND dc2.sales_order_line_id = sol.id
                AND dc2.deleted_at IS NULL
            )
          )
          AND dcl.deleted_at IS NULL
        WHERE sol.deleted_at IS NULL
        GROUP BY sol.sales_order_id
      ),
      so_invoiced AS (
        SELECT
          sales_order_id AS so_id,
          COALESCE(SUM(grand_total), 0)::numeric(14, 2) AS invoiced_value,
          COALESCE(SUM(total_paid), 0)::numeric(14, 2)  AS received_value,
          -- TDS / short amount the customer deducted (0171) settles the invoice
          -- too: outstanding = grand − paid − TDS, as the invoices service.
          COALESCE(SUM(total_tds), 0)::numeric(14, 2)   AS tds_value
        FROM public.invoices
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
        GROUP BY sales_order_id
      ),
      psv AS (
        SELECT
          so.id                              AS so_id,
          so.code                            AS so_code,
          so.internal_so_no                  AS internal_so_no,
          so.customer_name                   AS customer_name,
          so.so_date                         AS so_date,
          sov.earliest_due_date              AS due_date,
          so.status::text                    AS status,
          COALESCE(sov.order_value, 0)       AS order_value,
          COALESCE(sd.dispatched_value, 0)   AS dispatched_value,
          (COALESCE(sov.order_value, 0) - COALESCE(sd.dispatched_value, 0)) AS pending_value,
          COALESCE(si.invoiced_value, 0)     AS invoiced_value,
          COALESCE(si.received_value, 0)     AS received_value,
          (COALESCE(si.invoiced_value, 0) - COALESCE(si.received_value, 0)
            - COALESCE(si.tds_value, 0))     AS outstanding_value
        FROM public.sales_orders so
        LEFT JOIN so_order_value sov ON sov.so_id = so.id
        LEFT JOIN so_dispatched   sd  ON sd.so_id  = so.id
        LEFT JOIN so_invoiced     si  ON si.so_id  = so.id
        WHERE so.company_id = ${companyId}::uuid
          AND so.deleted_at IS NULL
      )`;
    const where = sql`WHERE TRUE ${filterFrag} ${searchFrag} ${sfFrag}`;
    const paging =
      query.limit === undefined ? sql`` : sql`LIMIT ${query.limit} OFFSET ${query.offset ?? 0}`;

    const [pageRows, totalsRows] = await Promise.all([
      tx.execute(sql`
        ${base}
        SELECT
          psv.so_id, psv.so_code, psv.internal_so_no, psv.customer_name,
          psv.so_date::text AS so_date, psv.due_date::text AS due_date, psv.status,
          psv.order_value::text AS order_value,
          psv.dispatched_value::text AS dispatched_value,
          psv.pending_value::text AS pending_value,
          psv.invoiced_value::text AS invoiced_value,
          psv.received_value::text AS received_value,
          psv.outstanding_value::text AS outstanding_value
        FROM psv
        ${where}
        ORDER BY ${orderBy}
        ${paging}
      `),
      // Totals over EVERY matching SO (the KPI strip + the totals row).
      tx.execute(sql`
        ${base}
        SELECT
          count(*)::int AS so_count,
          COALESCE(SUM(psv.order_value), 0)::numeric(16, 2)::text AS order_value,
          COALESCE(SUM(psv.dispatched_value), 0)::numeric(16, 2)::text AS dispatched_value,
          COALESCE(SUM(psv.pending_value), 0)::numeric(16, 2)::text AS pending_value,
          COALESCE(SUM(psv.invoiced_value), 0)::numeric(16, 2)::text AS invoiced_value,
          COALESCE(SUM(psv.received_value), 0)::numeric(16, 2)::text AS received_value,
          COALESCE(SUM(psv.outstanding_value), 0)::numeric(16, 2)::text AS outstanding_value
        FROM psv
        ${where}
      `),
    ]);

    type Row = {
      so_id: string;
      so_code: string;
      internal_so_no: string | null;
      customer_name: string | null;
      so_date: string;
      due_date: string | null;
      status: string;
      order_value: string;
      dispatched_value: string;
      pending_value: string;
      invoiced_value: string;
      received_value: string;
      outstanding_value: string;
    };
    type TotalsRow = Omit<
      Row,
      'so_id' | 'so_code' | 'internal_so_no' | 'customer_name' | 'so_date' | 'due_date' | 'status'
    > & {
      so_count: number;
    };

    const mapped: PendingSoValueRow[] = (pageRows as unknown as Row[]).map((r) => ({
      soId: r.so_id,
      soCode: r.so_code,
      soInternalNo: r.internal_so_no,
      customerName: r.customer_name,
      soDate: r.so_date,
      dueDate: r.due_date,
      status: r.status,
      orderValue: r.order_value,
      dispatchedValue: r.dispatched_value,
      pendingValue: r.pending_value,
      invoicedValue: r.invoiced_value,
      receivedValue: r.received_value,
      outstandingValue: r.outstanding_value,
    }));

    const t = (totalsRows as unknown as TotalsRow[])[0];
    const totals: PendingSoValueResponse['totals'] = {
      soCount: Number(t?.so_count ?? 0),
      orderValue: t?.order_value ?? '0.00',
      dispatchedValue: t?.dispatched_value ?? '0.00',
      pendingValue: t?.pending_value ?? '0.00',
      invoicedValue: t?.invoiced_value ?? '0.00',
      receivedValue: t?.received_value ?? '0.00',
      outstandingValue: t?.outstanding_value ?? '0.00',
    };

    return {
      priceVisible: showMoney,
      generatedAt: new Date().toISOString(),
      filter,
      total: totals.soCount,
      rows: showMoney ? mapped : mapped.map(hidePsvRowMoney),
      totals: showMoney ? totals : hidePsvRowMoney(totals),
    };
  });
}
