// QC Command Center service. Mirrors legacy renderQCCommandCenter (HTML
// L18613) + its helpers _qccQueueData / _qccFPYData / _qccPickUp / _qccAssign.
//
// getQcCommand — one aggregate read:
//   • queue   — pending QC ops enriched with attempt no. + assignment (legacy _qccQueueData)
//   • fpy     — First-Pass Yield by operation / inspector / item (legacy _qccFPYData)
//   • rework  — ops inspected more than once or with rejects (legacy _qccRenderRework)
//   • stats   — strip counters
//   • inspectors — active users for the Assign modal
//
// FPY + rework derive a per-op QC-attempt history by grouping op_log rows
// (log_type='qc') on jc_op_id, ordered by date. A group is "first-pass" when
// it has exactly one QC entry with zero rejects (legacy rule, L18339-18342).
//
// pickUpQc / assignQc — write qc_assignments (migration 0040). Pick-Up assigns
// to the caller (any QC writer); Assign-to-another is admin-only.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  QcAssignInput,
  QcAssignmentResult,
  QcCommandResponse,
  QcCommandQueueRow,
  QcFpyGroupRow,
  QcFpyItemRow,
  QcInspectorOption,
  QcPickUpInput,
  QcReworkRow,
  UserRole,
} from '@innovic/shared';
import { qcAssignments } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

const QC_WRITERS: readonly UserRole[] = ['admin', 'manager', 'qc'];

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function daysBetween(fromIso: string | null, toIso: string): number {
  if (!fromIso) return 0;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

interface PendingDbRow {
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  operation: string | null;
  itemCode: string | null;
  soCode: string | null;
  customer: string | null;
  dueDate: unknown;
  qcPending: number;
  lastComplete: unknown;
  jcCreatedAt: unknown;
}

interface QcLogDbRow {
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  operation: string | null;
  itemCode: string | null;
  itemName: string | null;
  soCode: string | null;
  qty: number;
  rejectQty: number;
  logDate: unknown;
  inspector: string;
}

interface OpGroup {
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  operation: string;
  itemCode: string | null;
  itemName: string | null;
  soCode: string | null;
  entries: QcLogDbRow[];
}

function pct(passed: number, total: number): number {
  return total > 0 ? Math.round((passed / total) * 100) : 0;
}

export async function getQcCommand(user: AuthContext): Promise<QcCommandResponse> {
  const companyId = requireCompany(user);
  const today = new Date().toISOString().slice(0, 10);

  return withUserContext(user, async (tx) => {
    const [pendingRes, logRes, assignRes, inspectorRes] = await Promise.all([
      // 1. Pending QC ops (the queue base).
      tx.execute(sql`
        SELECT
          vos.jc_op_id AS "jcOpId", jc.code AS "jcCode", vos.op_seq AS "opSeq",
          jo.operation, i.code AS "itemCode", so.code AS "soCode",
          so.customer_name AS "customer", jc.due_date AS "dueDate",
          vos.qc_pending AS "qcPending",
          (SELECT MAX(ol.log_date) FROM public.op_log ol
            WHERE ol.jc_op_id = vos.jc_op_id AND ol.log_type = 'complete') AS "lastComplete",
          jc.created_at AS "jcCreatedAt"
        FROM public.v_jc_op_status vos
        JOIN public.jc_ops jo ON jo.id = vos.jc_op_id AND jo.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = vos.job_card_id AND jc.deleted_at IS NULL
        LEFT JOIN public.items i ON i.id = jc.item_id
        LEFT JOIN public.sales_order_lines sol
          ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
        LEFT JOIN public.sales_orders so
          ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
        WHERE vos.company_id = ${companyId}::uuid
          AND (vos.qc_required OR vos.op_type = 'qc')
          AND vos.qc_pending > 0
        ORDER BY jc.code, vos.op_seq
      `),

      // 2. Every QC op_log row (for attempt counts, FPY, rework). Ordered so
      // each op's entries arrive oldest-first — entry[0] is the first attempt.
      tx.execute(sql`
        SELECT
          l.jc_op_id AS "jcOpId", jc.code AS "jcCode", jo.op_seq AS "opSeq",
          jo.operation, i.code AS "itemCode", i.name AS "itemName", so.code AS "soCode",
          l.qty AS "qty", l.reject_qty AS "rejectQty", l.log_date AS "logDate",
          COALESCE(NULLIF(l.operator_name, ''), '(unknown)') AS "inspector"
        FROM public.op_log l
        JOIN public.jc_ops jo ON jo.id = l.jc_op_id AND jo.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
        LEFT JOIN public.items i ON i.id = jc.item_id
        LEFT JOIN public.sales_order_lines sol
          ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
        LEFT JOIN public.sales_orders so
          ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
        WHERE l.company_id = ${companyId}::uuid AND l.log_type = 'qc'
        ORDER BY l.jc_op_id, l.log_date, l.id
      `),

      // 3. Active assignments → queue "Assigned To".
      tx.execute(sql`
        SELECT jc_op_id AS "jcOpId", inspector_name AS "inspectorName"
        FROM public.qc_assignments
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      `),

      // 4. Active users → Assign modal options.
      tx.execute(sql`
        SELECT id, COALESCE(NULLIF(full_name, ''), email) AS "name", role::text AS "role"
        FROM public.users
        WHERE company_id = ${companyId}::uuid AND is_active = true AND deleted_at IS NULL
        ORDER BY "name"
      `),
    ]);

    const logs = logRes as unknown as QcLogDbRow[];
    const assignments = assignRes as unknown as Array<{ jcOpId: string; inspectorName: string }>;
    const assignMap = new Map(assignments.map((a) => [a.jcOpId, a.inspectorName]));

    // ── Group QC logs by op ──
    const groups = new Map<string, OpGroup>();
    for (const r of logs) {
      let g = groups.get(r.jcOpId);
      if (!g) {
        g = {
          jcOpId: r.jcOpId,
          jcCode: r.jcCode,
          opSeq: Number(r.opSeq),
          operation: r.operation ?? `Op ${r.opSeq}`,
          itemCode: r.itemCode ?? null,
          itemName: r.itemName ?? null,
          soCode: r.soCode ?? null,
          entries: [],
        };
        groups.set(r.jcOpId, g);
      }
      g.entries.push(r);
    }
    const attemptByOp = new Map<string, number>();
    for (const g of groups.values()) attemptByOp.set(g.jcOpId, g.entries.length);

    // ── Queue ──
    const queue: QcCommandQueueRow[] = (pendingRes as unknown as PendingDbRow[]).map((r) => {
      const since = dateOnly(r.lastComplete) ?? dateOnly(r.jcCreatedAt);
      const dueDate = dateOnly(r.dueDate);
      return {
        jcOpId: r.jcOpId,
        jcCode: r.jcCode,
        opSeq: Number(r.opSeq),
        operation: r.operation ?? '',
        itemCode: r.itemCode ?? null,
        soCode: r.soCode ?? null,
        customer: r.customer ?? null,
        pendingQty: Number(r.qcPending ?? 0),
        ageDays: daysBetween(since, today),
        attemptNo: (attemptByOp.get(r.jcOpId) ?? 0) + 1,
        isOverdue: dueDate !== null && dueDate < today,
        dueDate,
        assignedTo: assignMap.get(r.jcOpId) ?? null,
      };
    });

    // ── First-Pass Yield ──
    const allGroups = [...groups.values()];
    const isFirstPass = (g: OpGroup): boolean =>
      g.entries.length === 1 && Number(g.entries[0]!.rejectQty) === 0;
    const fpyTotal = allGroups.length;
    const fpyPassed = allGroups.filter(isFirstPass).length;

    const byOpAcc = new Map<string, { total: number; passed: number }>();
    const byInspAcc = new Map<string, { total: number; passed: number }>();
    const byItemAcc = new Map<string, { name: string; total: number; passed: number }>();
    for (const g of allGroups) {
      const ok = isFirstPass(g);
      const op = byOpAcc.get(g.operation) ?? { total: 0, passed: 0 };
      op.total += 1;
      if (ok) op.passed += 1;
      byOpAcc.set(g.operation, op);

      const insp = g.entries[0]!.inspector;
      const ip = byInspAcc.get(insp) ?? { total: 0, passed: 0 };
      ip.total += 1;
      if (ok) ip.passed += 1;
      byInspAcc.set(insp, ip);

      const code = g.itemCode ?? '—';
      const it = byItemAcc.get(code) ?? { name: g.itemName ?? '', total: 0, passed: 0 };
      it.total += 1;
      if (ok) it.passed += 1;
      byItemAcc.set(code, it);
    }
    const toGroupRows = (m: Map<string, { total: number; passed: number }>): QcFpyGroupRow[] =>
      [...m.entries()]
        .map(([name, v]) => ({ name, total: v.total, passed: v.passed, pct: pct(v.passed, v.total) }))
        .sort((a, b) => a.pct - b.pct);
    const byItem: QcFpyItemRow[] = [...byItemAcc.entries()]
      .map(([code, v]) => ({ code, name: v.name, total: v.total, passed: v.passed, pct: pct(v.passed, v.total) }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 10);

    // ── Rework ──
    const rework: QcReworkRow[] = allGroups
      .filter((g) => g.entries.length > 1 || Number(g.entries[0]!.rejectQty) > 0)
      .map((g) => {
        const first = dateOnly(g.entries[0]!.logDate);
        const last = dateOnly(g.entries[g.entries.length - 1]!.logDate);
        return {
          jcOpId: g.jcOpId,
          jcCode: g.jcCode,
          opSeq: g.opSeq,
          operation: g.operation,
          itemCode: g.itemCode,
          soCode: g.soCode,
          attempts: g.entries.length,
          totalRejected: g.entries.reduce((s, e) => s + Number(e.rejectQty), 0),
          firstEntry: first,
          lastEntry: last,
          daysElapsed: daysBetween(first, last ?? today),
        };
      })
      .sort((a, b) => b.attempts - a.attempts);

    const inspectors = inspectorRes as unknown as QcInspectorOption[];

    return {
      stats: {
        pendingOps: queue.length,
        overdue: queue.filter((q) => q.isOverdue).length,
        oldestAgeDays: queue.reduce((m, q) => Math.max(m, q.ageDays), 0),
        reworkItems: queue.filter((q) => q.attemptNo > 1).length,
        fpyPct: pct(fpyPassed, fpyTotal),
      },
      queue,
      fpy: {
        overallPct: pct(fpyPassed, fpyTotal),
        total: fpyTotal,
        passed: fpyPassed,
        byOperation: toGroupRows(byOpAcc),
        byInspector: [...byInspAcc.entries()]
          .map(([name, v]) => ({ name, total: v.total, passed: v.passed, pct: pct(v.passed, v.total) }))
          .sort((a, b) => b.total - a.total),
        byItem,
      },
      rework,
      inspectors,
    };
  });
}

/** Resolves a user's display name (full_name, falling back to email). */
async function userName(tx: DbTransaction, userId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(full_name, ''), email) AS "name"
    FROM public.users WHERE id = ${userId}::uuid
  `)) as unknown as Array<{ name: string }>;
  return rows[0]?.name ?? 'Unknown';
}

/** Verifies the jc_op exists in the caller's company; throws NotFound otherwise. */
async function assertOpInCompany(
  tx: DbTransaction,
  companyId: string,
  jcOpId: string,
): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM public.jc_ops
    WHERE id = ${jcOpId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as unknown[];
  if (rows.length === 0) throw new NotFoundError(`Operation ${jcOpId} not found`);
}

/** Upserts the single active assignment for an op (insert, or update if present). */
async function upsertAssignment(
  tx: DbTransaction,
  args: {
    companyId: string;
    jcOpId: string;
    inspectorUserId: string;
    inspectorName: string;
    note: string | null;
    assignedByText: string | null;
    userId: string;
  },
): Promise<void> {
  const existing = await tx
    .select({ id: qcAssignments.id })
    .from(qcAssignments)
    .where(
      and(
        eq(qcAssignments.companyId, args.companyId),
        eq(qcAssignments.jcOpId, args.jcOpId),
        isNull(qcAssignments.deletedAt),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await tx
      .update(qcAssignments)
      .set({
        inspectorUserId: args.inspectorUserId,
        inspectorName: args.inspectorName,
        note: args.note,
        assignedByText: args.assignedByText,
        updatedBy: args.userId,
        updatedAt: new Date(),
      })
      .where(eq(qcAssignments.id, existing[0]!.id));
  } else {
    await tx.insert(qcAssignments).values({
      companyId: args.companyId,
      jcOpId: args.jcOpId,
      inspectorUserId: args.inspectorUserId,
      inspectorName: args.inspectorName,
      note: args.note,
      assignedByText: args.assignedByText,
      createdBy: args.userId,
      updatedBy: args.userId,
    });
  }
}

/** Pick Up — assign this op to the calling QC user. */
export async function pickUpQc(
  input: QcPickUpInput,
  user: AuthContext,
): Promise<QcAssignmentResult> {
  const companyId = requireCompany(user);
  if (!QC_WRITERS.includes(user.role)) {
    throw new AuthorizationError('Only QC, manager or admin users can pick up QC items');
  }
  return withUserContext(user, async (tx) => {
    await assertOpInCompany(tx, companyId, input.jcOpId);
    const me = await userName(tx, user.id);
    await upsertAssignment(tx, {
      companyId,
      jcOpId: input.jcOpId,
      inspectorUserId: user.id,
      inspectorName: me,
      note: null,
      assignedByText: me,
      userId: user.id,
    });
    return { jcOpId: input.jcOpId, inspectorName: me };
  });
}

/** Assign — admin allocates an op to any inspector. */
export async function assignQc(
  input: QcAssignInput,
  user: AuthContext,
): Promise<QcAssignmentResult> {
  const companyId = requireCompany(user);
  if (user.role !== 'admin') {
    throw new AuthorizationError('Only an admin can assign QC items to another inspector');
  }
  return withUserContext(user, async (tx) => {
    await assertOpInCompany(tx, companyId, input.jcOpId);
    const inspectorRows = (await tx.execute(sql`
      SELECT COALESCE(NULLIF(full_name, ''), email) AS "name"
      FROM public.users
      WHERE id = ${input.inspectorUserId}::uuid
        AND company_id = ${companyId}::uuid AND deleted_at IS NULL
    `)) as unknown as Array<{ name: string }>;
    if (inspectorRows.length === 0) throw new NotFoundError('Inspector not found');
    const inspectorName = inspectorRows[0]!.name;
    const assignedBy = await userName(tx, user.id);
    await upsertAssignment(tx, {
      companyId,
      jcOpId: input.jcOpId,
      inspectorUserId: input.inspectorUserId,
      inspectorName,
      note: input.note ?? null,
      assignedByText: assignedBy,
      userId: user.id,
    });
    return { jcOpId: input.jcOpId, inspectorName };
  });
}
