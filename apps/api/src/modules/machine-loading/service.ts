// Machine Loading service (Production Wave 3) — read-only.
//
// GET /machine-loading — per-machine capacity cards + the list of open
// operations. Mirrors legacy renderLoading (HTML L5021) which uses
// calcEngine().machineLoad (L1703-1715) + enrichedOps. Computed here via raw
// SQL against jc_ops ⨝ v_jc_op_status (no view/migration). RLS is applied by
// the base tables under withUserContext.

import { sql } from 'drizzle-orm';
import type {
  MachineLoadCard,
  MachineLoadOp,
  MachineLoadStatus,
  MachineLoadingResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function deriveLoad(pendingHrs: number, dailyCap: number): {
  weekCap: number;
  loadPct: number;
  daysToClear: number;
  loadStatus: MachineLoadStatus;
} {
  const weekCap = dailyCap * 5;
  const loadPct = weekCap > 0 ? pendingHrs / weekCap : 0;
  const daysToClear = dailyCap > 0 ? Number((pendingHrs / dailyCap).toFixed(1)) : 0;
  const loadStatus: MachineLoadStatus =
    loadPct > 1 ? 'Overloaded' : loadPct > 0.7 ? 'High Load' : pendingHrs > 0 ? 'Manageable' : 'Clear';
  return { weekCap, loadPct, daysToClear, loadStatus };
}

export async function getMachineLoading(user: AuthContext): Promise<MachineLoadingResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // ── Per-machine aggregate (cards) ──────────────────────────────────────
    // Sum over the machine's non-outsource ops; a deleted JC's ops are
    // excluded via the jc.id-not-null guard. pendingHrs = available × min/60.
    const cardRows = await tx.execute(sql`
      SELECT
        m.id AS "machineId", m.code AS "machineCode", m.name,
        m.machine_type AS "machineType",
        m.capacity_per_shift AS "capPerShift",
        m.shifts_per_day AS "shiftsPerDay",
        COALESCE(SUM(CASE WHEN jc.id IS NOT NULL THEN vos.available ELSE 0 END), 0)::int
          AS "totalAvailQty",
        COALESCE(SUM(CASE WHEN jc.id IS NOT NULL AND vos.available > 0 THEN 1 ELSE 0 END), 0)::int
          AS "openOps",
        COALESCE(ROUND(SUM(
          CASE WHEN jc.id IS NOT NULL THEN vos.available * jo.cycle_time_min / 60.0 ELSE 0 END
        ), 2), 0) AS "pendingHrs"
      FROM public.machines m
      LEFT JOIN public.jc_ops jo
        ON jo.machine_id = m.id AND jo.deleted_at IS NULL AND jo.op_type <> 'outsource'
      LEFT JOIN public.v_jc_op_status vos ON vos.jc_op_id = jo.id
      LEFT JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      WHERE m.company_id = ${companyId}::uuid AND m.deleted_at IS NULL
      GROUP BY m.id, m.code, m.name, m.machine_type, m.capacity_per_shift, m.shifts_per_day
      ORDER BY m.code
    `);

    const machines: MachineLoadCard[] = (
      cardRows as unknown as Array<Record<string, unknown>>
    ).map((r) => {
      const pendingHrs = Number(r['pendingHrs'] ?? 0);
      const dailyCap = Number(r['capPerShift'] ?? 0) * Number(r['shiftsPerDay'] ?? 0);
      const { weekCap, loadPct, daysToClear, loadStatus } = deriveLoad(pendingHrs, dailyCap);
      return {
        machineId: r['machineId'] as string,
        machineCode: r['machineCode'] as string,
        name: (r['name'] as string | null) ?? '',
        machineType: (r['machineType'] as string | null) ?? null,
        totalAvailQty: Number(r['totalAvailQty'] ?? 0),
        openOps: Number(r['openOps'] ?? 0),
        pendingHrs,
        dailyCap,
        weekCap,
        loadPct,
        daysToClear,
        loadStatus,
      };
    });

    // ── Open operations (operation view + per-machine queue) ───────────────
    // ISSUE-068: the Job Queue View was hiding waiting / qc_pending / running
    // ops. Legacy builds ONE enrichedOps set then applies two DIFFERENT view
    // filters: the Operation View (renderLoading L5060) shows only
    // `available > 0 OR In Progress`, while the Job Queue View (L5081) shows
    // every non-complete, non-outsource op. This query returns the WIDER
    // Job-Queue set (computed_status <> 'complete'); the Operation View
    // re-applies the narrow predicate client-side (see list.tsx filteredOps),
    // so the ops table is unchanged while the queue now surfaces those states.
    // Sort: priority (High first) → due date → op_seq.
    const opRows = await tx.execute(sql`
      SELECT
        jo.id AS "jcOpId", jo.job_card_id AS "jobCardId", jc.code AS "jobCardCode",
        jo.op_seq AS "opSeq", jo.operation, jo.machine_id AS "machineId",
        m.code AS "machineCode",
        i.code AS "itemCode", i.name AS "itemName",
        so.code AS "soCode",
        jc.priority, jc.due_date AS "dueDate", jc.order_qty AS "orderQty",
        vos.completed_qty AS "completedQty", vos.available,
        vos.computed_status AS "computedStatus",
        ROUND(vos.available * jo.cycle_time_min / 60.0, 2) AS "pendingHrs"
      FROM public.jc_ops jo
      JOIN public.v_jc_op_status vos ON vos.jc_op_id = jo.id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = jo.machine_id
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      WHERE jo.company_id = ${companyId}::uuid
        AND jo.deleted_at IS NULL
        AND jo.op_type <> 'outsource'
        AND vos.computed_status <> 'complete'
      ORDER BY (jc.priority = 'high') DESC, jc.due_date ASC NULLS LAST, jo.op_seq ASC
    `);

    const ops: MachineLoadOp[] = (opRows as unknown as Array<Record<string, unknown>>).map((r) => ({
      jcOpId: r['jcOpId'] as string,
      jobCardId: r['jobCardId'] as string,
      jobCardCode: r['jobCardCode'] as string,
      opSeq: Number(r['opSeq']),
      operation: (r['operation'] as string | null) ?? '',
      machineId: (r['machineId'] as string | null) ?? null,
      machineCode: (r['machineCode'] as string | null) ?? null,
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      soCode: (r['soCode'] as string | null) ?? null,
      priority: r['priority'] as MachineLoadOp['priority'],
      dueDate: r['dueDate'] != null ? String(r['dueDate']).slice(0, 10) : null,
      orderQty: Number(r['orderQty'] ?? 0),
      completedQty: Number(r['completedQty'] ?? 0),
      available: Number(r['available'] ?? 0),
      pendingHrs: Number(r['pendingHrs'] ?? 0),
      computedStatus: (r['computedStatus'] as string | null) ?? '',
    }));

    return { machines, ops };
  });
}
