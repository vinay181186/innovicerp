// Supply Chain Dashboard service. Mirror of legacy renderSCDashboard
// (L16790). GET /sc-dashboard = the KPI strip (whole-company figures) + the
// Pending PO Tracker picklists. The five tables page at 25 on their own
// endpoints (ADR-201): ./pending (Pending PO Tracker, Recent GRN) and
// ./summaries (Vendor-wise, SO-wise, Complete Purchase Summary).

import type { ScDashboardResponse } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { pendingFrom } from './pending';
import { PENDING_ITEM_SQL, PENDING_SO_SQL, PENDING_VENDOR_SQL } from './sf-columns';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export async function getScDashboard(user: AuthContext): Promise<ScDashboardResponse> {
  const companyId = requireCompany(user);
  const cid = `'${companyId}'::uuid`;
  // Money-hiding for L1 Viewers ("Can See Price"). The dashboard rides the
  // Purchase price permission (po_create).
  const showMoney = await canSeeFormPrice(user, 'po_create');

  return withUserContext(user, async (tx) => {
    // ─── Summary card counts + value totals ────────────────────────
    const summaryR = await tx.execute(
      sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE po.status = 'open')        AS open_pos,
          COUNT(*) FILTER (WHERE po.status = 'partial')     AS partial_pos,
          COUNT(*) FILTER (WHERE po.status = 'closed')      AS closed_pos,
          COUNT(*) FILTER (WHERE po.status = 'cancelled')   AS cancelled_pos,
          COALESCE(SUM(CASE WHEN po.status <> 'cancelled' THEN pol.qty * pol.rate ELSE 0 END), 0) AS total_order_val,
          COALESCE(SUM(CASE WHEN po.status <> 'cancelled' THEN pol.received_qty * pol.rate ELSE 0 END), 0) AS total_recv_val
        FROM purchase_orders po
        LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
        WHERE po.company_id = ${cid}
          AND po.deleted_at IS NULL
      `),
    );
    type SumRow = {
      open_pos: number;
      partial_pos: number;
      closed_pos: number;
      cancelled_pos: number;
      total_order_val: string | number;
      total_recv_val: string | number;
    };
    const s = (summaryR as unknown as SumRow[])[0]!;
    const totalOrderVal = Number(s.total_order_val) || 0;
    const totalRecvVal = Number(s.total_recv_val) || 0;

    const grnR = await tx.execute(
      sql.raw(`
        SELECT COUNT(*) AS c,
               COUNT(*) FILTER (WHERE grn_date = current_date) AS today_c
        FROM goods_receipt_notes
        WHERE company_id = ${cid}
          AND deleted_at IS NULL
      `),
    );
    const g = (grnR as unknown as { c: number; today_c: number }[])[0]!;

    // ─── Pending PO Tracker picklists — over EVERY pending line ─────
    // (the tables themselves are paged by ./pending + ./summaries, ADR-201).
    const optR = (await tx.execute(sql`
      SELECT
        ARRAY(SELECT DISTINCT x FROM unnest(array_agg(${PENDING_VENDOR_SQL})) x WHERE x IS NOT NULL AND x <> '' ORDER BY x) AS vendors,
        ARRAY(SELECT DISTINCT x FROM unnest(array_agg(${PENDING_ITEM_SQL})) x WHERE x IS NOT NULL AND x <> '' ORDER BY x) AS items,
        ARRAY(SELECT DISTINCT x FROM unnest(array_agg(${PENDING_SO_SQL})) x WHERE x IS NOT NULL AND x <> '' ORDER BY x) AS sos
      ${pendingFrom(companyId)}
    `)) as unknown as Array<{
      vendors: string[] | null;
      items: string[] | null;
      sos: string[] | null;
    }>;
    const opt = optR[0];

    const summary = {
      openPos: Number(s.open_pos) || 0,
      partialPos: Number(s.partial_pos) || 0,
      closedPos: Number(s.closed_pos) || 0,
      cancelledPos: Number(s.cancelled_pos) || 0,
      totalOrderVal: showMoney ? totalOrderVal : null,
      totalRecvVal: showMoney ? totalRecvVal : null,
      pendingVal: showMoney ? totalOrderVal - totalRecvVal : null,
      grnCount: Number(g.c) || 0,
      todayGrn: Number(g.today_c) || 0,
    };
    return {
      priceVisible: showMoney,
      summary,
      filterOptions: {
        vendors: opt?.vendors ?? [],
        items: opt?.items ?? [],
        sos: opt?.sos ?? [],
      },
    };
  });
}
