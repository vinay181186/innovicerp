import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, jcOps, jobCards, opLog, runningOps, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, ValidationError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T025-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
// Test fixture ids (created in beforeAll, torn down in afterAll).
let testItemId: string;
let testJcId: string;
let testJcCode: string;
let testJcOpId: string;

async function setupFixture(): Promise<void> {
  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM-A`,
      name: 'Op Entry Test Item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testItemId = itemRows[0]!.id;

  testJcCode = `${TEST_PREFIX}JC-001`;
  const jcRows = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: testJcCode,
      jcDate: '2026-05-01',
      itemId: testItemId,
      orderQty: 10,
      priority: 'normal',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testJcId = jcRows[0]!.id;

  const opRows = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId: testJcId,
      opSeq: 1,
      machineId: null,
      machineCodeText: 'TEST-M1',
      operation: 'turn',
      opType: 'process',
      cycleTimeMin: '0.00',
      qcRequired: false,
      reworkQty: 0,
      outsourceCost: '0.00',
      outsourceSentQty: 0,
      outsourceReturnedQty: 0,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testJcOpId = opRows[0]!.id;
}

async function teardownFixture(): Promise<void> {
  // Hard-delete everything in dependency order. Service-role bypasses RLS.
  if (testJcOpId) {
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));
    await db.delete(jcOps).where(eq(jcOps.id, testJcOpId));
  }
  if (testJcId) await db.delete(jobCards).where(eq(jobCards.id, testJcId));
  if (testItemId) await db.delete(items).where(eq(items.id, testItemId));
  // Sweep any leftovers from prior failed runs.
  await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardownFixture(); // clean leftovers before fresh setup
  await setupFixture();
});

afterAll(async () => {
  await teardownFixture();
});

describe('op-entry service', () => {
  it('listJcOpsEnriched returns the op with computed status from view', async () => {
    const rows = await service.listJcOpsEnriched({ jobCardCode: testJcCode }, admin);
    expect(rows).toHaveLength(1);
    const op = rows[0]!;
    expect(op.id).toBe(testJcOpId);
    expect(op.jobCardCode).toBe(testJcCode);
    expect(op.opSeq).toBe(1);
    // op_seq=1, no completion → input_avail=order_qty=10, available=10, status='available'
    expect(op.inputAvail).toBe(10);
    expect(op.available).toBe(10);
    expect(op.computedStatus).toBe('available');
  });

  it('submitOpLog creates a complete entry and reduces available', async () => {
    const log = await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 3,
        rejectQty: 0,
        logDate: '2026-05-01',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    expect(log.qty).toBe(3);
    expect(log.logType).toBe('complete');
    const after = await service.listJcOpsEnriched({ jobCardCode: testJcCode }, admin);
    expect(after[0]?.completedQty).toBe(3);
    expect(after[0]?.available).toBe(7);
    expect(after[0]?.computedStatus).toBe('in_progress');
  });

  it('submitOpLog rejects qty > available with ValidationError', async () => {
    await expect(
      service.submitOpLog(
        { jcOpId: testJcOpId, qty: 999, rejectQty: 0, logDate: '2026-05-01', shift: 'day' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('submitOpLog rejects viewer role with AuthorizationError (not RLS leak)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.submitOpLog(
        { jcOpId: testJcOpId, qty: 1, rejectQty: 0, logDate: '2026-05-01', shift: 'day' },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('startOp creates a running session; second start raises ConflictError', async () => {
    // Clean any leftover running rows from prior tests.
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));

    const r1 = await service.startOp(
      {
        jcOpId: testJcOpId,
        startDate: '2026-05-01',
        startTime: '10:00',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    expect(r1.status).toBe('running');

    await expect(
      service.startOp(
        {
          jcOpId: testJcOpId,
          startDate: '2026-05-01',
          startTime: '11:00',
          shift: 'day',
          operatorName: 'TestOp',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // Cleanup for next test
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));
  });

  it('stopOp transitions running session to stopped', async () => {
    const started = await service.startOp(
      {
        jcOpId: testJcOpId,
        startDate: '2026-05-01',
        startTime: '12:00',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    const stopped = await service.stopOp(started.id, admin);
    expect(stopped.status).toBe('stopped');
    expect(stopped.endedAt).not.toBeNull();
    // Cleanup
    await db.delete(runningOps).where(eq(runningOps.id, started.id));
  });

  it('submitOpLog auto-closes any running session when the op fully completes', async () => {
    // Reset op_log to a known state for this op (delete prior entries).
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));

    const started = await service.startOp(
      {
        jcOpId: testJcOpId,
        startDate: '2026-05-01',
        startTime: '13:00',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    expect(started.status).toBe('running');

    // Submit all 10 pcs in one go.
    await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-01',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );

    const after = await db
      .select({ status: runningOps.status })
      .from(runningOps)
      .where(eq(runningOps.id, started.id))
      .limit(1);
    expect(after[0]?.status).toBe('done');
  });

  it('listJcOpsEnriched filters by machineId and returns only ops on that machine', async () => {
    // The fixture's jc_op has machineId=null, so a query for some random
    // machineId should return zero rows. Use a UUID that doesn't match
    // anything to keep the assertion robust.
    const noMatch = '00000000-0000-0000-0000-000000000000';
    const rows = await service.listJcOpsEnriched({ machineId: noMatch }, admin);
    expect(rows).toHaveLength(0);
  });

  it('listOpLog returns log entries for the jc_op (newest first)', async () => {
    const logs = await service.listOpLog({ jcOpId: testJcOpId, limit: 50 }, admin);
    // Earlier tests inserted multiple entries; ensure ordering is desc by createdAt
    expect(logs.length).toBeGreaterThan(0);
    for (let i = 1; i < logs.length; i++) {
      expect(new Date(logs[i - 1]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(logs[i]!.createdAt).getTime(),
      );
    }
  });

  it('listRunningOps returns rows for the company and supports status filter', async () => {
    // Insert directly to bypass service.startOp availability check (prior tests
    // consumed the test op's available qty).
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));
    await db.insert(runningOps).values({
      companyId: admin.companyId!,
      jcOpId: testJcOpId,
      machineId: null,
      isOsp: false,
      operatorName: 'TestOp',
      startDate: '2026-05-01',
      startTime: '14:00',
      shift: 'day',
      status: 'running',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    const all = await service.listRunningOps({}, admin);
    expect(all.some((r) => r.jcOpId === testJcOpId)).toBe(true);
    const filtered = await service.listRunningOps({ status: 'running' }, admin);
    expect(filtered.every((r) => r.status === 'running')).toBe(true);
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));
  });
});
