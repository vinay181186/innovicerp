// Job Queue — the one place the per-machine pending queue is read (Production
// slice F). Split from service.ts so the paged view (ADR-201) and the server
// ▲/▼ move read EXACTLY the same queue, in the same order, as the screen.
//
// "Pending" = jc_op with computed_status NOT IN ('complete') AND op_type
// <> 'outsource'. Order: queue_position ASC NULLS LAST, op_seq ASC, then the
// op id so the order is total (a page never repeats or skips a row).

import { sql } from 'drizzle-orm';
import type { JobQueueMachine, JobQueueRow } from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';

export function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Every machine (or just `machineId`) with its FULL pending queue in order. */
export async function loadMachineQueues(
  tx: DbTransaction,
  companyId: string,
  machineId?: string,
): Promise<JobQueueMachine[]> {
  const input = { machineId };
  const machineFrag = input.machineId ? sql`AND id = ${input.machineId}::uuid` : sql``;

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
        op.machine_id AS "machineId",
        op.machine_code_text AS "machineCodeText",
        op.op_type AS "opType",
        i.code AS "itemCode",
        -- The customer's drawing revision, read live off the SO line the card was
        -- raised against. Deliberately not items.revision, which describes the item
        -- master. sol is LEFT JOINed below, so JW-sourced and standalone cards
        -- return null and print as the bare code.
        --
        -- Cast to text deliberately: this is typed as a string, yet a database that
        -- has not had migration 0119 still stores an integer and would send the
        -- queue a number. Harmless once 0119 is in.
        COALESCE(sol.revision::text, jwl.revision::text) AS "itemRevision",
        -- POL = the line number printed on the CUSTOMER's own purchase order,
        -- off the same SO line as the revision above. SO side only: a job-work
        -- line has no customer PO, so JW-sourced cards are correctly null.
        sol.client_po_line_no AS "clientPoLineNo",
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
        (COALESCE(op.cycle_time_min, 0) * COALESCE(s.available, 0) / 60.0) AS "pendingHrsRow",
        -- Who actually made the completed qty, per machine (0095 / ADR-126). The
        -- row is bucketed under the op's CURRENT machine — where the REMAINING
        -- qty runs — so on a re-routed op the queue it sits in did not make the
        -- Done figure beside it. This is the honest breakdown.
        COALESCE(mo.machines, '[]'::json) AS "machines"
      FROM public.jc_ops op
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.clients cl_so ON cl_so.id = so.client_id AND cl_so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.clients cl_jw ON cl_jw.id = jw.client_id AND cl_jw.deleted_at IS NULL
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      LEFT JOIN LATERAL (
        SELECT json_agg(
                 json_build_object('machineCode', v.machine_code, 'qty', v.completed_qty)
                 ORDER BY v.completed_qty DESC, v.machine_code
               ) AS machines
        FROM public.v_op_machine_output v
        WHERE v.jc_op_id = op.id
      ) mo ON true
      WHERE op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
        AND (op.machine_id IS NOT NULL OR op.machine_code_text IS NOT NULL)
        AND op.op_type <> 'outsource'
        AND COALESCE(s.computed_status, 'waiting') <> 'complete'
      ORDER BY
        op.queue_position ASC NULLS LAST,
        op.op_seq ASC,
        op.id ASC
    `)) as unknown as Array<Record<string, unknown>>;

  // Resolve each op to its EFFECTIVE machine: the resolved FK when present,
  // else the machine whose code matches machine_code_text. Plan/route-sourced
  // ops legitimately carry the machine as text only (ADR-012 #10 fallback), so
  // without this they never appear in any machine queue even though the Job
  // Card exists. Resolution is done here in JS (not SQL) against the already
  // loaded machine list. QC ops (machine_code_text = 'QC') resolve to nothing
  // and are skipped.
  const codeToId = new Map(machineRows.map((m) => [m.code, m.id]));
  const byMachine = new Map<string, { rows: JobQueueRow[]; pendingHrs: number }>();
  for (const r of rows) {
    if (String(r['opType'] ?? '') === 'qc') continue;
    const fkId = (r['machineId'] as string | null) ?? null;
    const codeId = codeToId.get(String(r['machineCodeText'] ?? '')) ?? null;
    const mid = fkId ?? codeId;
    if (!mid) continue;
    if (!byMachine.has(mid)) byMachine.set(mid, { rows: [], pendingHrs: 0 });
    const grp = byMachine.get(mid)!;
    grp.pendingHrs += num(r['pendingHrsRow']);
    grp.rows.push({
      jcOpId: r['jcOpId'] as string,
      jcId: r['jcId'] as string,
      jcCode: String(r['jcCode'] ?? ''),
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemRevision: (r['itemRevision'] as string | null) ?? null,
      clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      soCode: (r['soCode'] as string | null) ?? null,
      soCustomer: (r['soCustomer'] as string | null) ?? null,
      opSeq: num(r['opSeq']),
      operation: String(r['operation'] ?? ''),
      priority: String(r['priority'] ?? 'normal'),
      dueDate: (r['dueDate'] as string | null) ?? null,
      orderQty: num(r['orderQty']),
      completed: num(r['completed']),
      machines: ((r['machines'] as Array<{ machineCode: string; qty: unknown }> | null) ?? []).map(
        (v) => ({ machineCode: String(v.machineCode), qty: num(v.qty) }),
      ),
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

  return machines;
}
