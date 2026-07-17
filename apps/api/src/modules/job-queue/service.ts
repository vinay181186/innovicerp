// Job Queue service (Production slice F).
//
// Pending ops per machine, manually reorderable. Mirrors legacy renderJobQueue
// (HTML L10363) + applyQueueOrder + moveInQueue.
//
// "Pending" = jc_op with computed_status NOT IN ('complete') AND op_type
// <> 'outsource'. Sort order: queue_position ASC NULLS LAST, then op_seq ASC.

import { sql } from 'drizzle-orm';
import type {
  JobQueueMachine,
  JobQueueQuery,
  JobQueueResponse,
  JobQueueRow,
  ReorderJobQueueInput,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getJobQueue(
  input: JobQueueQuery,
  user: AuthContext,
): Promise<JobQueueResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const machineFrag = input.machineId
      ? sql`AND m.id = ${input.machineId}::uuid`
      : sql``;

    const machineRows = (await tx.execute(sql`
      SELECT id, code, name, machine_type AS type
      FROM public.machines
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
        ${machineFrag}
      ORDER BY code
    `)) as unknown as Array<{
      id: string;
      code: string;
      name: string | null;
      type: string | null;
    }>;

    const rows = (await tx.execute(sql`
      SELECT
        op.id AS "jcOpId",
        jc.id AS "jcId",
        jc.code AS "jcCode",
        -- Effective machine: the resolved FK when present, else the machine
        -- resolved from machine_code_text. Plan/route-sourced ops may carry the
        -- machine as text only (ADR-012 #10 fallback); without this they were
        -- silently dropped from every machine's queue.
        COALESCE(op.machine_id, mbc.id) AS "machineId",
        i.code AS "itemCode",
        i.name AS "itemName",
        COALESCE(so.code, jw.code) AS "soCode",
        COALESCE(cl_so.name, cl_jw.name, so.customer_name, jw.customer_name) AS "soCustomer",
        op.op_seq AS "opSeq",
        op.operation,
        COALESCE(jc.priority::text, 'normal') AS priority,
        jc.due_date AS "dueDate",
        jc.order_qty AS "orderQty",
        COALESCE(s.completed_qty, 0)::int AS "completed",
        COALESCE(s.available, 0)::int AS "available",
        COALESCE(s.computed_status, 'waiting') AS "status",
        EXISTS (
          SELECT 1 FROM public.running_ops ro
          WHERE ro.jc_op_id = op.id AND ro.status = 'running'
        ) AS "isRunning",
        op.queue_position AS "queuePosition",
        (COALESCE(op.cycle_time_min, 0) * COALESCE(s.available, 0) / 60.0) AS "pendingHrsRow"
      FROM public.jc_ops op
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.clients cl_so ON cl_so.id = so.client_id AND cl_so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.machines mbc ON mbc.company_id = op.company_id
        AND mbc.deleted_at IS NULL AND mbc.code = op.machine_code_text
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      WHERE op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
        AND op.op_type = 'process'
        AND COALESCE(op.machine_id, mbc.id) IS NOT NULL
        AND COALESCE(s.computed_status, 'waiting') <> 'complete'
      ORDER BY
        COALESCE(op.machine_id, mbc.id),
        op.queue_position ASC NULLS LAST,
        op.op_seq ASC
    `)) as unknown as Array<Record<string, unknown>>;

    const byMachine = new Map<string, { rows: JobQueueRow[]; pendingHrs: number }>();
    for (const r of rows) {
      const mid = r['machineId'] as string;
      if (!byMachine.has(mid)) byMachine.set(mid, { rows: [], pendingHrs: 0 });
      const grp = byMachine.get(mid)!;
      grp.pendingHrs += num(r['pendingHrsRow']);
      grp.rows.push({
        jcOpId: r['jcOpId'] as string,
        jcId: r['jcId'] as string,
        jcCode: String(r['jcCode'] ?? ''),
        itemCode: (r['itemCode'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? null,
        soCode: (r['soCode'] as string | null) ?? null,
        soCustomer: (r['soCustomer'] as string | null) ?? null,
        opSeq: num(r['opSeq']),
        operation: String(r['operation'] ?? ''),
        priority: String(r['priority'] ?? 'normal'),
        dueDate: (r['dueDate'] as string | null) ?? null,
        orderQty: num(r['orderQty']),
        completed: num(r['completed']),
        available: num(r['available']),
        status: String(r['status'] ?? 'waiting'),
        isRunning: Boolean(r['isRunning']),
        queuePosition: r['queuePosition'] != null ? num(r['queuePosition']) : null,
      });
    }

    const machines: JobQueueMachine[] = machineRows.map((m) => {
      const grp = byMachine.get(m.id) ?? { rows: [], pendingHrs: 0 };
      const runningCount = grp.rows.filter((r) => r.isRunning).length;
      return {
        machineId: m.id,
        machineCode: m.code,
        machineName: m.name,
        machineType: m.type,
        pendingHrs: Math.round(grp.pendingHrs * 100) / 100,
        runningCount,
        pendingCount: grp.rows.length,
        rows: grp.rows,
      };
    });

    return { machines };
  });
}

export async function reorderMachineQueue(
  machineId: string,
  input: ReorderJobQueueInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    // Verify machine exists in this company
    const machineRows = (await tx.execute(sql`
      SELECT id FROM public.machines
      WHERE id = ${machineId}::uuid
        AND company_id = ${companyId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    if (!machineRows[0]) throw new NotFoundError(`Machine ${machineId} not found`);

    // Verify all op ids belong to this machine + company
    const placeholders = input.jcOpIds.map(() => sql`?::uuid`);
    const idArr = sql`ARRAY[${sql.join(
      input.jcOpIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`;
    void placeholders;
    // Match ops by EFFECTIVE machine (resolved FK, or machine_code_text → machine)
    // so text-only-machine ops surfaced by the queue can also be reordered.
    const opRows = (await tx.execute(sql`
      SELECT op.id
      FROM public.jc_ops op
      LEFT JOIN public.machines mbc ON mbc.company_id = op.company_id
        AND mbc.deleted_at IS NULL AND mbc.code = op.machine_code_text
      WHERE op.id = ANY(${idArr})
        AND op.company_id = ${companyId}::uuid
        AND COALESCE(op.machine_id, mbc.id) = ${machineId}::uuid
        AND op.deleted_at IS NULL
    `)) as unknown as Array<{ id: string }>;
    if (opRows.length !== input.jcOpIds.length) {
      throw new ConflictError(
        `One or more jc_op ids are not on machine ${machineId} (or already deleted).`,
      );
    }

    // Assign queue_position 1..N
    for (let i = 0; i < input.jcOpIds.length; i++) {
      const opId = input.jcOpIds[i]!;
      const pos = i + 1;
      await tx.execute(sql`
        UPDATE public.jc_ops
        SET queue_position = ${pos},
            updated_at = now(),
            updated_by = ${userId}::uuid
        WHERE id = ${opId}::uuid
          AND company_id = ${companyId}::uuid
      `);
    }

    return { ok: true };
  });
}
