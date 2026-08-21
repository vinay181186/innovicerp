// SO Costing service. Mirror of legacy renderSOCosting (L17249) + _soCostDetail
// (L17310). Per SO: Material (PO with-material lines linked to the SO line via
// source_so_line_id, po_type <> 'job_work'), Outsource (jc_ops.outsource_po_line),
// Machine-Time ((cycle_min/60) × completed × machine.hour_rate). Read-only.
//
// Machine-Time is split per machine as of migration 0095: each machine's own
// completed qty (v_op_machine_output) is priced at its own hour_rate, instead of
// pricing the whole operation at whatever machine the op currently points at.
// An op that only ever ran on one machine costs exactly what it costed before.

import type {
  ListSoCostingResponse,
  SoCostingDetail,
  SoCostingLine,
  SoCostingOpRow,
  SoCostingRow,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

type ListRow = {
  so_id: string;
  so_no: string;
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

export async function listSoCosting(user: AuthContext): Promise<ListSoCostingResponse> {
  const companyId = requireCompany(user);
  const cid = `'${companyId}'::uuid`;
  const showMoney = await canSeeFormPrice(user, 'so_create');

  return withUserContext(user, async (tx) => {
    const res = await tx.execute(
      sql.raw(`
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
        )
        SELECT
          so.id AS so_id, so.code AS so_no,
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
          COALESCE(machtime.mt, 0) AS machine_time_cost
        FROM sales_orders so
        LEFT JOIN clients cl ON cl.id = so.client_id
        LEFT JOIN material ON material.sales_order_id = so.id
        LEFT JOIN outsrc ON outsrc.sales_order_id = so.id
        LEFT JOIN machtime ON machtime.sales_order_id = so.id
        WHERE so.company_id = ${cid} AND so.deleted_at IS NULL
        ORDER BY so.code DESC
      `),
    );

    const rows: SoCostingRow[] = (res as unknown as ListRow[]).map((r) => {
      const materialCost = Number(r.material_cost) || 0;
      const outsourceCost = Number(r.outsource_cost) || 0;
      const machineTimeCost = Number(r.machine_time_cost) || 0;
      return {
        soId: r.so_id,
        soNo: r.so_no,
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

    return { rows: showMoney ? rows : rows.map(hideCostingRowMoney) };
  });
}

type DetailLineRow = {
  so_line_id: string;
  line_no: number;
  item_code: string | null;
  item_name: string;
  order_qty: number;
  material_cost: string | number;
};
type DetailOpRow = {
  so_line_id: string;
  jc_no: string;
  op_seq: number;
  operation: string;
  op_type: string;
  machine_code: string | null;
  machines: Array<{ machineCode: string; qty: unknown }> | null;
  outsource_cost: string | number;
  machine_time_cost: string | number;
  qty: string | number;
  cycle_time_min: string | number;
};

export async function getSoCostingDetail(soId: string, user: AuthContext): Promise<SoCostingDetail> {
  const companyId = requireCompany(user);
  const cid = `'${companyId}'::uuid`;
  const sid = `'${soId}'::uuid`;
  const showMoney = await canSeeFormPrice(user, 'so_create');

  return withUserContext(user, async (tx) => {
    const headRes = await tx.execute(
      sql.raw(`
        SELECT so.id AS so_id, so.code AS so_no,
          COALESCE(cl.name, so.customer_name) AS customer,
          COALESCE(so.cost_center, so.code) AS cost_center,
          (SELECT cc.name FROM cost_centers cc
             WHERE cc.code = so.cost_center AND cc.company_id = so.company_id
               AND cc.deleted_at IS NULL LIMIT 1) AS cc_name
        FROM sales_orders so
        LEFT JOIN clients cl ON cl.id = so.client_id
        WHERE so.id = ${sid} AND so.company_id = ${cid} AND so.deleted_at IS NULL
        LIMIT 1
      `),
    );
    const head = (headRes as unknown as {
      so_id: string;
      so_no: string;
      customer: string | null;
      cost_center: string | null;
      cc_name: string | null;
    }[])[0];
    if (!head) throw new NotFoundError(`Sales order ${soId} not found`);

    const lineRes = await tx.execute(
      sql.raw(`
        SELECT sol.id AS so_line_id, sol.line_no,
          sol.item_code_text AS item_code, sol.part_name AS item_name, sol.order_qty,
          COALESCE((
            SELECT SUM(pol.qty * pol.rate) FROM purchase_order_lines pol
            JOIN purchase_orders po ON po.id = pol.purchase_order_id
            WHERE pol.source_so_line_id = sol.id AND po.deleted_at IS NULL
              AND po.po_type <> 'job_work'
          ), 0) AS material_cost
        FROM sales_order_lines sol
        WHERE sol.sales_order_id = ${sid} AND sol.deleted_at IS NULL
        ORDER BY sol.line_no
      `),
    );

    const opRes = await tx.execute(
      sql.raw(`
        SELECT sol.id AS so_line_id, jc.code AS jc_no, o.op_seq, o.operation,
          -- machine_code stays the op's CURRENT machine while the cost below is
          -- the per-machine blend, so on a re-routed op the label names one
          -- machine and the money spans several. The machines column added below
          -- carries who actually produced the qty, so the UI can name every
          -- machine the cost spans (ADR-126). Label data only -- the money is
          -- already split per machine by the ms LATERAL and is not touched here.
          o.op_type::text AS op_type, o.machine_code_text AS machine_code,
          COALESCE(mo.machines, '[]'::json) AS machines,
          COALESCE((
            SELECT pol.qty * pol.rate FROM purchase_order_lines pol
            WHERE pol.id = o.outsource_po_line_id
          ), 0) AS outsource_cost,
          -- Same per-machine formula as the list query's machtime CTE, so the
          -- detail total can never drift from the list total.
          CASE WHEN o.op_type NOT IN ('outsource', 'qc') AND o.machine_id IS NOT NULL
            THEN (o.cycle_time_min / 60.0) * (
                   COALESCE(ms.rated_qty, 0)
                   + GREATEST(COALESCE(vs.completed_qty, 0) - COALESCE(ms.logged_qty, 0), 0)
                     * COALESCE(m.hour_rate, 0)
                 )
            ELSE 0 END AS machine_time_cost,
          COALESCE(vs.completed_qty, 0) AS qty,
          o.cycle_time_min
        FROM jc_ops o
        JOIN job_cards jc ON jc.id = o.job_card_id
        JOIN sales_order_lines sol ON sol.id = jc.source_so_line_id
        LEFT JOIN v_jc_op_status vs ON vs.jc_op_id = o.id
        LEFT JOIN machines m ON m.id = o.machine_id
        LEFT JOIN LATERAL (
          SELECT SUM(v.completed_qty) AS logged_qty,
                 SUM(v.completed_qty * COALESCE(mm.hour_rate, 0)) AS rated_qty
          FROM v_op_machine_output v
          LEFT JOIN machines mm ON mm.id = v.machine_id
          WHERE v.jc_op_id = o.id
        ) ms ON TRUE
        -- Label-only split, correlated on the op id so it never scans the
        -- company. Same canonical aggregate as jc-ops / op-entry.
        LEFT JOIN LATERAL (
          SELECT json_agg(
                   json_build_object('machineCode', v.machine_code, 'qty', v.completed_qty)
                   ORDER BY v.completed_qty DESC, v.machine_code
                 ) AS machines
          FROM public.v_op_machine_output v
          WHERE v.jc_op_id = o.id
        ) mo ON TRUE
        WHERE sol.sales_order_id = ${sid} AND o.deleted_at IS NULL AND jc.deleted_at IS NULL
        ORDER BY sol.line_no, jc.code, o.op_seq
      `),
    );

    const opsByLine = new Map<string, SoCostingOpRow[]>();
    for (const r of opRes as unknown as DetailOpRow[]) {
      const arr = opsByLine.get(r.so_line_id) ?? [];
      arr.push({
        jcNo: r.jc_no,
        opSeq: Number(r.op_seq) || 0,
        operation: r.operation,
        opType: r.op_type,
        machineCode: r.machine_code,
        machines: (r.machines ?? []).map((v) => ({
          machineCode: String(v.machineCode),
          qty: Number(v.qty ?? 0),
        })),
        outsourceCost: Number(r.outsource_cost) || 0,
        machineTimeCost: Number(r.machine_time_cost) || 0,
        qty: Number(r.qty) || 0,
        cycleTimeMin: Number(r.cycle_time_min) || 0,
      });
      opsByLine.set(r.so_line_id, arr);
    }

    let grandMaterial = 0;
    let grandOutsource = 0;
    let grandMachineTime = 0;
    const lines: SoCostingLine[] = (lineRes as unknown as DetailLineRow[]).map((r) => {
      const ops = opsByLine.get(r.so_line_id) ?? [];
      const materialCost = Number(r.material_cost) || 0;
      const outsourceCost = ops.reduce((s, o) => s + (o.outsourceCost ?? 0), 0);
      const machineTimeCost = ops.reduce((s, o) => s + (o.machineTimeCost ?? 0), 0);
      grandMaterial += materialCost;
      grandOutsource += outsourceCost;
      grandMachineTime += machineTimeCost;
      return {
        salesOrderLineId: r.so_line_id,
        lineNo: Number(r.line_no) || 0,
        itemCode: r.item_code,
        itemName: r.item_name,
        orderQty: Number(r.order_qty) || 0,
        materialCost,
        outsourceCost,
        machineTimeCost,
        lineTotal: materialCost + outsourceCost + machineTimeCost,
        ops,
      };
    });

    const detail: SoCostingDetail = {
      soId: head.so_id,
      soNo: head.so_no,
      customer: head.customer,
      costCenter: head.cost_center,
      costCenterName: head.cc_name,
      grandMaterial,
      grandOutsource,
      grandMachineTime,
      grandTotal: grandMaterial + grandOutsource + grandMachineTime,
      lines,
    };
    if (showMoney) return detail;
    return {
      ...detail,
      grandMaterial: null,
      grandOutsource: null,
      grandMachineTime: null,
      grandTotal: null,
      lines: lines.map((l) => ({
        ...l,
        materialCost: null,
        outsourceCost: null,
        machineTimeCost: null,
        lineTotal: null,
        ops: l.ops.map((o) => ({ ...o, outsourceCost: null, machineTimeCost: null })),
      })),
    };
  });
}
