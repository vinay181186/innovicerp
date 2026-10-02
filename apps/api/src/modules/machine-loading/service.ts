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
  MachineLoadStatus,
  MachineLoadingQuery,
  MachineLoadingResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { allOpenOps, pagedOpenOps } from './ops-query';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function deriveLoad(
  pendingHrs: number,
  dailyCap: number,
): {
  weekCap: number;
  loadPct: number;
  daysToClear: number;
  loadStatus: MachineLoadStatus;
} {
  const weekCap = dailyCap * 5;
  const loadPct = weekCap > 0 ? pendingHrs / weekCap : 0;
  const daysToClear = dailyCap > 0 ? Number((pendingHrs / dailyCap).toFixed(1)) : 0;
  const loadStatus: MachineLoadStatus =
    loadPct > 1
      ? 'Overloaded'
      : loadPct > 0.7
        ? 'High Load'
        : pendingHrs > 0
          ? 'Manageable'
          : 'Clear';
  return { weekCap, loadPct, daysToClear, loadStatus };
}

export async function getMachineLoading(
  user: AuthContext,
  input: MachineLoadingQuery = {},
): Promise<MachineLoadingResponse> {
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

    const machines: MachineLoadCard[] = (cardRows as unknown as Array<Record<string, unknown>>).map(
      (r) => {
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
      },
    );

    // ── Open operations ────────────────────────────────────────────────────
    // ISSUE-068: the query returns the WIDER Job-Queue set (computed_status <>
    // 'complete'). Whole-board call: every op, as before (the Operation View
    // narrows it). Paged call (ADR-201): the server applies the machine pick,
    // search, the Operation-View scope and Sort & Filter, and pages it.
    if (input.limit == null) {
      return { machines, ops: await allOpenOps(tx, companyId) };
    }
    const page = await pagedOpenOps(tx, companyId, { ...input, limit: input.limit });
    return { machines, ops: page.ops, total: page.total };
  });
}
