// SO Status Review service tests (PL-1).
//
// Builds a synthetic SO + line + JC + ops + op_log fixture in beforeAll, wipes
// in afterAll. Fixture rows use the `TPL1-` prefix so the global-setup sweep
// (test/global-setup.ts) catches anything left behind by a killed run.

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  jcOps,
  jobCards,
  opLog,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'TPL1-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let itemId: string;
let soId: string;
let soLineId: string;
let jcId: string;
let opId1: string;
let opId2: string;

async function teardown(): Promise<void> {
  // JC cascade-deletes its ops + op_log + running_ops (FK ON DELETE CASCADE).
  // SO line FK on jc.source_so_line_id is ON DELETE SET NULL so order is safe.
  // Activity_log is append-only — scope by refId per feedback memory.
  await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));
  const sosToWipe = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${TEST_PREFIX}%`));
  for (const so of sosToWipe) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) {
    throw new Error('Seed admin missing — run pnpm --filter api seed');
  }
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  // 1 item
  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM-A`,
      name: 'PL-1 Test Item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemId = itemRows[0]!.id;

  // SO + 1 line (orderQty 100)
  const soRows = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-001`,
      soDate: '2026-05-01',
      customerName: 'PL-1 Test Customer',
      type: 'component_manufacturing',
      status: 'open',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soId = soRows[0]!.id;

  const soLineRows = await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: soId,
      lineNo: 1,
      itemId,
      partName: 'PL-1 Part',
      uom: 'NOS',
      orderQty: 100,
      rate: '10.00',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soLineId = soLineRows[0]!.id;

  // JC linked to the SO line (orderQty 100)
  const jcRows = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}JC-001`,
      jcDate: '2026-05-02',
      itemId,
      orderQty: 100,
      priority: 'normal',
      sourceSoLineId: soLineId,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  jcId = jcRows[0]!.id;

  // 2 process ops: op 1 = no QC, op 2 = QC required
  const opRows = await db
    .insert(jcOps)
    .values([
      {
        companyId: admin.companyId!,
        jobCardId: jcId,
        opSeq: 1,
        machineCodeText: 'PL1-M1',
        operation: 'turn',
        opType: 'process',
        cycleTimeMin: '0',
        qcRequired: false,
        reworkQty: 0,
        outsourceCost: '0',
        outsourceSentQty: 0,
        outsourceReturnedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        jobCardId: jcId,
        opSeq: 2,
        machineCodeText: 'PL1-M2',
        operation: 'mill',
        opType: 'process',
        cycleTimeMin: '0',
        qcRequired: true,
        reworkQty: 0,
        outsourceCost: '0',
        outsourceSentQty: 0,
        outsourceReturnedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  opId1 = opRows[0]!.id;
  opId2 = opRows[1]!.id;

  // op 1: complete 60 of 100 (in_progress); op 2 inputAvail = 60, no logs (waiting? no — completed=0, inputAvail=60>0 → available)
  await db.insert(opLog).values({
    companyId: admin.companyId!,
    jcOpId: opId1,
    logNo: `${TEST_PREFIX}LOG-1`,
    logType: 'complete',
    logDate: '2026-05-03',
    shift: 'day',
    qty: 60,
    rejectQty: 0,
    operatorName: 'PL1-Op',
    createdBy: admin.id,
  });
});

afterAll(async () => {
  await teardown();
});

describe('so-status service', () => {
  it('NotFoundError on unknown SO id', async () => {
    await expect(
      service.getSoStatus('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns header + 1 line + 1 JC with op rollups', async () => {
    const result = await service.getSoStatus(soId, admin);

    expect(result.header.id).toBe(soId);
    expect(result.header.code).toBe(`${TEST_PREFIX}SO-001`);
    expect(result.header.customerName).toBe('PL-1 Test Customer');
    expect(result.header.totalQty).toBe(100);
    expect(result.header.totalDoneQty).toBe(0); // op 2 hasn't produced
    expect(result.header.overallCompletionPct).toBe(0);

    expect(result.lines).toHaveLength(1);
    const line = result.lines[0]!;
    expect(line.id).toBe(soLineId);
    expect(line.lineNo).toBe(1);
    expect(line.orderQty).toBe(100);
    expect(line.itemCode).toBe(`${TEST_PREFIX}ITEM-A`);
    expect(line.status).toBe('in_progress');
    expect(line.completionPct).toBe(0); // last op (op 2) has done=0

    expect(line.chips.jcIssued).toEqual({ qty: 100, total: 100 });
    expect(line.chips.produced).toEqual({ qty: 0, total: 100 });
    expect(line.chips.poRaised).toEqual({ qty: 0, total: 100 });

    expect(line.jobCards).toHaveLength(1);
    const jc = line.jobCards[0]!;
    expect(jc.code).toBe(`${TEST_PREFIX}JC-001`);
    expect(jc.orderQty).toBe(100);
    expect(jc.status).toBe('in_progress');
    expect(jc.ops).toHaveLength(2);

    const [op1, op2] = jc.ops;
    expect(op1?.opSeq).toBe(1);
    expect(op1?.completed).toBe(60);
    expect(op1?.status).toBe('in_progress');

    expect(op2?.opSeq).toBe(2);
    expect(op2?.inputAvail).toBe(60); // flows from op1's completed (no qc on op1)
    expect(op2?.completed).toBe(0);
    expect(op2?.status).toBe('available');
  });

  it('progresses to qc_pending when last op completes without QC inspection', async () => {
    // Add op 2 completion of 60 (qcRequired=true → flips to qc_pending)
    await db.insert(opLog).values({
      companyId: admin.companyId!,
      jcOpId: opId2,
      logNo: `${TEST_PREFIX}LOG-2`,
      logType: 'complete',
      logDate: '2026-05-04',
      shift: 'day',
      qty: 60,
      rejectQty: 0,
      operatorName: 'PL1-Op',
      createdBy: admin.id,
    });

    const result = await service.getSoStatus(soId, admin);
    const line = result.lines[0]!;
    expect(line.status).toBe('qc_pending');
    const jc = line.jobCards[0]!;
    expect(jc.status).toBe('qc_pending');
    expect(jc.ops[1]?.completed).toBe(60);
    expect(jc.ops[1]?.qcPending).toBe(60);
    expect(jc.ops[1]?.status).toBe('qc_pending');
    expect(line.chips.produced.qty).toBe(0); // doneQty = qcAccepted on last op, still 0

    // Cleanup the extra log
    await db.delete(opLog).where(
      and(eq(opLog.jcOpId, opId2), like(opLog.logNo, `${TEST_PREFIX}LOG-2`)),
    );
  });

  it('returns empty lines array on an SO with zero lines (no JC fetch issued)', async () => {
    // Create a second SO with no lines
    const emptySo = await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}SO-EMPTY`,
        soDate: '2026-05-01',
        customerName: 'PL-1 Empty',
        type: 'component_manufacturing',
        status: 'open',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const result = await service.getSoStatus(emptySo[0]!.id, admin);
    expect(result.lines).toEqual([]);
    expect(result.header.totalQty).toBe(0);
  });

  it('header surfaces SO type + status + customerName verbatim', async () => {
    const result = await service.getSoStatus(soId, admin);
    expect(result.header.type).toBe('component_manufacturing');
    expect(result.header.status).toBe('open');
    expect(result.header.customerName).toBe('PL-1 Test Customer');
    expect(result.header.bomMasterId).toBeNull();
  });
});
