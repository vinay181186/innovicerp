// QC Command Center service tests. Rides the seeded + migrated DB. The read
// (getQcCommand) is asserted structurally — exact FPY/rework counts depend on
// whatever QC op_log exists, so we assert invariants (pct in 0..100,
// passed<=total, rework rows really are multi-attempt/rejected) rather than
// fixed numbers, matching the qc-dashboard suite's philosophy.
//
// The Pick-Up / Assign writes hang off a guaranteed-present op (IN-JC-00002
// Op 1) and are cleaned up by jc_op_id in afterAll.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { jcOps, jobCards, qcAssignments, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

let admin: AuthContext;
let testOpId: string;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const found = await db
    .select({ id: jcOps.id })
    .from(jcOps)
    .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
    .where(and(eq(jobCards.code, 'IN-JC-00002'), eq(jcOps.opSeq, 1)))
    .limit(1);
  if (!found[0]) throw new Error('Expected IN-JC-00002 Op 1 from seed migration');
  testOpId = found[0].id;
});

afterAll(async () => {
  await db.delete(qcAssignments).where(eq(qcAssignments.jcOpId, testOpId));
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
      .where(and(eq(qcAssignments.jcOpId, testOpId), eq(qcAssignments.companyId, admin.companyId!)));
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

  it('pickUp by an operator role is rejected', async () => {
    const operator: AuthContext = { ...admin, role: 'operator' };
    await expect(service.pickUpQc({ jcOpId: testOpId }, operator)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('pickUp on a non-existent op throws NotFound', async () => {
    await expect(service.pickUpQc({ jcOpId: ZERO_UUID }, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('assign by a non-admin (qc) is rejected', async () => {
    const qc: AuthContext = { ...admin, role: 'qc' };
    await expect(
      service.assignQc({ jcOpId: testOpId, inspectorUserId: admin.id }, qc),
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
