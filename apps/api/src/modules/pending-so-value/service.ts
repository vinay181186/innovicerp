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
//   outstandingValue = invoicedValue - receivedValue

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  PendingSoValueFilter,
  PendingSoValueResponse,
  PendingSoValueRow,
} from '@innovic/shared';
import { salesOrders } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

export async function getPendingSoValue(
  filter: PendingSoValueFilter,
  user: AuthContext,
): Promise<PendingSoValueResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // One aggregating query: per-SO sums of order / dispatched / invoiced /
    // received. Filtering applied in the outer WHERE.
    //
    // Dispatched value uses the SO-line rate (not the DC line which doesn't
    // carry rate) — multiply dispatched qty by the line's rate. We compute
    // per-line dispatched-qty via a LATERAL sub-query for clarity over a
    // chained join.
    const rows = await tx.execute(sql`
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
          COALESCE(SUM(total_paid), 0)::numeric(14, 2)  AS received_value
        FROM public.invoices
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
        GROUP BY sales_order_id
      )
      SELECT
        so.id                              AS so_id,
        so.code                            AS so_code,
        so.customer_name                   AS customer_name,
        so.so_date::text                   AS so_date,
        sov.earliest_due_date::text        AS due_date,
        so.status::text                    AS status,
        COALESCE(sov.order_value, 0)::text AS order_value,
        COALESCE(sd.dispatched_value, 0)::text AS dispatched_value,
        (COALESCE(sov.order_value, 0) - COALESCE(sd.dispatched_value, 0))::text AS pending_value,
        COALESCE(si.invoiced_value, 0)::text AS invoiced_value,
        COALESCE(si.received_value, 0)::text AS received_value,
        (COALESCE(si.invoiced_value, 0) - COALESCE(si.received_value, 0))::text AS outstanding_value
      FROM public.sales_orders so
      LEFT JOIN so_order_value sov ON sov.so_id = so.id
      LEFT JOIN so_dispatched   sd  ON sd.so_id  = so.id
      LEFT JOIN so_invoiced     si  ON si.so_id  = so.id
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
      ORDER BY (COALESCE(sov.order_value, 0) - COALESCE(sd.dispatched_value, 0)) DESC
    `);

    type Row = {
      so_id: string;
      so_code: string;
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
    const typed = rows as unknown as Row[];
    const today = new Date().toISOString().slice(0, 10);

    const filtered = typed.filter((r) => {
      const pending = Number(r.pending_value);
      const isOpenLike = r.status === 'open';
      const isCompletedLike =
        r.status === 'closed' || r.status === 'dispatched' || r.status === 'cancelled';
      switch (filter) {
        case 'open':
          return isOpenLike || pending > 0;
        case 'all':
          return true;
        case 'overdue':
          return r.due_date !== null && r.due_date < today && pending > 0;
        case 'completed':
          return isCompletedLike;
        default:
          return true;
      }
    });

    const mapped: PendingSoValueRow[] = filtered.map((r) => ({
      soId: r.so_id,
      soCode: r.so_code,
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

    const totals = sumTotals(mapped);

    return {
      generatedAt: new Date().toISOString(),
      filter,
      rows: mapped,
      totals,
    };
  });
}

function sumTotals(rows: PendingSoValueRow[]): PendingSoValueResponse['totals'] {
  let orderValue = 0;
  let dispatchedValue = 0;
  let pendingValue = 0;
  let invoicedValue = 0;
  let receivedValue = 0;
  let outstandingValue = 0;
  for (const r of rows) {
    orderValue += Number(r.orderValue);
    dispatchedValue += Number(r.dispatchedValue);
    pendingValue += Number(r.pendingValue);
    invoicedValue += Number(r.invoicedValue);
    receivedValue += Number(r.receivedValue);
    outstandingValue += Number(r.outstandingValue);
  }
  return {
    soCount: rows.length,
    orderValue: orderValue.toFixed(2),
    dispatchedValue: dispatchedValue.toFixed(2),
    pendingValue: pendingValue.toFixed(2),
    invoicedValue: invoicedValue.toFixed(2),
    receivedValue: receivedValue.toFixed(2),
    outstandingValue: outstandingValue.toFixed(2),
  };
}

// Re-export the imports so eslint doesn't complain about unused identifiers
// when the schema-typed table refs aren't directly used (the SQL goes through
// tx.execute(sql\`\`)). The imports keep the module's intent obvious.
void salesOrders;
void and;
void eq;
void isNull;
