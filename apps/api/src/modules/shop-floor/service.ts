// Shop Floor service (Production slice E).
//
// Live `running_ops` (status='running') grouped by machine. Mirrors legacy
// renderShopFloor (HTML L10286). Each machine row enriches with the
// associated JC + item + SO + completion qty.

import { sql } from 'drizzle-orm';
import type {
  ShopFloorMachine,
  ShopFloorResponse,
  ShopFloorRunningRow,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateLike(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function timeLike(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

export async function getShopFloor(user: AuthContext): Promise<ShopFloorResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const machineRows = (await tx.execute(sql`
      SELECT id, code, name, machine_type AS type
      FROM public.machines
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
      ORDER BY code
    `)) as unknown as Array<{
      id: string;
      code: string;
      name: string | null;
      type: string | null;
    }>;

    const runningRows = (await tx.execute(sql`
      SELECT
        ro.id AS "runningOpId",
        ro.machine_id AS "machineId",
        op.id AS "jcOpId",
        jc.id AS "jcId",
        jc.code AS "jcCode",
        op.op_seq AS "opSeq",
        op.operation,
        i.code AS "itemCode",
        i.name AS "itemName",
        COALESCE(so.code, jw.code) AS "soCode",
        jc.order_qty AS "orderQty",
        COALESCE(s.completed_qty, 0)::int AS "doneQty",
        GREATEST(0, jc.order_qty - COALESCE(s.completed_qty, 0))::int AS "pendingQty",
        COALESCE(jc.priority::text, 'normal') AS priority,
        jc.due_date AS "dueDate",
        ro.operator_name AS "operatorName",
        ro.start_date AS "startDate",
        ro.start_time AS "startTime"
      FROM public.running_ops ro
      JOIN public.jc_ops op ON op.id = ro.jc_op_id AND op.deleted_at IS NULL
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      WHERE ro.company_id = ${companyId}::uuid
        AND ro.status = 'running'
      ORDER BY ro.start_date DESC, ro.start_time DESC
    `)) as unknown as Array<Record<string, unknown>>;

    const byMachine = new Map<string, ShopFloorRunningRow[]>();
    for (const r of runningRows) {
      const mid = r['machineId'] as string | null;
      if (!mid) continue;
      const row: ShopFloorRunningRow = {
        runningOpId: r['runningOpId'] as string,
        jcOpId: r['jcOpId'] as string,
        jcId: (r['jcId'] as string | null) ?? null,
        jcCode: String(r['jcCode'] ?? ''),
        opSeq: num(r['opSeq']),
        operation: String(r['operation'] ?? ''),
        itemCode: (r['itemCode'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? null,
        soCode: (r['soCode'] as string | null) ?? null,
        orderQty: num(r['orderQty']),
        doneQty: num(r['doneQty']),
        pendingQty: num(r['pendingQty']),
        priority: String(r['priority'] ?? 'normal'),
        dueDate: r['dueDate'] != null ? dateLike(r['dueDate']) : null,
        operatorName: (r['operatorName'] as string | null) ?? null,
        startDate: dateLike(r['startDate']),
        startTime: timeLike(r['startTime']),
      };
      if (!byMachine.has(mid)) byMachine.set(mid, []);
      byMachine.get(mid)!.push(row);
    }

    const machines: ShopFloorMachine[] = machineRows.map((m) => {
      const rows = byMachine.get(m.id) ?? [];
      return {
        machineId: m.id,
        machineCode: m.code,
        machineName: m.name,
        machineType: m.type,
        runningCount: rows.length,
        rows,
      };
    });

    const total = machines.reduce((s, m) => s + m.runningCount, 0);
    return { total, machines };
  });
}

export async function stopRunningOp(
  runningOpId: string,
  user: AuthContext,
): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, status FROM public.running_ops
      WHERE id = ${runningOpId}::uuid
        AND company_id = ${companyId}::uuid
      LIMIT 1
    `)) as unknown as Array<{ id: string; status: string }>;
    const r = rows[0];
    if (!r) throw new NotFoundError(`Running op ${runningOpId} not found`);
    if (r.status !== 'running') {
      throw new ConflictError(`Running op already ${r.status}`);
    }
    await tx.execute(sql`
      UPDATE public.running_ops
      SET status = 'done',
          ended_at = now(),
          updated_at = now(),
          updated_by = ${userId}::uuid
      WHERE id = ${runningOpId}::uuid
    `);
    return { ok: true };
  });
}
