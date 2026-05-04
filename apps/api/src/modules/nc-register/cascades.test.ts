// T-040b cascade tests. Each path inserts its own NC + JC + jc_op fixture
// inside the test rather than reusing migrated rows, so we can freely write
// op_log + new JC rows + flip jc_ops.reworkQty without polluting prod-shape
// data. Same defensive prefix pattern as sales-cascade.test.ts.

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  items,
  jcOps,
  jobCards,
  ncRegister,
  opLog,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
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

describe('nc-register dispose cascades (T-040b)', () => {
  it('rework: flips status=disposed, increments jc_ops.rework_qty on the picked op', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}REW-JC`,
      ncCode: `${TEST_PREFIX}REW-NC`,
      rejectedQty: 5,
      opSeqs: [1, 2, 3],
      ncOpSeq: 3,
    });
    const { result, nc } = await service.disposeNcRegister(
      f.ncId,
      { action: 'rework', reworkOpSeq: 2 },
      admin,
    );
    expect(result.status).toBe('disposed');
    expect(result.reworkOpSeqApplied).toBe(2);
    expect(nc.status).toBe('disposed');
    expect(nc.disposition).toBe('rework');
    expect(nc.reworkOpSeq).toBe(2);

    // Confirm rework_qty bumped on op 2 (not op 3, the NC's own op)
    const op2 = f.jcOpIds.find((o) => o.opSeq === 2)!;
    const reread = await db.select().from(jcOps).where(eq(jcOps.id, op2.jcOpId)).limit(1);
    expect(reread[0]!.reworkQty).toBe(5);
  });

  it('rework defaults to NC.opSeq when reworkOpSeq is omitted', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}REW2-JC`,
      ncCode: `${TEST_PREFIX}REW2-NC`,
      rejectedQty: 3,
      ncOpSeq: 1,
    });
    const { nc } = await service.disposeNcRegister(f.ncId, { action: 'rework' }, admin);
    expect(nc.reworkOpSeq).toBe(1);
    const op1 = f.jcOpIds.find((o) => o.opSeq === 1)!;
    const reread = await db.select().from(jcOps).where(eq(jcOps.id, op1.jcOpId)).limit(1);
    expect(reread[0]!.reworkQty).toBe(3);
  });

  it('scrap: flips status=closed, captures scrap_cost', async () => {
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
  });

  it('use_as_is: flips status=closed, appends an op_log row with type=qc + qty=rejected', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}UAI-JC`,
      ncCode: `${TEST_PREFIX}UAI-NC`,
      rejectedQty: 4,
      ncOpSeq: 1,
    });
    const { result, nc } = await service.disposeNcRegister(
      f.ncId,
      { action: 'use_as_is' },
      admin,
    );
    expect(nc.status).toBe('closed');
    expect(nc.disposition).toBe('use_as_is');
    expect(result.opLogId).toBeDefined();

    const log = await db
      .select()
      .from(opLog)
      .where(eq(opLog.id, result.opLogId!))
      .limit(1);
    expect(log[0]!.qty).toBe(4);
    expect(log[0]!.logType).toBe('qc');
    expect(log[0]!.remarks).toContain(f.ncCode);
  });

  it('return_to_vendor: flips status=closed, no other side effects', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}RTV-JC`,
      ncCode: `${TEST_PREFIX}RTV-NC`,
      rejectedQty: 1,
    });
    const beforeOpLogs = await db
      .select({ id: opLog.id })
      .from(opLog)
      .where(eq(opLog.jcOpId, f.jcOpIds[0]!.jcOpId));
    const { nc } = await service.disposeNcRegister(
      f.ncId,
      { action: 'return_to_vendor' },
      admin,
    );
    expect(nc.status).toBe('closed');
    expect(nc.disposition).toBe('return_to_vendor');
    const afterOpLogs = await db
      .select({ id: opLog.id })
      .from(opLog)
      .where(eq(opLog.jcOpId, f.jcOpIds[0]!.jcOpId));
    expect(afterOpLogs.length).toBe(beforeOpLogs.length); // no op_log appended
  });

  it('make_fresh: creates supplementary JC inheriting source + parent_nc_id', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}MF-JC`,
      ncCode: `${TEST_PREFIX}MF-NC`,
      rejectedQty: 6,
    });
    const { result, nc } = await service.disposeNcRegister(
      f.ncId,
      { action: 'make_fresh' },
      admin,
    );
    expect(nc.status).toBe('closed');
    expect(nc.disposition).toBe('make_fresh');
    expect(result.newJcCode).toBe(`${f.jcCode}-S1`);
    expect(nc.reworkJcCodeText).toBe(`${f.jcCode}-S1`);

    const newJc = await db.select().from(jobCards).where(eq(jobCards.id, result.newJcId!)).limit(1);
    expect(newJc[0]!.parentNcId).toBe(f.ncId);
    expect(newJc[0]!.itemId).toBe(testItemId);
    expect(newJc[0]!.orderQty).toBe(6);
    expect(newJc[0]!.sourceLegacyRef).toBe(`supp-of:${f.ncCode}`);

    // Second make_fresh on a different NC against same origin → -S2
    const f2 = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}MF2-NC-WRAPPER`, // unused, just to give a different ncCode
      ncCode: `${TEST_PREFIX}MF2-NC`,
      rejectedQty: 3,
    });
    // Force the second NC to point at the first JC so the supplementary
    // numbering increments cleanly.
    await db
      .update(ncRegister)
      .set({ jobCardId: f.jcId })
      .where(eq(ncRegister.id, f2.ncId));
    const { result: r2 } = await service.disposeNcRegister(
      f2.ncId,
      { action: 'make_fresh' },
      admin,
    );
    expect(r2.newJcCode).toBe(`${f.jcCode}-S2`);
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

  it('rejects rework when the picked rework op_seq does not exist on the JC', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}BAD-JC`,
      ncCode: `${TEST_PREFIX}BAD-NC`,
      rejectedQty: 1,
      opSeqs: [1, 2],
    });
    await expect(
      service.disposeNcRegister(f.ncId, { action: 'rework', reworkOpSeq: 99 }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('use_as_is requires NC to have op_seq + jc_op_id set', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}UAI-NOOP-JC`,
      ncCode: `${TEST_PREFIX}UAI-NOOP-NC`,
      rejectedQty: 1,
    });
    // Strip op_seq + jc_op_id to simulate a manual NC without op picked.
    await db
      .update(ncRegister)
      .set({ opSeq: null, jcOpId: null })
      .where(eq(ncRegister.id, f.ncId));
    await expect(
      service.disposeNcRegister(f.ncId, { action: 'use_as_is' }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('nc-register close-rework (T-040b)', () => {
  it('flips disposed+rework → closed, records rework_done_qty', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}CLR-JC`,
      ncCode: `${TEST_PREFIX}CLR-NC`,
      rejectedQty: 5,
    });
    await service.disposeNcRegister(f.ncId, { action: 'rework' }, admin);
    const closed = await service.closeNcRework(f.ncId, { reworkDoneQty: 5 }, admin);
    expect(closed.status).toBe('closed');
    expect(closed.reworkDoneQty).toBe('5.00');
  });

  it('blocks close-rework on a non-rework disposition (ConflictError)', async () => {
    const f = await createJcWithOpsAndNc({
      jcCode: `${TEST_PREFIX}CLR2-JC`,
      ncCode: `${TEST_PREFIX}CLR2-NC`,
      rejectedQty: 1,
    });
    await service.disposeNcRegister(f.ncId, { action: 'scrap', scrapCost: 0 }, admin);
    await expect(
      service.closeNcRework(f.ncId, {}, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// Silence unused-import false positives.
void and;
