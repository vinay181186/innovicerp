// Dashboard KPIs service (T-041c).
//
// Runs 5 aggregate queries in parallel and assembles the tile response.
// All queries are scoped to the user's company via withUserContext (RLS
// enforces it at the DB layer; service-level scope is defensive).
//
// Severity rules:
//   - count == 0  → 'ok' (caught up)
//   - small count → 'info'
//   - medium      → 'warning'
//   - many        → 'danger'
// Thresholds are conservative for the 15-20-user scale; tune per tile.

import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import type { DashboardKpisResponse, DashboardTile, DashboardTileSeverity } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

interface CountAndOptionalSum {
  count: number;
  sum: string | null;
}

function severityForCount(count: number, warn: number, danger: number): DashboardTileSeverity {
  if (count === 0) return 'ok';
  if (count >= danger) return 'danger';
  if (count >= warn) return 'warning';
  return 'info';
}

export async function getDashboardKpis(user: AuthContext): Promise<DashboardKpisResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const [openSos, openPos, jcQcAwait, ncsPending, grnQcPending] = await Promise.all([
      // Open sales orders — status='open'
      tx.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM public.sales_orders
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND status = 'open'
      `),
      // Open purchase orders — anything not closed/cancelled
      tx.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM public.purchase_orders
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND status IN ('draft', 'open', 'partial', 'qc_pending')
      `),
      // JC ops awaiting QC — qc_required + qc_call_date set + not yet attended
      tx.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM public.jc_ops
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND qc_required = true
          AND qc_call_date IS NOT NULL
          AND qc_attended_date IS NULL
      `),
      // NCs pending dispose — status='pending'; sum rejected_qty as secondary
      tx.execute(sql`
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(rejected_qty), 0)::text AS sum
        FROM public.nc_register
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND status = 'pending'
      `),
      // GRN lines awaiting QC — qc_status not completed
      tx.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM public.goods_receipt_note_lines
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND qc_status IN ('pending', 'in_progress')
      `),
    ]);

    const openSoCount = Number((openSos as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    const openPoCount = Number((openPos as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    const jcQcCount = Number((jcQcAwait as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    const ncRow = (ncsPending as unknown as Array<CountAndOptionalSum>)[0];
    const ncCount = Number(ncRow?.count ?? 0);
    const ncSumRejected = ncRow?.sum ?? '0';
    const grnQcCount = Number((grnQcPending as unknown as Array<{ count: number }>)[0]?.count ?? 0);

    const tiles: DashboardTile[] = [
      {
        kind: 'open_sales_orders',
        title: 'Open sales orders',
        count: openSoCount,
        secondary: null,
        severity: severityForCount(openSoCount, 5, 15),
        route: '/sales-orders?status=open',
        hint: null,
      },
      {
        kind: 'open_purchase_orders',
        title: 'Open purchase orders',
        count: openPoCount,
        secondary: null,
        severity: severityForCount(openPoCount, 5, 15),
        route: '/purchase-orders',
        hint: 'draft / open / partial / qc_pending',
      },
      {
        kind: 'jc_ops_awaiting_qc',
        title: 'JC ops awaiting QC',
        count: jcQcCount,
        secondary: null,
        severity: severityForCount(jcQcCount, 3, 10),
        route: '/op-entry?qcOnly=1',
        hint: 'qc_required AND qc_call_date set AND not yet attended',
      },
      {
        kind: 'ncs_pending_dispose',
        title: 'NCs pending dispose',
        count: ncCount,
        secondary:
          ncCount > 0 ? { label: 'rejected qty', value: Number(ncSumRejected).toFixed(0) } : null,
        severity: severityForCount(ncCount, 1, 5),
        route: '/nc-register?status=pending',
        hint: null,
      },
      {
        kind: 'grn_lines_pending_qc',
        title: 'GRN lines pending QC',
        count: grnQcCount,
        secondary: null,
        severity: severityForCount(grnQcCount, 3, 10),
        route: '/goods-receipt-notes',
        hint: null,
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      tiles,
    };
  });
}
