// QC Command Center service tests. Rides the seeded + migrated DB. The read
// (getQcCommand) is asserted structurally — exact FPY/rework counts depend on
// whatever QC op_log exists, so we assert invariants (pct in 0..100,
// passed<=total, rework rows really are multi-attempt/rejected) rather than
// fixed numbers, matching the qc-dashboard suite's philosophy.
//
// The Pick-Up / Assign writes hang off a guaranteed-present op (IN-JC-00002
// Op 1) and are cleaned up by jc_op_id in afterAll.

import { opSrNo } from '@innovic/shared';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { jcOps, jobCards, qcAssignments, taskHistory, tasks, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

let admin: AuthContext;
let testOpId: string;
let testCall: string;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  // IN-JC-00002 Op 1 from the seed; on a database without it (TEST after the
  // 2026-10 clean-up) any live op of the company with no QC assignment yet.
  const seed = await db
    .select({ id: jcOps.id, jcCode: jobCards.code, opSeq: jcOps.opSeq })
    .from(jcOps)
    .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
    .where(and(eq(jobCards.code, 'IN-JC-00002'), eq(jcOps.opSeq, 1)))
    .limit(1);
  const found = seed[0]
    ? seed
    : await db
        .select({ id: jcOps.id, jcCode: jobCards.code, opSeq: jcOps.opSeq })
        .from(jcOps)
        .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
        .leftJoin(qcAssignments, eq(qcAssignments.jcOpId, jcOps.id))
        .where(
          and(
            eq(jcOps.companyId, u.companyId),
            isNull(jcOps.deletedAt),
            isNull(jobCards.deletedAt),
            isNull(qcAssignments.id),
          ),
        )
        .orderBy(desc(jobCards.code))
        .limit(1);
  if (!found[0]) throw new Error('No job-card operation on this database to test with');
  testCall = `${found[0].jcCode} · Op ${opSrNo(found[0].opSeq)}`;
  testOpId = found[0].id;
});

/** Open tasks linked to the test op (ADR-298). */
async function callTasks() {
  return db
    .select({ id: tasks.id, code: tasks.code, assignedTo: tasks.assignedTo, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.linkedRefType, 'qc_call'),
        eq(tasks.linkedRefId, testOpId),
        inArray(tasks.status, ['todo', 'in_progress']),
        isNull(tasks.deletedAt),
      ),
    );
}

afterAll(async () => {
  await db.delete(qcAssignments).where(eq(qcAssignments.jcOpId, testOpId));
  // The tasks the assignments raised (ADR-298), with their trail.
  const ids = (
    await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.linkedRefType, 'qc_call'), eq(tasks.linkedRefId, testOpId)))
  ).map((t) => t.id);
  if (ids.length > 0) {
    await db.delete(taskHistory).where(inArray(taskHistory.taskId, ids));
    await db.delete(tasks).where(inArray(tasks.id, ids));
  }
});

describe('qc-command service — read', () => {
  it('returns a well-formed aggregate payload', async () => {
    const r = await service.getQcCommand(admin);
    expect(Array.isArray(r.queue)).toBe(true);
    expect(Array.isArray(r.rework)).toBe(true);
    expect(Array.isArray(r.inspectors)).toBe(true);
    expect(r.fpy).toBeDefined();
    expect(r.stats.pendingOps).toBe(r.queue.length);
    expect(r.stats.fpyPct).toBe(r.fpy.overallPct);
  });

  it('queue rows are well-formed (attempt>=1, pending>0, age>=0)', async () => {
    const r = await service.getQcCommand(admin);
    for (const q of r.queue) {
      expect(q.attemptNo).toBeGreaterThanOrEqual(1);
      expect(q.pendingQty).toBeGreaterThan(0);
      expect(q.ageDays).toBeGreaterThanOrEqual(0);
      expect(typeof q.jcCode).toBe('string');
    }
    // reworkItems stat = queue rows on a 2nd+ attempt.
    expect(r.stats.reworkItems).toBe(r.queue.filter((q) => q.attemptNo > 1).length);
  });

  it('FPY invariants hold (0..100, passed<=total per bucket)', async () => {
    const r = await service.getQcCommand(admin);
    expect(r.fpy.overallPct).toBeGreaterThanOrEqual(0);
    expect(r.fpy.overallPct).toBeLessThanOrEqual(100);
    expect(r.fpy.passed).toBeLessThanOrEqual(r.fpy.total);
    for (const row of [...r.fpy.byOperation, ...r.fpy.byInspector]) {
      expect(row.passed).toBeLessThanOrEqual(row.total);
      expect(row.pct).toBeGreaterThanOrEqual(0);
      expect(row.pct).toBeLessThanOrEqual(100);
    }
    expect(r.fpy.byItem.length).toBeLessThanOrEqual(10);
  });

  it('every rework row is genuinely multi-attempt or has rejects', async () => {
    const r = await service.getQcCommand(admin);
    for (const row of r.rework) {
      expect(row.attempts > 1 || row.totalRejected > 0).toBe(true);
      expect(row.daysElapsed).toBeGreaterThanOrEqual(0);
    }
  });

  it('orphan user (no company) is rejected', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.getQcCommand(orphan)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('qc-command service — pick up / assign', () => {
  it('pickUp assigns the op to the caller and shows in a fresh read if pending', async () => {
    const res = await service.pickUpQc({ jcOpId: testOpId }, admin);
    expect(res.jcOpId).toBe(testOpId);
    expect(typeof res.inspectorName).toBe('string');
    // If the op is in the pending queue, its assignedTo now reflects the pickup.
    const r = await service.getQcCommand(admin);
    const row = r.queue.find((q) => q.jcOpId === testOpId);
    if (row) expect(row.assignedTo).toBe(res.inspectorName);
    // Exactly one active assignment row exists for the op.
    const active = await db
      .select({ id: qcAssignments.id })
      .from(qcAssignments)
      .where(
        and(eq(qcAssignments.jcOpId, testOpId), eq(qcAssignments.companyId, admin.companyId!)),
      );
    expect(active.length).toBe(1);
  });

  it('pickUp is idempotent — re-picking does not create a 2nd active row', async () => {
    await service.pickUpQc({ jcOpId: testOpId }, admin);
    await service.pickUpQc({ jcOpId: testOpId }, admin);
    const active = await db
      .select({ id: qcAssignments.id })
      .from(qcAssignments)
      .where(eq(qcAssignments.jcOpId, testOpId));
    expect(active.length).toBe(1);
  });

  // ADR-232 — the QC Call Register tick decides, not users.role.
  it('pickUp without the QC tick (Production L5, role operator) is rejected', async () => {
    const operator = asAccess(admin, { departments: { production: 'L5' } }, 'operator');
    await expect(service.pickUpQc({ jcOpId: testOpId }, operator)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('pickUp with the QC tick passes the gate even when role is operator', async () => {
    const qcL2 = asAccess(admin, { departments: { qc: 'L2' } }, 'operator');
    await expect(service.pickUpQc({ jcOpId: ZERO_UUID }, qcL2)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('pickUp by an L7 Auditor is rejected', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, departments: { qc: 'L5' } });
    await expect(service.pickUpQc({ jcOpId: testOpId }, auditor)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('pickUp on a non-existent op throws NotFound', async () => {
    await expect(service.pickUpQc({ jcOpId: ZERO_UUID }, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('assign without the QC advance tick (QC L1, role qc) is rejected', async () => {
    const qc = asAccess(admin, { departments: { qc: 'L1' } }, 'qc');
    await expect(
      service.assignQc({ jcOpId: testOpId, inspectorUserId: admin.id }, qc),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('assign with the QC advance tick passes the gate even when role is qc', async () => {
    const qcL2 = asAccess(admin, { departments: { qc: 'L2' } }, 'qc');
    await expect(
      service.assignQc({ jcOpId: ZERO_UUID, inspectorUserId: admin.id }, qcL2),
    ).rejects.not.toBeInstanceOf(AuthorizationError);
  });

  it('assign by an L7 Auditor is rejected', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, departments: { qc: 'L5' } });
    await expect(
      service.assignQc({ jcOpId: testOpId, inspectorUserId: admin.id }, auditor),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('assign by admin allocates to the chosen inspector', async () => {
    const res = await service.assignQc(
      { jcOpId: testOpId, inspectorUserId: admin.id, note: 'priority' },
      admin,
    );
    expect(res.jcOpId).toBe(testOpId);
    expect(typeof res.inspectorName).toBe('string');
    const active = await db
      .select({ id: qcAssignments.id, name: qcAssignments.inspectorName })
      .from(qcAssignments)
      .where(eq(qcAssignments.jcOpId, testOpId));
    expect(active.length).toBe(1);
    expect(active[0]!.name).toBe(res.inspectorName);
  });

  it('assign to an unknown inspector throws NotFound', async () => {
    await expect(
      service.assignQc({ jcOpId: testOpId, inspectorUserId: ZERO_UUID }, admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ADR-298 — Assign Inspector / Pick Up raise the inspector's Task Board task.
describe('qc-command — the inspector gets a Task Board task (ADR-298)', () => {
  let other: AuthContext;

  beforeAll(async () => {
    await db.delete(qcAssignments).where(eq(qcAssignments.jcOpId, testOpId));
    const rows = await db
      .select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
      .from(users)
      .where(
        and(
          eq(users.companyId, admin.companyId!),
          ne(users.id, admin.id),
          eq(users.isActive, true),
          isNull(users.deletedAt),
        ),
      )
      .limit(20);
    // Someone who may open the Task Board: assign once and keep the first that gets a task.
    for (const u of rows) {
      const r = await service.assignQc({ jcOpId: testOpId, inspectorUserId: u.id }, admin);
      if (r.taskCode) {
        other = {
          id: u.id,
          email: u.email,
          companyId: admin.companyId,
          role: u.role,
          isActive: true,
        };
        break;
      }
    }
    if (!other) throw new Error('No TEST user who can open the Task Board');
    await db.delete(qcAssignments).where(eq(qcAssignments.jcOpId, testOpId));
  });

  it('assign raises ONE task for the inspector, linked to the QC call', async () => {
    const before = (await callTasks()).length;
    const res = await service.assignQc(
      { jcOpId: testOpId, inspectorUserId: other.id, note: 'check threads' },
      admin,
    );
    expect(res.taskCode).toMatch(/^TSK-/);
    const open = await callTasks();
    expect(open.length).toBe(before + 1);
    const t = open.find((x) => x.code === res.taskCode)!;
    expect(t.assignedTo).toBe(other.id);
    expect(t.title.startsWith(`QC inspection: ${testCall}`)).toBe(true);
  });

  it('assign again to the same person changes nothing', async () => {
    const before = await callTasks();
    const res = await service.assignQc({ jcOpId: testOpId, inspectorUserId: other.id }, admin);
    const after = await callTasks();
    expect(after.length).toBe(before.length);
    expect(after.map((t) => t.code)).toContain(res.taskCode);
  });

  it('reassign MOVES the same task and records it', async () => {
    const [a] = await db
      .select({ taskId: qcAssignments.taskId })
      .from(qcAssignments)
      .where(and(eq(qcAssignments.jcOpId, testOpId), isNull(qcAssignments.deletedAt)));
    const res = await service.assignQc({ jcOpId: testOpId, inspectorUserId: admin.id }, admin);
    const [t] = await db.select().from(tasks).where(eq(tasks.id, a!.taskId!));
    expect(t!.code).toBe(res.taskCode);
    expect(t!.assignedTo).toBe(admin.id);
    const h = await db
      .select({ action: taskHistory.action })
      .from(taskHistory)
      .where(eq(taskHistory.taskId, t!.id));
    expect(h.map((x) => x.action)).toContain('reassigned');
  });

  it('a task typed by hand for the same call is never moved', async () => {
    const hand = await db
      .insert(tasks)
      .values({
        companyId: admin.companyId!,
        code: `TSK-T${Date.now() % 100000}`,
        taskType: 'assigned',
        title: 'hand-made QC call task',
        assignedTo: other.id,
        assignedBy: admin.id,
        status: 'todo',
        dueDate: '2099-01-01',
        linkedRefType: 'qc_call',
        linkedRefId: testOpId,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: tasks.id });
    await service.assignQc({ jcOpId: testOpId, inspectorUserId: other.id }, admin);
    const [t] = await db.select().from(tasks).where(eq(tasks.id, hand[0]!.id));
    expect(t!.assignedTo).toBe(other.id);
    await service.assignQc({ jcOpId: testOpId, inspectorUserId: admin.id }, admin);
    const [t2] = await db.select().from(tasks).where(eq(tasks.id, hand[0]!.id));
    expect(t2!.assignedTo).toBe(other.id);
  });

  it('two Assigns at once on a fresh call: one assignment, one task (§20.3)', async () => {
    await db.delete(qcAssignments).where(eq(qcAssignments.jcOpId, testOpId));
    const before = (await callTasks()).length;
    const results = await Promise.allSettled([
      service.assignQc({ jcOpId: testOpId, inspectorUserId: other.id }, admin),
      service.assignQc({ jcOpId: testOpId, inspectorUserId: admin.id }, admin),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const active = await db
      .select({ taskId: qcAssignments.taskId, inspector: qcAssignments.inspectorUserId })
      .from(qcAssignments)
      .where(and(eq(qcAssignments.jcOpId, testOpId), isNull(qcAssignments.deletedAt)));
    expect(active.length).toBe(1);
    expect((await callTasks()).length).toBe(before + 1);
    const [t] = await db.select().from(tasks).where(eq(tasks.id, active[0]!.taskId!));
    expect(t!.assignedTo).toBe(active[0]!.inspector);
  });

  it('pick up puts the call in your own To-Do', async () => {
    await db.delete(qcAssignments).where(eq(qcAssignments.jcOpId, testOpId));
    const res = await service.pickUpQc(
      { jcOpId: testOpId },
      asAccess(other, { departments: { qc: 'L2' } }),
    );
    const [t] = await db.select().from(tasks).where(eq(tasks.code, res.taskCode!));
    expect(t!.assignedTo).toBe(other.id);
    expect(t!.createdBy).toBe(other.id);
  });
});
