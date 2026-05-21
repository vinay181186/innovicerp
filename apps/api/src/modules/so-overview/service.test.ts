// SO Overview service tests (PL-2). Two-SO fixture:
//   PL2-SO-A: 1 line + 1 JC, op partially complete → in_production / in_progress
//   PL2-SO-B: 1 line + 1 JC, op fully complete + qc accepted → finished / completed
// Search + status filter happy paths covered.

import { eq, like } from 'drizzle-orm';
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
import * as service from './service';

const TEST_PREFIX = 'TPL2-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let itemId: string;
let soAId: string;
let soBId: string;
let lineAId: string;
let lineBId: string;
let jcAId: string;
let jcBId: string;
let opAId: string;
let opBId: string;

async function teardown(): Promise<void> {
  await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${TEST_PREFIX}%`));
  for (const so of sos) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM`,
      name: 'PL-2 Test Item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemId = itemRows[0]!.id;

  // SO A — in progress (partially complete)
  const soA = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-A`,
      soDate: '2026-05-01',
      customerName: 'PL-2 Customer A',
      type: 'component_manufacturing',
      status: 'open',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soAId = soA[0]!.id;

  const lineA = await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: soAId,
      lineNo: 1,
      itemId,
      partName: 'Part A',
      uom: 'NOS',
      orderQty: 50,
      rate: '10.00',
      dueDate: '2099-12-31',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  lineAId = lineA[0]!.id;

  const jcA = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}JC-A`,
      jcDate: '2026-05-02',
      itemId,
      orderQty: 50,
      priority: 'normal',
      sourceSoLineId: lineAId,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  jcAId = jcA[0]!.id;

  const opA = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId: jcAId,
      opSeq: 1,
      machineCodeText: 'PL2-M1',
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
    })
    .returning();
  opAId = opA[0]!.id;

  await db.insert(opLog).values({
    companyId: admin.companyId!,
    jcOpId: opAId,
    logNo: `${TEST_PREFIX}LOG-A1`,
    logType: 'complete',
    logDate: '2026-05-03',
    shift: 'day',
    qty: 20,
    rejectQty: 0,
    operatorName: 'PL2-Op',
    createdBy: admin.id,
  });

  // SO B — completed (one op, full production, no QC)
  const soB = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-B`,
      soDate: '2026-05-01',
      customerName: 'PL-2 Customer B',
      type: 'component_manufacturing',
      status: 'open',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soBId = soB[0]!.id;

  const lineB = await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: soBId,
      lineNo: 1,
      itemId,
      partName: 'Part B',
      uom: 'NOS',
      orderQty: 30,
      rate: '10.00',
      dueDate: '2099-12-31',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  lineBId = lineB[0]!.id;

  const jcB = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}JC-B`,
      jcDate: '2026-05-02',
      itemId,
      orderQty: 30,
      priority: 'normal',
      sourceSoLineId: lineBId,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  jcBId = jcB[0]!.id;

  const opB = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId: jcBId,
      opSeq: 1,
      machineCodeText: 'PL2-M2',
      operation: 'mill',
      opType: 'process',
      cycleTimeMin: '0',
      qcRequired: false,
      reworkQty: 0,
      outsourceCost: '0',
      outsourceSentQty: 0,
      outsourceReturnedQty: 0,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  opBId = opB[0]!.id;

  await db.insert(opLog).values({
    companyId: admin.companyId!,
    jcOpId: opBId,
    logNo: `${TEST_PREFIX}LOG-B1`,
    logType: 'complete',
    logDate: '2026-05-03',
    shift: 'day',
    qty: 30,
    rejectQty: 0,
    operatorName: 'PL2-Op',
    createdBy: admin.id,
  });
});

afterAll(async () => {
  await teardown();
});

describe('so-overview service', () => {
  it('returns 2 fixture SOs with correct overallStatus + stage counters', async () => {
    const result = await service.getSoOverview(admin, { search: TEST_PREFIX });

    expect(result.rows).toHaveLength(2);
    const byCode: Record<string, (typeof result.rows)[number]> = {};
    for (const r of result.rows) byCode[r.code] = r;

    const a = byCode[`${TEST_PREFIX}SO-A`]!;
    expect(a.totalRequiredQty).toBe(50);
    expect(a.totalDoneQty).toBe(20);
    expect(a.overallPct).toBe(40);
    expect(a.overallStatus).toBe('on_track'); // dueDate in 2099, partially complete
    expect(a.stageCounts.inProduction).toBe(1);
    expect(a.stageCounts.finished).toBe(0);

    const b = byCode[`${TEST_PREFIX}SO-B`]!;
    expect(b.totalDoneQty).toBe(30);
    expect(b.overallPct).toBe(100);
    expect(b.overallStatus).toBe('completed');
    expect(b.stageCounts.finished).toBe(1);
    expect(b.stageCounts.inProduction).toBe(0);
  });

  it('summary tallies match the row statuses', async () => {
    const result = await service.getSoOverview(admin, { search: TEST_PREFIX });
    expect(result.summary.soCount).toBe(2);
    expect(result.summary.completedCount).toBe(1);
    expect(result.summary.onTrackCount).toBe(1);
    expect(result.summary.notStartedCount).toBe(0);
  });

  it('search filter narrows to one SO', async () => {
    const result = await service.getSoOverview(admin, { search: `${TEST_PREFIX}SO-A` });
    expect(result.rows.map((r) => r.code)).toEqual([`${TEST_PREFIX}SO-A`]);
  });

  it('status=closed filters out the open fixture SOs', async () => {
    const result = await service.getSoOverview(admin, {
      status: 'closed',
      search: TEST_PREFIX,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.summary.soCount).toBe(0);
  });

  it('returns empty rows when filter matches nothing', async () => {
    const result = await service.getSoOverview(admin, { search: 'TPL2-NONEXISTENT-XYZ' });
    expect(result.rows).toHaveLength(0);
    expect(result.summary.soCount).toBe(0);
    expect(result.filter.search).toBe('TPL2-NONEXISTENT-XYZ');
  });
});
