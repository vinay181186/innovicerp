// SO Planning workflow service tests (PL-4b). Fixture: 2 open SOs.
//   SP-SO-A: 2 lines, 1 of them has a non-cancelled plan covering half qty
//   SP-SO-B: 1 line, no plans (unplanned)
// Covers: getPlanningSoList (totals + pct + status classification),
//         getPlanningSoDetail (per-line plans + remaining math),
//         getPlanningBom (rejects when no BOM is linked).

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  planOps,
  plans,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import * as service from './service';

const PREFIX = 'TSPL-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let itemId: string;
let soAId: string;
let soBId: string;
let lineA1Id: string;

async function teardown(): Promise<void> {
  const planRows = await db
    .select({ id: plans.id })
    .from(plans)
    .where(like(plans.code, `${PREFIX}%`));
  if (planRows.length > 0) {
    const planIds = planRows.map((p) => p.id);
    await db.delete(planOps).where(inArray(planOps.planId, planIds));
    await db.delete(plans).where(inArray(plans.id, planIds));
  }
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${PREFIX}%`));
  for (const so of sos) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${PREFIX}%`));
  await db.delete(items).where(like(items.code, `${PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  const it1 = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${PREFIX}ITM-A`,
      name: 'PL-4b Test Item A',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemId = it1[0]!.id;

  // SO A — 2 lines, line 1 has a half-covering plan
  const soA = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${PREFIX}SO-A`,
      soDate: '2026-05-01',
      customerName: 'Planning Customer A',
      type: 'component_manufacturing',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soAId = soA[0]!.id;

  const linesA = await db
    .insert(salesOrderLines)
    .values([
      {
        companyId: admin.companyId!,
        salesOrderId: soAId,
        lineNo: 1,
        itemId,
        partName: 'PL-4b Part A1',
        orderQty: 10,
        dueDate: '2026-06-01',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        salesOrderId: soAId,
        lineNo: 2,
        itemId,
        partName: 'PL-4b Part A2',
        orderQty: 20,
        dueDate: '2026-06-15',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  lineA1Id = linesA[0]!.id;

  await db.insert(plans).values({
    companyId: admin.companyId!,
    code: `${PREFIX}PL-A1`,
    planDate: '2026-05-01',
    planStatus: 'in_planning',
    planType: 'manufacture',
    soLineId: lineA1Id,
    itemId,
    itemCodeText: `${PREFIX}ITM-A`,
    orderQty: 10,
    planQty: 5, // half-cover → partial
    createdBy: admin.id,
    updatedBy: admin.id,
  });

  // SO B — 1 line, unplanned
  const soB = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${PREFIX}SO-B`,
      soDate: '2026-05-02',
      customerName: 'Planning Customer B',
      type: 'component_manufacturing',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soBId = soB[0]!.id;

  await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: soBId,
      lineNo: 1,
      itemId,
      partName: 'PL-4b Part B1',
      orderQty: 8,
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
}, 120_000);

afterAll(async () => {
  await teardown();
});

describe('so-planning — left pane list', () => {
  it('returns SO A with partial status (5/30 = 17%) and SO B unplanned', async () => {
    const out = await service.getPlanningSoList(admin);
    const a = out.items.find((r) => r.soCode === `${PREFIX}SO-A`);
    const b = out.items.find((r) => r.soCode === `${PREFIX}SO-B`);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // SO A: 2 lines, total qty 30, planned 5 → 17% partial
    expect(a!.totalLines).toBe(2);
    expect(a!.totalQty).toBe(30);
    expect(a!.totalPlannedQty).toBe(5);
    expect(a!.planningPct).toBe(17);
    expect(a!.planningStatus).toBe('partial');
    // SO B: 1 line, total qty 8, planned 0
    expect(b!.totalLines).toBe(1);
    expect(b!.totalQty).toBe(8);
    expect(b!.totalPlannedQty).toBe(0);
    expect(b!.planningPct).toBe(0);
    expect(b!.planningStatus).toBe('unplanned');
  });
});

describe('so-planning — right pane detail', () => {
  it('returns lines with per-line plans + remaining math', async () => {
    const out = await service.getPlanningSoDetail(soAId, admin);
    expect(out.soCode).toBe(`${PREFIX}SO-A`);
    expect(out.lines).toHaveLength(2);
    const l1 = out.lines.find((l) => l.lineNo === 1)!;
    expect(l1.plans).toHaveLength(1);
    expect(l1.plans[0]!.code).toBe(`${PREFIX}PL-A1`);
    expect(l1.plans[0]!.planQty).toBe(5);
    expect(l1.totalPlanned).toBe(5);
    expect(l1.remaining).toBe(5);
    expect(l1.lineStatus).toBe('partial');
    expect(l1.hasEquipmentBom).toBe(false);
    expect(l1.hasAssemblyBom).toBe(false);
    const l2 = out.lines.find((l) => l.lineNo === 2)!;
    expect(l2.plans).toHaveLength(0);
    expect(l2.remaining).toBe(20);
    expect(l2.lineStatus).toBe('unplanned');
  });

  it('throws NotFoundError for unknown SO', async () => {
    await expect(
      service.getPlanningSoDetail('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toThrow(/not found/i);
  });

  it('throws ValidationError on bad uuid', async () => {
    await expect(service.getPlanningSoDetail('not-a-uuid', admin)).rejects.toThrow(/Invalid/);
  });
});

describe('so-planning — BOM aggregator', () => {
  it('rejects when SO line has no linked BOM', async () => {
    await expect(service.getPlanningBom(lineA1Id, admin)).rejects.toThrow(/no linked BOM/);
  });
});
