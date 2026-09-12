// T-040b cascade tests. Each path inserts its own NC + JC + jc_op fixture
// inside the test rather than reusing migrated rows, so we can freely write
// op_log + new JC rows + flip jc_ops.reworkQty without polluting prod-shape
// data. Same defensive prefix pattern as sales-cascade.test.ts.

import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, jcOps, jobCards, ncRegister, opLog, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import { onRecoveryJobCardQc } from './recovery';
import * as service from './service';

const TEST_PREFIX = 'T040B-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let testItemId: string;

async function setupSharedFixture(): Promise<void> {
  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM`,
      name: 'NC cascade test item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testItemId = itemRows[0]!.id;
}

interface JcFixture {
  jcId: string;
  jcCode: string;
  jcOpIds: { opSeq: number; jcOpId: string }[];
  ncId: string;
  ncCode: string;
}

async function createJcWithOpsAndNc(opts: {
  jcCode: string;
  ncCode: string;
  rejectedQty: number;
  ncOpSeq?: number;
  opSeqs?: number[];
}): Promise<JcFixture> {
  const jcInsert = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: opts.jcCode,
      jcDate: '2026-05-04',
      itemId: testItemId,
      orderQty: 100,
      priority: 'normal',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const jcId = jcInsert[0]!.id;

  const opSeqs = opts.opSeqs ?? [1, 2];
  const opInserts = await db
    .insert(jcOps)
    .values(
      opSeqs.map((opSeq) => ({
        companyId: admin.companyId!,
        jobCardId: jcId,
        opSeq,
        operation: 'TURN',
        opType: 'process' as const,
        createdBy: admin.id,
        updatedBy: admin.id,
      })),
    )
    .returning();
  const jcOpIds = opInserts.map((o) => ({ opSeq: o.opSeq, jcOpId: o.id }));

  const targetOpSeq = opts.ncOpSeq ?? opSeqs[0]!;
  const targetOpId = jcOpIds.find((o) => o.opSeq === targetOpSeq)?.jcOpId ?? null;

  const ncInsert = await db
    .insert(ncRegister)
    .values({
      companyId: admin.companyId!,
      code: opts.ncCode,
      ncDate: '2026-05-04',
      jobCardId: jcId,
      jcOpId: targetOpId,
      opSeq: targetOpSeq,
      itemId: testItemId,
      itemCodeText: `${TEST_PREFIX}ITEM`,
      rejectedQty: opts.rejectedQty.toFixed(2),
      reasonCategory: 'dimensional',
      status: 'pending',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();

  return {
    jcId,
    jcCode: opts.jcCode,
    jcOpIds,
    ncId: ncInsert[0]!.id,
    ncCode: opts.ncCode,
  };
}

async function teardown(): Promise<void> {
  // op_log → jc_ops cascade → job_cards cascade → nc_register/items left
  // standalone. Order matters because op_log depends on jc_ops.
  const testJcs = await db
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(like(jobCards.code, `${TEST_PREFIX}%`));
  for (const jc of testJcs) {
    const ops = await db.select({ id: jcOps.id }).from(jcOps).where(eq(jcOps.jobCardId, jc.id));
    for (const o of ops) {
      await db.delete(opLog).where(eq(opLog.jcOpId, o.id));
    }
    await db.delete(jcOps).where(eq(jcOps.jobCardId, jc.id));
  }
  await db.delete(ncRegister).where(like(ncRegister.code, `${TEST_PREFIX}%`));
  await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
  await teardown();
  await setupSharedFixture();
});

afterAll(async () => {
  await teardown();
});
/** Run one of the recovery hooks the way op-entry / incoming-qc do: inside a
 *  transaction with the user's claims set, so RLS sees the company. */
async function inUserTx<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return withUserContext(admin, fn);
}

/** Give a recovery child ONE op (a QC op), so it has a "last op" to inspect. */
async function addSingleQcOp(jobCardId: string): Promise<string> {
  const rows = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId,
      opSeq: 1,
      operation: 'QC',
      opType: 'qc',
      qcRequired: true,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: jcOps.id });
  return rows[0]!.id;
}

/** Turn a fresh NC into a LEGACY in-route rework row (rework_op_seq set), the
 *  shape every rework disposition produced before the QC–NC handling change.
 *  New dispositions never write this shape; the views and the close path must
 *  keep honouring the rows that already exist. */
async function makeLegacyReworkRow(ncId: string, reworkOpSeq: number): Promise<void> {
  await db
    .update(ncRegister)
    .set({
      status: 'disposed',
      disposition: 'rework',
      dispositionDate: '2026-05-04',
      dispositionByText: 'legacy',
      reworkOpSeq,
    })
    .where(eq(ncRegister.id, ncId));
}

describe('nc-register dispose cascades (T-040b, QC–NC handling design §1–§4)', () => {
  it('rework: raises a child rework JC, status=under_rework, no rework_op_seq', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}REW-JC`,
      ncCode: `${TEST_PREFIX}REW-NC`,
      rejectedQty: 5,
      opSeqs: [1, 2, 3],
      ncOpSeq: 3,
    });
    // reworkOpSeq is the legacy field and is ignored — a child card is raised.
    const res = await service.disposeNcRegister(
      f.ncId,
      { action: 'rework', reworkOpSeq: 2 },
      admin,
    );
    expect(res.nc.status).toBe('under_rework');
    expect(res.nc.disposition).toBe('rework');
    expect(res.nc.reworkOpSeq).toBeNull();
    expect(res.remainderNc).toBeNull();
    expect(res.childJobCardCode).toBe(`${f.jcCode}-RW1`);
    expect(res.nc.childJobCardId).toBe(res.childJobCardId);
    expect(res.nc.childJobCardCode).toBe(`${f.jcCode}-RW1`);
    expect(res.nc.reworkJcCodeText).toBe(`${f.jcCode}-RW1`);
    expect(res.nc.openQty).toBe('5.00');
    expect(res.nc.closeBlockedReason).toContain('5 of 5 pcs still under rework');

    const child = await db
      .select()
      .from(jobCards)
      .where(eq(jobCards.id, res.childJobCardId!))
      .limit(1);
    expect(child[0]!.parentNcId).toBe(f.ncId);
    expect(child[0]!.parentJobCardId).toBe(f.jcId);
    expect(child[0]!.originOpSeq).toBe(3);
    expect(child[0]!.recoveryKind).toBe('rework');
    expect(child[0]!.orderQty).toBe(5);
    expect(child[0]!.clientMaterialGate).toBe(false);
    expect(child[0]!.remarks).toBe(`Rework of ${f.jcCode} Op 3 — ${f.ncCode}`);
    // No ops are copied — the user defines the recovery route (§4.3).
    const childOps = await db
      .select({ id: jcOps.id })
      .from(jcOps)
      .where(eq(jcOps.jobCardId, child[0]!.id));
    expect(childOps).toHaveLength(0);
    // The legacy counter on the parent's ops is untouched.
    const op2 = f.jcOpIds.find((o) => o.opSeq === 2)!;
    const reread = await db.select().from(jcOps).where(eq(jcOps.id, op2.jcOpId)).limit(1);
    expect(reread[0]!.reworkQty).toBe(0);
  });

  it('repair: raises a -RP1 child, status=under_repair', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}REP-JC`,
      ncCode: `${TEST_PREFIX}REP-NC`,
      rejectedQty: 3,
      ncOpSeq: 1,
    });
    const res = await service.disposeNcRegister(f.ncId, { action: 'repair' }, admin);
    expect(res.nc.status).toBe('under_repair');
    expect(res.nc.disposition).toBe('repair');
    expect(res.childJobCardCode).toBe(`${f.jcCode}-RP1`);
    expect(res.nc.closeBlockedReason).toContain('under repair');
  });

  it('partial disposition splits the remainder into a pending sibling (interlock 2)', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}SPL-JC`,
      ncCode: `${TEST_PREFIX}SPL-NC`,
      rejectedQty: 5,
    });
    const res = await service.disposeNcRegister(f.ncId, { action: 'scrap', qty: 2 }, admin);
    expect(res.nc.rejectedQty).toBe('2.00');
    expect(res.nc.status).toBe('closed');
    expect(res.remainderNc).not.toBeNull();
    expect(res.remainderNc!.code).toBe(`${f.ncCode}/2`);
    expect(res.remainderNc!.rejectedQty).toBe('3.00');
    expect(res.remainderNc!.status).toBe('pending');
    expect(res.remainderNc!.splitFromNcId).toBe(f.ncId);
    expect(res.remainderNc!.closeBlockedReason).toBe('No disposition chosen');

    const audit = await db
      .select({ action: activityLog.action, detail: activityLog.detail })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, f.ncCode)));
    const actions = audit.map((r) => r.action).sort();
    expect(actions).toEqual(['NC_DISPOSE', 'NC_SPLIT']);
    expect(audit.find((r) => r.action === 'NC_DISPOSE')!.detail).toContain('qty=2');
    expect(audit.find((r) => r.action === 'NC_DISPOSE')!.detail).toContain(`${f.ncCode}/2`);
  });

  it('rejects a disposition qty above the open qty (ValidationError)', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}OVR-JC`,
      ncCode: `${TEST_PREFIX}OVR-NC`,
      rejectedQty: 2,
    });
    await expect(
      service.disposeNcRegister(f.ncId, { action: 'scrap', qty: 3 }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('scrap: flips status=closed, captures scrap_cost and closed_at/by', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}SCR-JC`,
      ncCode: `${TEST_PREFIX}SCR-NC`,
      rejectedQty: 2,
    });
    const { nc } = await service.disposeNcRegister(
      f.ncId,
      { action: 'scrap', scrapCost: 250.5, remarks: 'discarded' },
      admin,
    );
    expect(nc.status).toBe('closed');
    expect(nc.disposition).toBe('scrap');
    expect(nc.scrapCost).toBe('250.50');
    expect(nc.dispositionRemarks).toBe('discarded');
    expect(nc.closedAt).not.toBeNull();
    expect(nc.closedBy).toBe(admin.id);
    expect(nc.closeBlockedReason).toBeNull();
  });

  it('use_as_is: flips status=closed, appends an op_log row with type=qc + qty=rejected', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}UAI-JC`,
      ncCode: `${TEST_PREFIX}UAI-NC`,
      rejectedQty: 4,
      ncOpSeq: 1,
    });
    const { nc } = await service.disposeNcRegister(f.ncId, { action: 'use_as_is' }, admin);
    expect(nc.status).toBe('closed');
    expect(nc.disposition).toBe('use_as_is');

    const log = await db
      .select()
      .from(opLog)
      .where(and(eq(opLog.jcOpId, f.jcOpIds[0]!.jcOpId), eq(opLog.logType, 'qc')));
    expect(log).toHaveLength(1);
    expect(log[0]!.qty).toBe(4);
    expect(log[0]!.remarks).toContain(f.ncCode);
  });

  // 0093 / ADR-117: this used to assert status=closed. Closing on the spot made
  // the returned piece disappear — not in stock, not at the vendor, and the op
  // it came from owed a qty nothing could satisfy. It now stays `disposed` so
  // the views can count it as at-vendor until the replacement lands — and since
  // the QC–NC handling change it cannot be closed by hand until the challan has
  // gone out and the replacement has been received and inspected.
  it('return_to_vendor: leaves the NC disposed, awaiting the challan; close refused', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}RTV-JC`,
      ncCode: `${TEST_PREFIX}RTV-NC`,
      rejectedQty: 1,
    });
    const beforeOpLogs = await db
      .select({ id: opLog.id })
      .from(opLog)
      .where(eq(opLog.jcOpId, f.jcOpIds[0]!.jcOpId));
    const { nc } = await service.disposeNcRegister(f.ncId, { action: 'return_to_vendor' }, admin);
    expect(nc.status).toBe('disposed');
    expect(nc.disposition).toBe('return_to_vendor');
    expect(nc.closeBlockedReason).toBe('Return-to-vendor challan not yet issued');
    const afterOpLogs = await db
      .select({ id: opLog.id })
      .from(opLog)
      .where(eq(opLog.jcOpId, f.jcOpIds[0]!.jcOpId));
    expect(afterOpLogs.length).toBe(beforeOpLogs.length); // no op_log appended

    // No challan yet → the gate refuses, naming the shortfall.
    await expect(service.closeNcReturnToVendor(f.ncId, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(service.closeNc(f.ncId, admin)).rejects.toThrow('challan not yet issued');
  });

  it('close-return refuses an NC that is not on the return-to-vendor path', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}RTVX-JC`,
      ncCode: `${TEST_PREFIX}RTVX-NC`,
      rejectedQty: 2,
    });
    await service.disposeNcRegister(f.ncId, { action: 'scrap' }, admin);
    await expect(service.closeNcReturnToVendor(f.ncId, admin)).rejects.toThrow();
  });

  it('make_fresh: creates supplementary JC inheriting source + parent_nc_id', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}MF-JC`,
      ncCode: `${TEST_PREFIX}MF-NC`,
      rejectedQty: 6,
    });
    const { nc } = await service.disposeNcRegister(f.ncId, { action: 'make_fresh' }, admin);
    expect(nc.status).toBe('closed');
    expect(nc.disposition).toBe('make_fresh');
    expect(nc.reworkJcCodeText).toBe(`${f.jcCode}-S1`);

    const newJc = await db
      .select()
      .from(jobCards)
      .where(and(eq(jobCards.companyId, admin.companyId!), eq(jobCards.code, `${f.jcCode}-S1`)))
      .limit(1);
    expect(newJc[0]!.parentNcId).toBe(f.ncId);
    expect(newJc[0]!.itemId).toBe(testItemId);
    expect(newJc[0]!.orderQty).toBe(6);
    expect(newJc[0]!.sourceLegacyRef).toBe(`supp-of:${f.ncCode}`);

    // Supplementary JC gets its own CREATE audit row keyed by the new JC code
    // so the JC filter shows the creation event (NC_DISPOSE detail mentions
    // the new code in passing but doesn't satisfy the JC's own audit trail).
    const suppCreateRows = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, admin.companyId!),
          eq(activityLog.refId, `${f.jcCode}-S1`),
          eq(activityLog.action, 'CREATE'),
        ),
      );
    expect(suppCreateRows).toHaveLength(1);
    expect(suppCreateRows[0]!.entity).toBe('JobCard');
    expect(suppCreateRows[0]!.detail).toContain(f.ncCode);
    expect(suppCreateRows[0]!.detail).toContain('Supplementary');

    // Second make_fresh on a different NC against same origin → -S2
    const f2 = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}MF2-NC-WRAPPER`, // unused, just to give a different ncCode
      ncCode: `${TEST_PREFIX}MF2-NC`,
      rejectedQty: 3,
    });
    // Force the second NC to point at the first JC so the supplementary
    // numbering increments cleanly.
    await db.update(ncRegister).set({ jobCardId: f.jcId }).where(eq(ncRegister.id, f2.ncId));
    const r2 = await service.disposeNcRegister(f2.ncId, { action: 'make_fresh' }, admin);
    expect(r2.nc.reworkJcCodeText).toBe(`${f.jcCode}-S2`);
  });

  it('rejects re-dispose on an already-disposed NC with ConflictError', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}DBL-JC`,
      ncCode: `${TEST_PREFIX}DBL-NC`,
      rejectedQty: 1,
    });
    await service.disposeNcRegister(f.ncId, { action: 'scrap', scrapCost: 0 }, admin);
    await expect(
      service.disposeNcRegister(f.ncId, { action: 'scrap', scrapCost: 0 }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('use_as_is requires NC to have op_seq + jc_op_id set', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}UAI-NOOP-JC`,
      ncCode: `${TEST_PREFIX}UAI-NOOP-NC`,
      rejectedQty: 1,
    });
    // Strip op_seq + jc_op_id to simulate a manual NC without op picked.
    await db.update(ncRegister).set({ opSeq: null, jcOpId: null }).where(eq(ncRegister.id, f.ncId));
    await expect(
      service.disposeNcRegister(f.ncId, { action: 'use_as_is' }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('nc-register recovery QC + closure gate (design §3–§4)', () => {
  it('child JC terminal QC credits cleared/failed, re-injects accepted into the origin op, auto-closes', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}RQC-JC`,
      ncCode: `${TEST_PREFIX}RQC-NC`,
      rejectedQty: 5,
      opSeqs: [1, 2],
      ncOpSeq: 2,
    });
    const originOpId = f.jcOpIds.find((o) => o.opSeq === 2)!.jcOpId;
    const res = await service.disposeNcRegister(f.ncId, { action: 'rework' }, admin);
    const childId = res.childJobCardId!;
    const childOpId = await addSingleQcOp(childId);

    // Manual close is refused while pieces are still on the child.
    await expect(service.closeNc(f.ncId, admin)).rejects.toThrow('5 of 5 pcs still under rework');
    await expect(service.closeNcRework(f.ncId, { reworkDoneQty: 5 }, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );

    // First inspection: 3 good, 1 bad — still open.
    await inUserTx((tx) =>
      onRecoveryJobCardQc(
        tx,
        {
          jobCardId: childId,
          jcOpId: childOpId,
          acceptedQty: 3,
          rejectedQty: 1,
          qcLogId: '00000000-0000-0000-0000-000000000000',
          logDate: '2026-05-05',
          shift: 'day',
        },
        admin.companyId!,
        admin,
      ),
    );
    let nc = await service.getNcRegister(f.ncId, admin);
    expect(nc.clearedQty).toBe('3.00');
    expect(nc.failedQty).toBe('1.00');
    expect(nc.openQty).toBe('1.00');
    expect(nc.status).toBe('under_rework');
    expect(nc.closeBlockedReason).toContain('1 of 5 pcs still under rework');

    // Second inspection clears the last piece → auto-closed.
    await inUserTx((tx) =>
      onRecoveryJobCardQc(
        tx,
        {
          jobCardId: childId,
          jcOpId: childOpId,
          acceptedQty: 1,
          rejectedQty: 0,
          qcLogId: '00000000-0000-0000-0000-000000000000',
          logDate: '2026-05-05',
          shift: 'day',
        },
        admin.companyId!,
        admin,
      ),
    );
    nc = await service.getNcRegister(f.ncId, admin);
    expect(nc.status).toBe('closed');
    expect(nc.clearedQty).toBe('4.00');
    expect(nc.closedAt).not.toBeNull();
    expect(nc.closeBlockedReason).toBeNull();

    // The 4 recovered pieces are back on the parent's origin op as QC-accepted.
    const reinjected = await db
      .select({ qty: opLog.qty, remarks: opLog.remarks })
      .from(opLog)
      .where(and(eq(opLog.jcOpId, originOpId), eq(opLog.logType, 'qc')));
    expect(reinjected.reduce((s, r) => s + r.qty, 0)).toBe(4);
    expect(reinjected[0]!.remarks).toContain(`Recovered via ${f.jcCode}-RW1`);

    // Over-crediting is refused.
    await expect(
      inUserTx((tx) =>
        onRecoveryJobCardQc(
          tx,
          {
            jobCardId: childId,
            jcOpId: childOpId,
            acceptedQty: 1,
            rejectedQty: 0,
            qcLogId: '00000000-0000-0000-0000-000000000000',
            logDate: '2026-05-05',
            shift: 'day',
          },
          admin.companyId!,
          admin,
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const audit = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, f.ncCode)));
    expect(audit.map((r) => r.action).sort()).toEqual([
      'NC_DISPOSE',
      'NC_RECOVERY_QC',
      'NC_RECOVERY_QC',
    ]);
  });

  it('the hook is a no-op on a card that is not a recovery child', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}NOP-JC`,
      ncCode: `${TEST_PREFIX}NOP-NC`,
      rejectedQty: 1,
    });
    await inUserTx((tx) =>
      onRecoveryJobCardQc(
        tx,
        {
          jobCardId: f.jcId,
          jcOpId: f.jcOpIds[0]!.jcOpId,
          acceptedQty: 1,
          rejectedQty: 0,
          qcLogId: '00000000-0000-0000-0000-000000000000',
          logDate: '2026-05-05',
          shift: 'day',
        },
        admin.companyId!,
        admin,
      ),
    );
    const nc = await service.getNcRegister(f.ncId, admin);
    expect(nc.status).toBe('pending');
    expect(nc.clearedQty).toBe('0.00');
  });
});

describe('nc-register close-rework — legacy in-route rows (0088 / 0089)', () => {
  it('flips a legacy disposed+rework row → closed, records rework_done_qty', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}CLR-JC`,
      ncCode: `${TEST_PREFIX}CLR-NC`,
      rejectedQty: 5,
    });
    await makeLegacyReworkRow(f.ncId, 1);
    const closed = await service.closeNcRework(f.ncId, { reworkDoneQty: 5 }, admin);
    expect(closed.status).toBe('closed');
    expect(closed.reworkDoneQty).toBe('5.00');
    expect(closed.closedAt).not.toBeNull();
  });

  it('0088: rework counts down — outstanding is derived from the NC, so closing it clears the op', async () => {
    // ADR-112. `jc_ops.rework_qty` only ever increments and closeNcRework never
    // touched it, so a reworked op carried a permanent phantom balance in
    // `available` — and, after 0087, in Pending too. The view sums the
    // outstanding qty from nc_register instead. Legacy rows only: a NEW rework
    // disposition raises a child card and never sets rework_op_seq.
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}RWD-JC`,
      ncCode: `${TEST_PREFIX}RWD-NC`,
      rejectedQty: 5,
      opSeqs: [1, 2],
      ncOpSeq: 2,
    });
    const op1 = f.jcOpIds.find((o) => o.opSeq === 1)!.jcOpId;

    const op2 = f.jcOpIds.find((o) => o.opSeq === 2)!.jcOpId;
    const readOp = async (
      jcOpId: string,
    ): Promise<{
      available: number;
      pendingQty: number;
      reworkPendingQty: number;
      reworkRaisedQty: number;
      reworkRaisedToOps: string | null;
    }> => {
      const rows = await db.execute(sql`
        SELECT available, pending_qty, rework_pending_qty,
               rework_raised_qty, rework_raised_to_ops
        FROM public.v_jc_op_status WHERE jc_op_id = ${jcOpId}::uuid
      `);
      const r = (
        rows as unknown as Array<{
          available: string | number;
          pending_qty: string | number;
          rework_pending_qty: string | number;
          rework_raised_qty: string | number;
          rework_raised_to_ops: string | null;
        }>
      )[0]!;
      return {
        available: Number(r.available),
        pendingQty: Number(r.pending_qty),
        reworkPendingQty: Number(r.rework_pending_qty),
        reworkRaisedQty: Number(r.rework_raised_qty),
        reworkRaisedToOps: r.rework_raised_to_ops,
      };
    };

    const before = await readOp(op1);
    expect(before.reworkPendingQty).toBe(0);

    // A legacy row sending the 5 back to op 1.
    await makeLegacyReworkRow(f.ncId, 1);
    const owed = await readOp(op1);
    expect(owed.reworkPendingQty).toBe(5);
    expect(owed.available).toBe(before.available + 5);
    expect(owed.pendingQty).toBe(before.pendingQty + 5);

    // 0090: the op that REJECTED (the NC's own op 2) reports the same 5 from the
    // other end — what became of its rejects — and names where they went.
    const raiser = await readOp(op2);
    expect(raiser.reworkRaisedQty).toBe(5);
    expect(raiser.reworkRaisedToOps).toBe('1');
    expect(raiser.reworkPendingQty).toBe(0); // the redo is not ITS work

    // Rework done → close the NC. The balance must go away.
    await service.closeNcRework(f.ncId, { reworkDoneQty: 5 }, admin);
    const cleared = await readOp(op1);
    expect(cleared.reworkPendingQty).toBe(0);
    expect(cleared.available).toBe(before.available);
    expect(cleared.pendingQty).toBe(before.pendingQty);
    // Both ends clear together — they read the same NC rows.
    const raiserCleared = await readOp(op2);
    expect(raiserCleared.reworkRaisedQty).toBe(0);
    expect(raiserCleared.reworkRaisedToOps).toBeNull();
  });

  it('0089: an op that owes rework is not complete, so its JC cannot auto-close', async () => {
    // ADR-113. The complete branch fired on output >= order_qty and never asked
    // about rework, so Op1 of IN-JC-26-00085 read `complete` with 5 pins still
    // waiting to be re-cut. v_jc_status calls a JC complete when every op is
    // complete, and sales-cascade then stamps closed_at and closes the SO line —
    // so the JC could close with work outstanding.
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}RWC-JC`,
      ncCode: `${TEST_PREFIX}RWC-NC`,
      rejectedQty: 5,
      opSeqs: [1],
    });
    const op1 = f.jcOpIds[0]!.jcOpId;
    // Produce the whole order on the only op — the JC is now "finished".
    await db.insert(opLog).values({
      companyId: admin.companyId!,
      jcOpId: op1,
      logNo: `${TEST_PREFIX}RWC-LOG`,
      logType: 'complete',
      logDate: '2026-05-04',
      shift: 'day',
      qty: 100,
      rejectQty: 0,
      operatorName: 'TestOp',
      createdBy: admin.id,
    });

    const opStatus = async (): Promise<string> => {
      const rows = await db.execute(sql`
        SELECT computed_status FROM public.v_jc_op_status WHERE jc_op_id = ${op1}::uuid
      `);
      return (rows as unknown as Array<{ computed_status: string }>)[0]!.computed_status;
    };
    const jcStatus = async (): Promise<string> => {
      const rows = await db.execute(sql`
        SELECT computed_status FROM public.v_jc_status WHERE job_card_id = ${f.jcId}::uuid
      `);
      return (rows as unknown as Array<{ computed_status: string }>)[0]!.computed_status;
    };

    expect(await opStatus()).toBe('complete');
    expect(await jcStatus()).toBe('complete');

    // A legacy row sending 5 back for rework — the op is no longer finished, and
    // neither is the JC, so the sales cascade's `jc_not_complete` guard holds it.
    await makeLegacyReworkRow(f.ncId, 1);
    expect(await opStatus()).toBe('in_progress');
    expect(await jcStatus()).not.toBe('complete');

    // Rework closed → the op finishes and the JC is free to close again.
    await service.closeNcRework(f.ncId, { reworkDoneQty: 5 }, admin);
    expect(await opStatus()).toBe('complete');
    expect(await jcStatus()).toBe('complete');
  });

  it('blocks close-rework on a non-rework disposition (ConflictError)', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}CLR2-JC`,
      ncCode: `${TEST_PREFIX}CLR2-NC`,
      rejectedQty: 1,
    });
    await service.disposeNcRegister(f.ncId, { action: 'scrap', scrapCost: 0 }, admin);
    await expect(service.closeNcRework(f.ncId, {}, admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it('emits NC_CLOSE on a manual close, atomic with the status flip', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}AUD-JC`,
      ncCode: `${TEST_PREFIX}AUD-NC`,
      rejectedQty: 4,
    });
    await makeLegacyReworkRow(f.ncId, 1);
    await service.closeNcRework(f.ncId, { reworkDoneQty: 4 }, admin);

    const auditRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, f.ncCode)));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['NC_CLOSE']);
    for (const r of auditRows) {
      expect(r.entity).toBe('NonConformance');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(f.ncCode);
    }
    expect(auditRows[0]!.detail).toContain('reworkDone=4');

    // Closing twice is refused.
    await expect(service.closeNc(f.ncId, admin)).rejects.toBeInstanceOf(ConflictError);
  });
});
