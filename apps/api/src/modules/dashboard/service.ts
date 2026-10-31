// Dashboard KPIs service (T-041c + T-043 role filter + 2 follow-on tiles).
//
// Runs 7 aggregate queries in parallel and assembles the tile response.
// All queries are scoped to the user's company via withUserContext (RLS
// enforces it at the DB layer; service-level scope is defensive).
//
// T-043 — tiles are filtered to those the caller may see before returning.
// ADR-232: each tile follows the View right of the page it counts, not the
// role. The map is intentionally local to this service (it's an
// authorization decision, not a wire shape).
//
// Severity rules:
//   - count == 0  → 'ok' (caught up)
//   - small count → 'info'
//   - medium      → 'warning'
//   - many        → 'danger'
// Thresholds are conservative for the 15-20-user scale; tune per tile.

import { type AccessFormKey, effectiveFormPerms } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { getMyAccess } from '../access-control/service';
import { prWaitingForPoSql } from '../purchase-requests/service';
import type {
  DashboardKpisResponse,
  DashboardTile,
  DashboardTileKind,
  DashboardTileSeverity,
} from './schema';

// Tile visibility (ADR-232): a tile shows iff the caller may VIEW the page it
// counts. Super Admin sees every tile; an L7 Auditor views every page, so
// sees every tile too (effectiveFormPerms).
const TILE_VIEW_FORM: Record<DashboardTileKind, AccessFormKey> = {
  open_sales_orders: 'so_create',
  open_purchase_orders: 'po_create',
  jc_ops_awaiting_qc: 'qc_submit',
  ncs_pending_dispose: 'nc_dispose',
  grn_lines_pending_qc: 'qc_incoming',
  prs_pending_conversion: 'pr_create',
  ops_in_progress: 'op_entry',
};

async function visibleTileKinds(user: AuthContext): Promise<(kind: DashboardTileKind) => boolean> {
  if (user.role === 'admin') return () => true;
  const eff = await getMyAccess(user);
  return (kind) => effectiveFormPerms(eff, TILE_VIEW_FORM[kind]).view;
}

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
  // Access read first — it opens its own transaction (see clients/related.ts).
  const isTileVisible = await visibleTileKinds(user);

  return withUserContext(user, async (tx) => {
    const [openSos, openPos, jcQcAwait, ncsPending, grnQcPending, prsPending, opsRunning] =
      await Promise.all([
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
        // PRs waiting for a PO — procurement-relevant. One rule
        // (prWaitingForPoSql), shared with alerts AL-002 / AL-006.
        tx.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM public.purchase_requests pr
        WHERE pr.company_id = ${companyId}::uuid
          AND pr.deleted_at IS NULL
          AND ${prWaitingForPoSql('pr')}
      `),
        // Op sessions currently running — operator/qc-relevant. running_ops
        // has no soft-delete column (append-only state per ADR-011).
        tx.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM public.running_ops
        WHERE company_id = ${companyId}::uuid
          AND status = 'running'
      `),
      ]);

    const openSoCount = Number((openSos as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    const openPoCount = Number((openPos as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    const jcQcCount = Number((jcQcAwait as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    const ncRow = (ncsPending as unknown as Array<CountAndOptionalSum>)[0];
    const ncCount = Number(ncRow?.count ?? 0);
    const ncSumRejected = ncRow?.sum ?? '0';
    const grnQcCount = Number((grnQcPending as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    const prsPendingCount = Number(
      (prsPending as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    );
    const opsRunningCount = Number(
      (opsRunning as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    );

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
          ncCount > 0 ? { label: 'deviated qty', value: Number(ncSumRejected).toFixed(0) } : null,
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
      {
        kind: 'prs_pending_conversion',
        title: 'PRs pending PO',
        count: prsPendingCount,
        secondary: null,
        severity: severityForCount(prsPendingCount, 3, 10),
        route: '/purchase-requests',
        hint: 'PRs with quantity still to order',
      },
      {
        kind: 'ops_in_progress',
        title: 'Ops in progress',
        count: opsRunningCount,
        secondary: null,
        // ops in progress is a state to monitor, not a backlog — info-only,
        // never escalates to warning/danger by count.
        severity: opsRunningCount === 0 ? 'ok' : 'info',
        route: '/op-entry/running',
        hint: 'live operator sessions',
      },
    ];

    const visible = tiles.filter((t) => isTileVisible(t.kind));

    return {
      generatedAt: new Date().toISOString(),
      tiles: visible,
    };
  });
}
