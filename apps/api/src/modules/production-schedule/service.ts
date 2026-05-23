// Production Schedule (Gantt) service (Production slice G).
//
// 30-day Gantt grid, one row per machine, bars from jc_ops.planned_start /
// planned_end. Mirrors legacy renderProductionSchedule (HTML L15588) +
// `_psComputeStats` (color buckets).
//
// Color buckets (per legacy `_psBarColor`):
//   - done    : op status = 'complete'
//   - running : an active running_ops record exists
//   - ok      : planned_end + 2 days <= due_date (>2-day buffer)
//   - tight   : 0 <= due_date - planned_end <= 2 (tight buffer)
//   - at_risk : planned_end > due_date (will miss)
//   default ok if no due date.
//
// Filter modes:
//   all      : every op with planned_start (default)
//   active   : status in ('running','available','in_progress','waiting')
//   history  : status='complete' OR planned_end < today
//   future   : planned_start >= today AND status NOT IN ('complete','running')

import { sql } from 'drizzle-orm';
import type {
  ProductionScheduleMachine,
  ProductionScheduleQuery,
  ProductionScheduleResponse,
  ProductionScheduleStats,
  RescheduleJcOpInput,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateLike(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function colorFor(args: {
  status: string;
  isRunning: boolean;
  plannedEnd: string;
  dueDate: string | null;
}): 'ok' | 'tight' | 'at_risk' | 'running' | 'done' {
  if (args.status === 'complete') return 'done';
  if (args.isRunning) return 'running';
  if (args.dueDate) {
    const buf = daysBetween(args.plannedEnd, args.dueDate);
    if (buf < 0) return 'at_risk';
    if (buf <= 2) return 'tight';
  }
  return 'ok';
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  return Math.floor((db - da) / 86400000);
}

export async function getProductionSchedule(
  input: ProductionScheduleQuery,
  user: AuthContext,
): Promise<ProductionScheduleResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const startDate = input.startDate ?? todayIso();
    const endDate = addDays(startDate, 30);
    const today = todayIso();

    const machineRows = (await tx.execute(sql`
      SELECT id, code, name, type
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

    let filterFrag = sql``;
    if (input.filter === 'active') {
      filterFrag = sql`AND COALESCE(s.computed_status, 'waiting') IN ('running','available','in_progress','waiting')`;
    } else if (input.filter === 'history') {
      filterFrag = sql`AND (COALESCE(s.computed_status, 'waiting') = 'complete' OR op.planned_end < ${today}::date)`;
    } else if (input.filter === 'future') {
      filterFrag = sql`AND op.planned_start >= ${today}::date AND COALESCE(s.computed_status, 'waiting') NOT IN ('complete','running')`;
    }

    const barRows = (await tx.execute(sql`
      SELECT
        op.id AS "jcOpId",
        jc.id AS "jcId",
        jc.code AS "jcCode",
        op.op_seq AS "opSeq",
        op.operation,
        op.machine_id AS "machineId",
        COALESCE(i.code, jc.item_code_text) AS "itemCode",
        op.planned_start AS "plannedStart",
        op.planned_end AS "plannedEnd",
        jc.due_date AS "dueDate",
        COALESCE(s.computed_status, 'waiting') AS "status",
        EXISTS (
          SELECT 1 FROM public.running_ops ro
          WHERE ro.jc_op_id = op.id AND ro.status = 'running'
        ) AS "isRunning"
      FROM public.jc_ops op
      JOIN public.job_cards jc ON jc.id = op.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      WHERE op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
        AND op.machine_id IS NOT NULL
        AND op.planned_start IS NOT NULL
        AND op.planned_end IS NOT NULL
        AND op.planned_start <= ${endDate}::date
        AND op.planned_end >= ${startDate}::date
        ${filterFrag}
      ORDER BY op.machine_id, op.planned_start, op.op_seq
    `)) as unknown as Array<Record<string, unknown>>;

    const stats: ProductionScheduleStats = {
      total: 0,
      onSchedule: 0,
      tight: 0,
      atRisk: 0,
      running: 0,
      unscheduled: 0,
    };

    const byMachine = new Map<string, ProductionScheduleMachine>();
    for (const r of barRows) {
      const mid = r['machineId'] as string;
      const machine = machineRows.find((m) => m.id === mid);
      if (!machine) continue;

      const plannedStart = dateLike(r['plannedStart']);
      const plannedEnd = dateLike(r['plannedEnd']);
      const dueDate = r['dueDate'] != null ? dateLike(r['dueDate']) : null;
      const status = String(r['status'] ?? 'waiting');
      const isRunning = Boolean(r['isRunning']);
      const kind = colorFor({ status, isRunning, plannedEnd, dueDate });

      stats.total += 1;
      if (kind === 'ok') stats.onSchedule += 1;
      else if (kind === 'tight') stats.tight += 1;
      else if (kind === 'at_risk') stats.atRisk += 1;
      else if (kind === 'running') stats.running += 1;

      const bar = {
        jcOpId: r['jcOpId'] as string,
        jcId: r['jcId'] as string,
        jcCode: String(r['jcCode'] ?? ''),
        opSeq: Number(r['opSeq'] ?? 0),
        operation: String(r['operation'] ?? ''),
        itemCode: (r['itemCode'] as string | null) ?? null,
        plannedStart,
        plannedEnd,
        dueDate,
        status,
        colorKind: kind,
      };

      if (!byMachine.has(mid)) {
        byMachine.set(mid, {
          machineId: mid,
          machineCode: machine.code,
          machineName: machine.name,
          machineType: machine.type,
          bars: [],
        });
      }
      byMachine.get(mid)!.bars.push(bar);
    }

    // Unscheduled ops count — ops with no planned_start within the window
    const unschedRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM public.jc_ops op
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      WHERE op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
        AND op.machine_id IS NOT NULL
        AND op.planned_start IS NULL
        AND COALESCE(s.computed_status, 'waiting') <> 'complete'
    `)) as unknown as Array<{ cnt: number }>;
    stats.unscheduled = Number(unschedRows[0]?.cnt ?? 0);

    return {
      startDate,
      filter: input.filter,
      machines: Array.from(byMachine.values()),
      stats,
    };
  });
}

export async function rescheduleJcOp(
  jcOpId: string,
  input: RescheduleJcOpInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  const userId = user.id;

  if (input.plannedEnd && input.plannedEnd < input.plannedStart) {
    throw new ValidationError('plannedEnd cannot be before plannedStart');
  }

  return withUserContext(user, async (tx) => {
    const opRows = (await tx.execute(sql`
      SELECT op.id, op.planned_start, op.planned_end, COALESCE(s.computed_status, 'waiting') AS status
      FROM public.jc_ops op
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = op.id
      WHERE op.id = ${jcOpId}::uuid
        AND op.company_id = ${companyId}::uuid
        AND op.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{
      planned_start: string | null;
      planned_end: string | null;
      status: string;
    }>;
    const op = opRows[0];
    if (!op) throw new NotFoundError(`JC operation ${jcOpId} not found`);
    if (op.status === 'complete') {
      throw new ConflictError('Cannot reschedule a completed operation.');
    }

    // Verify target machine exists in company
    const machRows = (await tx.execute(sql`
      SELECT id, code FROM public.machines
      WHERE id = ${input.machineId}::uuid
        AND company_id = ${companyId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ id: string; code: string }>;
    if (!machRows[0]) throw new NotFoundError(`Machine ${input.machineId} not found`);

    // Compute plannedEnd: keep span if not provided
    let plannedEnd = input.plannedEnd;
    if (!plannedEnd) {
      if (op.planned_start && op.planned_end) {
        const oldSpan = daysBetween(dateLike(op.planned_start), dateLike(op.planned_end));
        plannedEnd = addDays(input.plannedStart, Math.max(0, oldSpan));
      } else {
        plannedEnd = input.plannedStart;
      }
    }

    await tx.execute(sql`
      UPDATE public.jc_ops
      SET machine_id = ${input.machineId}::uuid,
          machine_code_text = ${machRows[0].code},
          planned_start = ${input.plannedStart}::date,
          planned_end = ${plannedEnd}::date,
          updated_at = now(),
          updated_by = ${userId}::uuid
      WHERE id = ${jcOpId}::uuid
        AND company_id = ${companyId}::uuid
    `);

    return { ok: true };
  });
}
