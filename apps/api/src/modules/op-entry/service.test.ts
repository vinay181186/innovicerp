import { startOpInputSchema, submitQcLogInputSchema } from '@innovic/shared';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  jcOps,
  jobCards,
  ncRegister,
  opLog,
  runningOps,
  storeTransactions,
  users,
} from '../../db/schema';
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
  // Sweep ALL jc_ops on the test JC (covers the extra QC op the T-026 test
  // creates if it crashed before its own cleanup ran).
  // T-040e: NC rows reference jobCardId without ON DELETE CASCADE, so they
  // must be deleted BEFORE the JC. Sweep by jobCardId (defensive) and by
  // auto-generated NC- prefix.
  if (testJcId) {
    await db.delete(ncRegister).where(eq(ncRegister.jobCardId, testJcId));
    const opsOnJc = await db
      .select({ id: jcOps.id })
      .from(jcOps)
      .where(eq(jcOps.jobCardId, testJcId));
    for (const o of opsOnJc) {
      await db.delete(opLog).where(eq(opLog.jcOpId, o.id));
      await db.delete(runningOps).where(eq(runningOps.jcOpId, o.id));
    }
    await db.delete(jcOps).where(eq(jcOps.jobCardId, testJcId));
  }
  if (testJcId) await db.delete(jobCards).where(eq(jobCards.id, testJcId));
  // T-040f: store_transactions reference items.id without ON DELETE CASCADE.
  // Wipe by itemId AND by TEST_PREFIX-derived sourceRef so nothing orphans.
  if (testItemId) {
    await db.delete(storeTransactions).where(eq(storeTransactions.itemId, testItemId));
    await db.delete(items).where(eq(items.id, testItemId));
  }
  // Sweep any NCs left behind from prior crashed runs against this test prefix.
  await db.delete(ncRegister).where(like(ncRegister.code, `NC-AUTO-${TEST_PREFIX}%`));
  // Sweep any leftover store_transactions rows tagged with the test prefix.
  await db
    .delete(storeTransactions)
    .where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));
  await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  // Wipe audit-log entries the op-entry emitter wrote for these test JCs.
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `NC-AUTO-${TEST_PREFIX}%`));
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

  it('startOp Zod schema rejects when neither operatorId nor operatorName is provided (T-026)', () => {
    const r = startOpInputSchema.safeParse({
      jcOpId: '00000000-0000-0000-0000-000000000000',
      startDate: '2026-05-01',
      startTime: '10:00',
      shift: 'day',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/operator/i);
    }
  });

  it('submitOpLog auto-sets qc_call_date on the next QC op when prior op completes (T-026)', async () => {
    // Add a second op (op_seq=2, qc_required=true) on the test JC.
    const inserted = await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: testJcId,
        opSeq: 2,
        operation: 'inspect',
        opType: 'qc',
        cycleTimeMin: '0.00',
        qcRequired: true,
        reworkQty: 0,
        outsourceCost: '0.00',
        outsourceSentQty: 0,
        outsourceReturnedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const qcOpId = inserted[0]!.id;

    // Reset op_log on the prior op so we can drive it cleanly.
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));

    // Sanity: qc op starts with no qcCallDate
    const before = await db
      .select({ qcCallDate: jcOps.qcCallDate })
      .from(jcOps)
      .where(eq(jcOps.id, qcOpId))
      .limit(1);
    expect(before[0]?.qcCallDate).toBeNull();

    // Submit ALL 10 pcs on op 1 → op 1 becomes complete → op 2 (QC) qcCallDate is set.
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
      .select({ qcCallDate: jcOps.qcCallDate })
      .from(jcOps)
      .where(eq(jcOps.id, qcOpId))
      .limit(1);
    expect(after[0]?.qcCallDate).toBe('2026-05-01');

    // Cleanup the extra QC op so subsequent tests still see only op_seq=1.
    await db.delete(jcOps).where(and(eq(jcOps.id, qcOpId)));
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

  it('emits OP_START / OP_STOP / OP_COMPLETE activity_log rows atomic with the mutation', async () => {
    // Wipe any earlier audit rows for this JC so the assertion is precise.
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));

    // Use a brand-new JC op so the test is isolated from other tests'
    // running_ops + op_log residue.
    const opRows = await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: testJcId,
        opSeq: 99,
        machineId: null,
        machineCodeText: 'AUD-M1',
        operation: 'audit-op',
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
    const auditOpId = opRows[0]!.id;

    const running = await service.startOp(
      {
        jcOpId: auditOpId,
        operatorName: 'Audit Op',
        startDate: '2026-05-02',
        startTime: '08:00',
        shift: 'day',
      },
      admin,
    );
    await service.stopOp(running.id, admin);
    await service.submitOpLog(
      {
        jcOpId: auditOpId,
        qty: 1,
        rejectQty: 0,
        operatorName: 'Audit Op',
        logDate: '2026-05-02',
        shift: 'day',
      },
      admin,
    );

    const auditRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, testJcCode)));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['OP_COMPLETE', 'OP_START', 'OP_STOP']);
    for (const r of auditRows) {
      expect(r.entity).toBe('Op');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(testJcCode);
      expect(r.detail).toContain('Op #99');
    }

    // Cleanup so subsequent tests don't see the residue.
    await db.delete(opLog).where(eq(opLog.jcOpId, auditOpId));
    await db.delete(runningOps).where(eq(runningOps.jcOpId, auditOpId));
    await db.delete(jcOps).where(eq(jcOps.id, auditOpId));
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
  });
});

// ─── T-040d QC inspection submit (per ADR-025) ────────────────────────────
describe('op-entry submitQcLog (T-040d)', () => {
  // Each test creates its own QC op + clean op_log to keep state isolated.
  // Cleanup in afterEach removes the QC op + any complete logs we added on
  // the fixture process op. The base fixture (op_seq=1, process) is left in
  // place and re-used across tests via afterEach reset.
  let qcOpId: string | null = null;

  async function ensureFreshFixture(qcRequiredOnFixture = false): Promise<string> {
    // Reset op_log + running_ops on the base process op so prior tests'
    // state doesn't bleed in. Then add a fresh op_seq=2 QC op.
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));
    if (qcRequiredOnFixture) {
      await db
        .update(jcOps)
        .set({ qcRequired: true, updatedBy: admin.id })
        .where(eq(jcOps.id, testJcOpId));
    } else {
      await db
        .update(jcOps)
        .set({ qcRequired: false, updatedBy: admin.id })
        .where(eq(jcOps.id, testJcOpId));
    }

    // Drop any leftover op_seq=2 from a prior test that crashed before cleanup.
    const leftovers = await db
      .select({ id: jcOps.id })
      .from(jcOps)
      .where(and(eq(jcOps.jobCardId, testJcId), eq(jcOps.opSeq, 2)));
    for (const l of leftovers) {
      await db.delete(opLog).where(eq(opLog.jcOpId, l.id));
      await db.delete(jcOps).where(eq(jcOps.id, l.id));
    }

    const inserted = await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: testJcId,
        opSeq: 2,
        operation: 'inspect',
        opType: 'qc',
        cycleTimeMin: '0.00',
        qcRequired: true,
        reworkQty: 0,
        outsourceCost: '0.00',
        outsourceSentQty: 0,
        outsourceReturnedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const id = inserted[0]!.id;
    qcOpId = id;
    return id;
  }

  afterAll(async () => {
    // Clean any QC-test-specific audit rows; teardownFixture wipes by JC code
    // already, but be belt-and-suspenders on activity_log since OP_QC was new
    // in this slice.
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
  });

  it('happy path: writes log_type=qc, sets qc_attended_date, backfills qc_call_date, emits OP_QC audit row', async () => {
    const id = await ensureFreshFixture();
    // Drive prior op (op_seq=1) to completion so the QC op has input qty.
    await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    // Now QC op (op_seq=2) has input_avail=10 and qc_pending=10.

    const row = await service.submitQcLog(
      {
        jcOpId: id,
        qty: 8,
        rejectQty: 2,
        logDate: '2026-05-03',
        shift: 'day',
        operatorName: 'QC-Insp',
      },
      admin,
    );
    expect(row.logType).toBe('qc');
    expect(row.qty).toBe(8);
    expect(row.rejectQty).toBe(2);

    const opAfter = await db
      .select({ qcAttendedDate: jcOps.qcAttendedDate, qcCallDate: jcOps.qcCallDate })
      .from(jcOps)
      .where(eq(jcOps.id, id))
      .limit(1);
    expect(opAfter[0]?.qcAttendedDate).toBe('2026-05-03');
    // submitOpLog above already set qcCallDate when op_seq=1 finished. So the
    // backfill path inside submitQcLog should be a no-op (already set).
    expect(opAfter[0]?.qcCallDate).toBe('2026-05-02');

    // Audit row.
    const audit = await db
      .select()
      .from(activityLog)
      .where(
        and(eq(activityLog.action, 'OP_QC'), eq(activityLog.companyId, admin.companyId!)),
      );
    const myRow = audit.find((r) => r.refId === testJcCode);
    expect(myRow).toBeDefined();
    expect(myRow?.entity).toBe('Op');
    expect(myRow?.detail).toContain('Op #2');
    expect(myRow?.detail).toContain('8 accepted');
    expect(myRow?.detail).toContain('2 rejected');
    expect(myRow?.detail).toContain('QC-Insp');

    // T-040e: rejectQty=2 should have auto-created an NC. Verify shape.
    const ncs = await db
      .select()
      .from(ncRegister)
      .where(and(eq(ncRegister.jobCardId, testJcId), like(ncRegister.code, 'NC-AUTO-%')));
    expect(ncs).toHaveLength(1);
    expect(ncs[0]?.opSeq).toBe(2);
    expect(ncs[0]?.rejectedQty).toBe('2.00');
    expect(ncs[0]?.reportedByText).toBe('QC-Insp');
    expect(ncs[0]?.status).toBe('pending');
    expect(ncs[0]?.reasonCategory).toBe('other');
    // CREATE NonConformance audit row emitted by the auto-create cascade.
    const ncAudit = await db
      .select()
      .from(activityLog)
      .where(
        and(eq(activityLog.action, 'CREATE'), eq(activityLog.entity, 'NonConformance')),
      );
    const myNcRow = ncAudit.find((r) => r.refId === ncs[0]?.code);
    expect(myNcRow).toBeDefined();
    expect(myNcRow?.detail).toContain('auto from QC reject');

    // T-040f: op_seq=2 IS the last op on testJc → stock cascade fired.
    // qty=8 accepted → store_transactions IN row crediting testItem with 8.
    const stockRows = await db
      .select()
      .from(storeTransactions)
      .where(eq(storeTransactions.itemId, testItemId));
    const myStockRow = stockRows.find(
      (r) => r.sourceType === 'qc_accept' && r.sourceRef.includes(testJcCode),
    );
    expect(myStockRow).toBeDefined();
    expect(myStockRow?.txnType).toBe('in');
    expect(myStockRow?.qty).toBe(8);
    expect(myStockRow?.stockBefore).toBe(0); // first stock txn against this item
    expect(myStockRow?.stockAfter).toBe(8);
    expect(myStockRow?.remarks).toContain('QC accept');

    // Cleanup audit + auto-NC + stock so the next test sees a clean slate.
    await db.delete(storeTransactions).where(eq(storeTransactions.itemId, testItemId));
    await db.delete(ncRegister).where(eq(ncRegister.jobCardId, testJcId));
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
    if (ncs[0]?.code) {
      await db.delete(activityLog).where(eq(activityLog.refId, ncs[0]!.code));
    }
    if (qcOpId) {
      await db.delete(opLog).where(eq(opLog.jcOpId, qcOpId));
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
  });

  it('backfills qc_call_date from prior op completion log when null', async () => {
    const id = await ensureFreshFixture();
    // Manually clear qcCallDate that submitOpLog would have set. We want to
    // exercise the submitQcLog backfill query directly. To do that, drive
    // prior op to completion (which sets qc_call_date), then null it back.
    await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    await db.update(jcOps).set({ qcCallDate: null }).where(eq(jcOps.id, id));

    await service.submitQcLog(
      {
        jcOpId: id,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-04',
        shift: 'day',
        operatorName: 'QC-Insp',
      },
      admin,
    );

    const opAfter = await db
      .select({ qcCallDate: jcOps.qcCallDate })
      .from(jcOps)
      .where(eq(jcOps.id, id))
      .limit(1);
    // Backfilled from the prior op's complete log date (2026-05-02), NOT the
    // QC log_date (2026-05-04).
    expect(opAfter[0]?.qcCallDate).toBe('2026-05-02');

    // T-040f: stock cascade fired (op 2 is last op on testJc, qty=10 accepted).
    // Cleanup so the next test sees a clean stock state.
    await db.delete(storeTransactions).where(eq(storeTransactions.itemId, testItemId));
    if (qcOpId) {
      await db.delete(opLog).where(eq(opLog.jcOpId, qcOpId));
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
  });

  it('rejects when op is not qc-bearing (process op without qc_required)', async () => {
    // The base fixture op_seq=1 is process+qc_required=false. Calling submitQcLog
    // against it should throw.
    await expect(
      service.submitQcLog(
        {
          jcOpId: testJcOpId,
          qty: 1,
          rejectQty: 0,
          logDate: '2026-05-02',
          shift: 'day',
          operatorName: 'QC-Insp',
        },
        admin,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('T-040e: rejectQty=0 does NOT auto-create an NC', async () => {
    const id = await ensureFreshFixture();
    await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );

    // All-accepted QC inspection: no reject → no NC.
    await service.submitQcLog(
      {
        jcOpId: id,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-03',
        shift: 'day',
        operatorName: 'QC-Insp',
      },
      admin,
    );

    const ncs = await db
      .select()
      .from(ncRegister)
      .where(eq(ncRegister.jobCardId, testJcId));
    expect(ncs).toHaveLength(0);

    // T-040f: but stock cascade DID fire (op 2 is last op, qty=10 accepted).
    const stocks = await db
      .select()
      .from(storeTransactions)
      .where(eq(storeTransactions.itemId, testItemId));
    expect(stocks).toHaveLength(1);
    expect(stocks[0]?.qty).toBe(10);

    await db.delete(storeTransactions).where(eq(storeTransactions.itemId, testItemId));
    if (qcOpId) {
      await db.delete(opLog).where(eq(opLog.jcOpId, qcOpId));
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
  });

  it('T-040e: validation failure (qty exceeds qc_pending) does NOT create an orphan NC', async () => {
    // Same shape as "rejects when total qty exceeds qc_pending" but explicitly
    // checks that the auto-NC tx rolled back too.
    const id = await ensureFreshFixture();
    await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    // qc_pending=10; try qty=6 reject=5 = 11 total → exceeds.
    await expect(
      service.submitQcLog(
        {
          jcOpId: id,
          qty: 6,
          rejectQty: 5,
          logDate: '2026-05-03',
          shift: 'day',
          operatorName: 'QC-Insp',
        },
        admin,
      ),
    ).rejects.toThrow(/exceeds QC pending/);

    // No NC row should exist — tx rolled back.
    const ncs = await db
      .select()
      .from(ncRegister)
      .where(eq(ncRegister.jobCardId, testJcId));
    expect(ncs).toHaveLength(0);
    // T-040f: same tx → no orphan stock row either.
    const stocks = await db
      .select()
      .from(storeTransactions)
      .where(eq(storeTransactions.itemId, testItemId));
    expect(stocks).toHaveLength(0);

    if (qcOpId) {
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
  });

  it('T-040f: stock cascade does NOT fire when QC is on a non-last op', async () => {
    // Add a 3rd op (op_seq=3, process) AFTER the QC op_seq=2 → op 2 is no
    // longer the last op of the JC. QC submit against op 2 should NOT write
    // a store_transactions row.
    const id = await ensureFreshFixture();
    const op3Rows = await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: testJcId,
        opSeq: 3,
        operation: 'final-pack',
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
    const op3Id = op3Rows[0]!.id;

    await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    await service.submitQcLog(
      {
        jcOpId: id,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-03',
        shift: 'day',
        operatorName: 'QC-Insp',
      },
      admin,
    );

    // No stock row — op 2 was not the last op (op 3 is).
    const stocks = await db
      .select()
      .from(storeTransactions)
      .where(eq(storeTransactions.itemId, testItemId));
    expect(stocks).toHaveLength(0);

    await db.delete(opLog).where(eq(opLog.jcOpId, op3Id));
    await db.delete(jcOps).where(eq(jcOps.id, op3Id));
    if (qcOpId) {
      await db.delete(opLog).where(eq(opLog.jcOpId, qcOpId));
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
  });

  it('rejects when total qty exceeds qc_pending', async () => {
    const id = await ensureFreshFixture();
    await service.submitOpLog(
      {
        jcOpId: testJcOpId,
        qty: 10,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    // qc_pending = 10 now. Try to inspect 11.
    await expect(
      service.submitQcLog(
        {
          jcOpId: id,
          qty: 6,
          rejectQty: 5,
          logDate: '2026-05-03',
          shift: 'day',
          operatorName: 'QC-Insp',
        },
        admin,
      ),
    ).rejects.toThrow(/exceeds QC pending/);

    if (qcOpId) {
      await db.delete(opLog).where(eq(opLog.jcOpId, qcOpId));
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(activityLog).where(eq(activityLog.refId, testJcCode));
  });

  it('rejects when no QC pending (prior op not completed yet)', async () => {
    const id = await ensureFreshFixture();
    // Don't drive op_seq=1 → qc_pending stays 0 on op_seq=2.
    await expect(
      service.submitQcLog(
        {
          jcOpId: id,
          qty: 1,
          rejectQty: 0,
          logDate: '2026-05-03',
          shift: 'day',
          operatorName: 'QC-Insp',
        },
        admin,
      ),
    ).rejects.toThrow(/No QC pending/);

    if (qcOpId) {
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
  });

  it('Zod refine: rejects when both qty and rejectQty are 0', () => {
    const r = submitQcLogInputSchema.safeParse({
      jcOpId: '00000000-0000-0000-0000-000000000000',
      qty: 0,
      rejectQty: 0,
      logDate: '2026-05-02',
      shift: 'day',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/accepted qty.*reject qty/i);
    }
  });

  it('ISSUE-001 guard: submitOpLog rejects log against op_type=qc', async () => {
    const id = await ensureFreshFixture();
    await expect(
      service.submitOpLog(
        {
          jcOpId: id,
          qty: 1,
          rejectQty: 0,
          logDate: '2026-05-02',
          shift: 'day',
          operatorName: 'TestOp',
        },
        admin,
      ),
    ).rejects.toThrow(/QC operation/);

    if (qcOpId) {
      await db.delete(jcOps).where(eq(jcOps.id, qcOpId));
      qcOpId = null;
    }
  });

  it('cascade fires when QC log brings the JC to complete', async () => {
    // Brand-new JC + 2 ops (process → qc) linked to a SO line so cascade has
    // somewhere to land. Mirrors the _seed_cascade.mjs pattern.
    const cascItem = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}ITEM-QC`,
        name: 'QC Cascade Test Item',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const itemId = cascItem[0]!.id;

    // Create SO + line via direct insert (skip service to keep the test focused).
    const { salesOrders, salesOrderLines } = await import('../../db/schema');
    const so = await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}SO-QC-CASCADE`,
        soDate: '2026-05-02',
        customerName: 'QC Cascade Customer',
        type: 'component_manufacturing',
        status: 'open',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const soLine = await db
      .insert(salesOrderLines)
      .values({
        companyId: admin.companyId!,
        salesOrderId: so[0]!.id,
        lineNo: 1,
        itemId,
        partName: 'QC cascade part',
        uom: 'NOS',
        orderQty: 5,
        rate: '0',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const jc = await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}JC-QC-CASC`,
        jcDate: '2026-05-02',
        itemId,
        orderQty: 5,
        priority: 'normal',
        sourceSoLineId: soLine[0]!.id,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const procOp = await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: jc[0]!.id,
        opSeq: 1,
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
    const qcOp = await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: jc[0]!.id,
        opSeq: 2,
        operation: 'final inspect',
        opType: 'qc',
        cycleTimeMin: '0.00',
        qcRequired: true,
        reworkQty: 0,
        outsourceCost: '0.00',
        outsourceSentQty: 0,
        outsourceReturnedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();

    // Drive prior op to complete, then submit QC inspecting all 5 pcs accepted.
    await service.submitOpLog(
      {
        jcOpId: procOp[0]!.id,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'TestOp',
      },
      admin,
    );
    await service.submitQcLog(
      {
        jcOpId: qcOp[0]!.id,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-03',
        shift: 'day',
        operatorName: 'QC-Insp',
      },
      admin,
    );

    // Cascade should have closed the SO line + header.
    const lineAfter = await db
      .select({ status: salesOrderLines.status })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, soLine[0]!.id))
      .limit(1);
    expect(lineAfter[0]?.status).toBe('closed');
    const soAfter = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, so[0]!.id))
      .limit(1);
    expect(soAfter[0]?.status).toBe('closed');

    // T-040f: stock cascade fired (QC op 2 = last op, qty=5 accepted).
    const stocks = await db
      .select()
      .from(storeTransactions)
      .where(eq(storeTransactions.itemId, itemId));
    expect(stocks).toHaveLength(1);
    expect(stocks[0]?.qty).toBe(5);
    expect(stocks[0]?.sourceType).toBe('qc_accept');

    // Cleanup
    await db.delete(storeTransactions).where(eq(storeTransactions.itemId, itemId));
    await db.delete(opLog).where(eq(opLog.jcOpId, procOp[0]!.id));
    await db.delete(opLog).where(eq(opLog.jcOpId, qcOp[0]!.id));
    await db.delete(jcOps).where(eq(jcOps.id, procOp[0]!.id));
    await db.delete(jcOps).where(eq(jcOps.id, qcOp[0]!.id));
    await db.delete(jobCards).where(eq(jobCards.id, jc[0]!.id));
    await db.delete(salesOrderLines).where(eq(salesOrderLines.id, soLine[0]!.id));
    await db.delete(salesOrders).where(eq(salesOrders.id, so[0]!.id));
    await db.delete(items).where(eq(items.id, itemId));
    await db
      .delete(activityLog)
      .where(like(activityLog.refId, `${TEST_PREFIX}JC-QC-CASC%`));
    await db
      .delete(activityLog)
      .where(like(activityLog.refId, `${TEST_PREFIX}SO-QC-CASCADE%`));
  });
});
