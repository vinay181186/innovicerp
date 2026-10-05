// SO Costing service. Mirror of legacy renderSOCosting (L17249) + _soCostDetail
// (L17310). Per SO: Material (PO with-material lines linked to the SO line via
// source_so_line_id, po_type <> 'job_work'), Outsource (jc_ops.outsource_po_line),
// Machine-Time ((cycle_min/60) × completed × machine.hour_rate). Read-only.
//
// Machine-Time is split per machine as of migration 0095: each machine's own
// completed qty (v_op_machine_output) is priced at its own hour_rate, instead of
// pricing the whole operation at whatever machine the op currently points at.
// An op that only ever ran on one machine costs exactly what it costed before.
//
// The LIST (one row per SO) lives here; the per-SO detail is service.ts.
// ADR-201: the list pages at 25 — search / Sort & Filter / page on the server.

import type {
  ListSoCostingResponse,
  SoCostingRow,
  listSoCostingQuerySchema,
} from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';

export type ListSoCostingQueryParsed = z.output<typeof listSoCostingQuerySchema>;

/** Sort & Filter (ADR-200) fields — each the SAME `b.` column the list shows.
 *  Cost Centre filters on what the cell prints: code, then " — name". */
const SO_COSTING_SF_COLUMNS: SfColumnMap = {
  soNo: { sql: sql`b.so_no`, type: 'text' },
  soInternalNo: { sql: sql`b.so_internal_no`, type: 'text' },
  customer: { sql: sql`b.customer`, type: 'text' },
  lines: { sql: sql`b.line_count`, type: 'num' },
  totalQty: { sql: sql`b.total_qty`, type: 'num' },
  subtotal: { sql: sql`b.so_value`, type: 'num', price: true },
  costCenter: {
    sql: sql`(b.cost_center || COALESCE(' — ' || b.cc_name, ''))`,
    type: 'text',
  },
  material: { sql: sql`b.material_cost`, type: 'num', price: true },
  outsource: { sql: sql`b.outsource_cost`, type: 'num', price: true },
  machineTime: { sql: sql`b.machine_time_cost`, type: 'num', price: true },
  totalCost: { sql: sql`b.total_cost`, type: 'num', price: true },
};

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

type ListRow = {
  so_id: string;
  so_no: string;
  so_internal_no: string | null;
  customer: string | null;
  cost_center: string | null;
  cc_name: string | null;
  line_count: string | number;
  total_qty: string | number;
  so_value: string | number;
  material_cost: string | number;
  outsource_cost: string | number;
  machine_time_cost: string | number;
};

// Money-hiding for L1 Viewers ("Can See Price"). The whole costing report is
// money; it rides the Sales price permission (so_create).
function hideCostingRowMoney<
  T extends {
    soValue: number | null;
    materialCost: number | null;
    outsourceCost: number | null;
    machineTimeCost: number | null;
    totalCost: number | null;
  },
>(r: T): T {
  return {
    ...r,
    soValue: null,
    materialCost: null,
    outsourceCost: null,
    machineTimeCost: null,
    totalCost: null,
  };
}

export async function listSoCosting(
  user: AuthContext,
  input: ListSoCostingQueryParsed = { offset: 0 },
): Promise<ListSoCostingResponse> {
  const companyId = requireCompany(user);
  const cid = sql.raw(`'${companyId}'::uuid`);
  const showMoney = await canSeeFormPrice(user, 'so_create');
  const sf = readSf(input.sf);
  const sfOpts = { canSeePrice: showMoney };

  // ADR-201: search / Sort & Filter / page run here over EVERY SO.
  const where: SQL[] = [];
  const term = (input.search ?? '').trim();
  if (term) {
    const pat = `%${likeEscape(term)}%`;
    where.push(sql`AND (b.so_no ILIKE ${pat} ESCAPE '\\'
      OR b.so_internal_no ILIKE ${pat} ESCAPE '\\' OR b.customer ILIKE ${pat} ESCAPE '\\'
      OR b.cost_center ILIKE ${pat} ESCAPE '\\' OR b.cc_name ILIKE ${pat} ESCAPE '\\')`);
  }
  where.push(sfWhere(SO_COSTING_SF_COLUMNS, sf, sfOpts));
  // SO No. newest first (as before), id last so a page never skips a row.
  const order = sfOrderBy(SO_COSTING_SF_COLUMNS, sf, sql`b.so_no DESC, b.so_id DESC`, sfOpts);
  const limit = input.limit === undefined ? sql.raw('ALL') : sql`${input.limit}`;

  return withUserContext(user, async (tx) => {
    const res = await tx.execute(
      sql`
        WITH material AS (
          SELECT sol.sales_order_id, SUM(pol.qty * pol.rate) AS mat
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchase_order_id
          JOIN sales_order_lines sol ON sol.id = pol.source_so_line_id
          WHERE po.company_id = ${cid} AND po.deleted_at IS NULL AND po.po_type <> 'job_work'
          GROUP BY sol.sales_order_id
        ),
        outsrc AS (
          SELECT sol.sales_order_id, SUM(pol.qty * pol.rate) AS os
          FROM jc_ops o
          JOIN job_cards jc ON jc.id = o.job_card_id
          JOIN sales_order_lines sol ON sol.id = jc.source_so_line_id
          JOIN purchase_order_lines pol ON pol.id = o.outsource_po_line_id
          WHERE o.company_id = ${cid} AND o.op_type = 'outsource'
            AND o.deleted_at IS NULL AND jc.deleted_at IS NULL
          GROUP BY sol.sales_order_id
        ),
        -- Machine-time is costed per MACHINE, not per operation (migration 0095).
        -- v_op_machine_output splits an op's completed qty across the machines
        -- that actually produced it, so each share is priced at ITS OWN hour
        -- rate. Before this, the whole op was priced at the op's CURRENT machine
        -- rate, so re-routing an op silently repriced work already done.
        -- rated_qty = SUM(qty × that machine's hour_rate).
        mach_split AS (
          SELECT v.jc_op_id,
                 SUM(v.completed_qty) AS logged_qty,
                 SUM(v.completed_qty * COALESCE(mm.hour_rate, 0)) AS rated_qty
          FROM v_op_machine_output v
          LEFT JOIN machines mm ON mm.id = v.machine_id
          WHERE v.company_id = ${cid}
          GROUP BY v.jc_op_id
        ),
        machtime AS (
          -- Residual term: qty counted as completed on the op that has no
          -- production log behind it (OSP-accepted pieces on a dual-lane
          -- in-house op, ADR-081) keeps costing at the op's own machine rate,
          -- exactly as before. A single-machine op therefore returns the
          -- identical number it always did: rated_qty = qty × that machine's
          -- rate, logged_qty = qty, residual = the OSP remainder.
          SELECT sol.sales_order_id,
                 SUM((o.cycle_time_min / 60.0) * (
                   COALESCE(ms.rated_qty, 0)
                   + GREATEST(COALESCE(vs.completed_qty, 0) - COALESCE(ms.logged_qty, 0), 0)
                     * COALESCE(m.hour_rate, 0)
                 )) AS mt
          FROM jc_ops o
          JOIN job_cards jc ON jc.id = o.job_card_id
          JOIN sales_order_lines sol ON sol.id = jc.source_so_line_id
          LEFT JOIN v_jc_op_status vs ON vs.jc_op_id = o.id
          LEFT JOIN machines m ON m.id = o.machine_id
          LEFT JOIN mach_split ms ON ms.jc_op_id = o.id
          WHERE o.company_id = ${cid} AND o.op_type NOT IN ('outsource', 'qc')
            AND o.machine_id IS NOT NULL AND o.deleted_at IS NULL AND jc.deleted_at IS NULL
          GROUP BY sol.sales_order_id
        ),
        base AS (
        SELECT
          so.id AS so_id, so.code AS so_no, so.internal_so_no AS so_internal_no,
          COALESCE(cl.name, so.customer_name) AS customer,
          -- Cost Center is no longer captured on the SO; every SO is its own
          -- cost centre, so fall back to the SO No. when cost_center is empty.
          COALESCE(so.cost_center, so.code) AS cost_center,
          (SELECT cc.name FROM cost_centers cc
             WHERE cc.code = so.cost_center AND cc.company_id = so.company_id
               AND cc.deleted_at IS NULL LIMIT 1) AS cc_name,
          (SELECT COUNT(*) FROM sales_order_lines sl
             WHERE sl.sales_order_id = so.id AND sl.deleted_at IS NULL) AS line_count,
          (SELECT COALESCE(SUM(sl.order_qty), 0) FROM sales_order_lines sl
             WHERE sl.sales_order_id = so.id AND sl.deleted_at IS NULL) AS total_qty,
          (SELECT COALESCE(SUM(sl.order_qty * sl.rate), 0) FROM sales_order_lines sl
             WHERE sl.sales_order_id = so.id AND sl.deleted_at IS NULL) AS so_value,
          COALESCE(material.mat, 0) AS material_cost,
          COALESCE(outsrc.os, 0) AS outsource_cost,
          COALESCE(machtime.mt, 0) AS machine_time_cost,
          COALESCE(material.mat, 0) + COALESCE(outsrc.os, 0) + COALESCE(machtime.mt, 0)
            AS total_cost
        FROM sales_orders so
        LEFT JOIN clients cl ON cl.id = so.client_id
        LEFT JOIN material ON material.sales_order_id = so.id
        LEFT JOIN outsrc ON outsrc.sales_order_id = so.id
        LEFT JOIN machtime ON machtime.sales_order_id = so.id
        WHERE so.company_id = ${cid} AND so.deleted_at IS NULL
        ),
        filt AS (SELECT b.* FROM base b WHERE TRUE ${sql.join(where, sql` `)}),
        pg AS (
          SELECT b.*, row_number() OVER (ORDER BY ${order}) AS rn
          FROM filt b ORDER BY ${order}
          LIMIT ${limit} OFFSET ${input.offset}
        )
        -- One row even past the last page, so the count always comes back.
        SELECT (SELECT COUNT(*) FROM filt)::int AS full_count, pg.*
        FROM (SELECT 1) one LEFT JOIN pg ON TRUE
        ORDER BY pg.rn
      `,
    );
    const got = res as unknown as Array<ListRow & { full_count: number; so_id: string | null }>;
    const total = Number(got[0]?.full_count ?? 0);
    const listRows = got.filter((r) => r.so_id !== null);

    const rows: SoCostingRow[] = listRows.map((r) => {
      const materialCost = Number(r.material_cost) || 0;
      const outsourceCost = Number(r.outsource_cost) || 0;
      const machineTimeCost = Number(r.machine_time_cost) || 0;
      return {
        soId: r.so_id,
        soNo: r.so_no,
        soInternalNo: r.so_internal_no,
        customer: r.customer,
        lineCount: Number(r.line_count) || 0,
        totalQty: Number(r.total_qty) || 0,
        soValue: Number(r.so_value) || 0,
        costCenter: r.cost_center,
        costCenterName: r.cc_name,
        materialCost,
        outsourceCost,
        machineTimeCost,
        totalCost: materialCost + outsourceCost + machineTimeCost,
      };
    });

    return {
      rows: showMoney ? rows : rows.map(hideCostingRowMoney),
      total,
      priceVisible: showMoney,
    };
  });
}
