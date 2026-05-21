// Assembly service tests (PL-5). Sets up an Equipment SO + 1 line + BOM
// with 2 children + per-child stock balances, then exercises the readiness
// math + the unit lifecycle (assemble → dispatch → undo) + the manual
// override path.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  bomMasterLines,
  bomMasters,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'TPL5-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let parentItemId: string;
let childAId: string;
let childBId: string;
let bomId: string;
let soId: string;

async function teardown(): Promise<void> {
  // FK chain: assembly_units + assembly_tracking CASCADE from sales_orders.
  // BOM lines CASCADE from bom_masters. SO lines CASCADE from sales_orders.
  // item_stock_balances CASCADE from items.
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  // 3 items: equipment parent + 2 children
  const ins = await db
    .insert(items)
    .values([
      {
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}EQUIP-A`,
        name: 'PL-5 Equipment',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}CHILD-X`,
        name: 'Child X',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}CHILD-Y`,
        name: 'Child Y',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  parentItemId = ins[0]!.id;
  childAId = ins[1]!.id;
  childBId = ins[2]!.id;

  // Stock: Child X has 50 on hand; Child Y has 10 on hand.
  await db.insert(itemStockBalances).values([
    {
      companyId: admin.companyId!,
      itemId: childAId,
      onHandQty: 50,
    },
    {
      companyId: admin.companyId!,
      itemId: childBId,
      onHandQty: 10,
    },
  ]);

  // BOM master with 2 lines: Child X 1/set, Child Y 2/set.
  const bom = await db
    .insert(bomMasters)
    .values({
      companyId: admin.companyId!,
      bomNo: `${TEST_PREFIX}BOM-1`,
      bomName: 'PL-5 BOM',
      revision: 1,
      status: 'active',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  bomId = bom[0]!.id;

  await db.insert(bomMasterLines).values([
    {
      companyId: admin.companyId!,
      bomMasterId: bomId,
      lineNo: 1,
      childItemId: childAId,
      qtyPerSet: '1',
      bomType: 'manufacture',
      createdBy: admin.id,
      updatedBy: admin.id,
    },
    {
      companyId: admin.companyId!,
      bomMasterId: bomId,
      lineNo: 2,
      childItemId: childBId,
      qtyPerSet: '2',
      bomType: 'purchase',
      createdBy: admin.id,
      updatedBy: admin.id,
    },
  ]);

  // Equipment SO with 1 line (orderQty 5)
  const so = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-EQ`,
      soDate: '2026-05-21',
      customerName: 'PL-5 Customer',
      type: 'equipment',
      status: 'open',
      gstPercent: '18.00',
      bomMasterId: bomId,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soId = so[0]!.id;

  await db.insert(salesOrderLines).values({
    companyId: admin.companyId!,
    salesOrderId: soId,
    lineNo: 1,
    itemId: parentItemId,
    partName: 'PL-5 Equipment',
    uom: 'NOS',
    orderQty: 5,
    rate: '10000',
    status: 'open',
    createdBy: admin.id,
    updatedBy: admin.id,
  });
});

afterAll(async () => {
  await teardown();
  // Item stock balances are NOT auto-cascaded — wipe explicitly.
  await db.delete(itemStockBalances).where(inArray(itemStockBalances.itemId, [childAId, childBId]));
});

describe('assembly service — getAssemblyTracker', () => {
  it('returns header + 2 components + rollup for Equipment SO with BOM', async () => {
    const result = await service.getAssemblyTracker(soId, admin);
    expect(result.header.soId).toBe(soId);
    expect(result.header.type).toBe('equipment');
    expect(result.header.bomMasterId).toBe(bomId);
    expect(result.header.bomCode).toBe(`${TEST_PREFIX}BOM-1`);
    expect(result.header.orderQty).toBe(5);

    expect(result.components).toHaveLength(2);
    const byCode: Record<string, (typeof result.components)[number]> = {};
    for (const c of result.components) byCode[c.childItemCode] = c;

    // Child X: qtyPerSet=1, totalNeed=5, stock=50 → autoReady=5, enough for 5
    const x = byCode[`${TEST_PREFIX}CHILD-X`]!;
    expect(x.qtyPerSet).toBe(1);
    expect(x.totalNeed).toBe(5);
    expect(x.stockQty).toBe(50);
    expect(x.autoReadyQty).toBe(5);
    expect(x.finalReadyQty).toBe(5);
    expect(x.enoughForUnits).toBe(5);
    expect(x.status).toBe('ready');

    // Child Y: qtyPerSet=2, totalNeed=10, stock=10 → autoReady=10, enough for 5
    const y = byCode[`${TEST_PREFIX}CHILD-Y`]!;
    expect(y.qtyPerSet).toBe(2);
    expect(y.totalNeed).toBe(10);
    expect(y.stockQty).toBe(10);
    expect(y.autoReadyQty).toBe(10);
    expect(y.enoughForUnits).toBe(5);
    expect(y.status).toBe('ready');

    // Rollup: both can do 5 units → can assemble 5, no bottleneck preference
    expect(result.rollup.canAssembleAdditional).toBe(5);
    expect(result.rollup.assembledQty).toBe(0);
    expect(result.rollup.balanceQty).toBe(5);
    expect(result.rollup.status).toBe('ready');
    expect(result.rollup.bottleneck).not.toBeNull();
  });

  it('NotFoundError on unknown SO id', async () => {
    await expect(
      service.getAssemblyTracker('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('assembly service — readiness override', () => {
  it('setReadinessOverride raises finalReady when override > autoReady', async () => {
    // Set Child Y override to 15 (auto is 10 → final 15, enough for 7)
    await service.setReadinessOverride(
      soId,
      `${TEST_PREFIX}CHILD-Y`,
      { readyQtyOverride: 15, remarks: 'planner override' },
      admin,
    );
    const result = await service.getAssemblyTracker(soId, admin);
    const y = result.components.find((c) => c.childItemCode === `${TEST_PREFIX}CHILD-Y`)!;
    expect(y.overrideQty).toBe(15);
    expect(y.finalReadyQty).toBe(15);
    expect(y.enoughForUnits).toBe(7);

    // Reset for downstream tests
    await service.setReadinessOverride(
      soId,
      `${TEST_PREFIX}CHILD-Y`,
      { readyQtyOverride: 0 },
      admin,
    );
  });

  it('override that is lower than auto is ignored (max wins)', async () => {
    await service.setReadinessOverride(
      soId,
      `${TEST_PREFIX}CHILD-X`,
      { readyQtyOverride: 1 },
      admin,
    );
    const result = await service.getAssemblyTracker(soId, admin);
    const x = result.components.find((c) => c.childItemCode === `${TEST_PREFIX}CHILD-X`)!;
    expect(x.finalReadyQty).toBe(x.autoReadyQty); // override < auto → auto wins
    // Reset
    await service.setReadinessOverride(
      soId,
      `${TEST_PREFIX}CHILD-X`,
      { readyQtyOverride: 0 },
      admin,
    );
  });
});

describe('assembly service — unit lifecycle', () => {
  it('markUnitAssembled inserts unit #1 with serial', async () => {
    const u = await service.markUnitAssembled(
      soId,
      { serialNo: 'SN-001', assembledBy: 'Vinay' },
      admin,
    );
    expect(u.unitNo).toBe(1);
    expect(u.serialNo).toBe('SN-001');
    expect(u.dispatched).toBe(false);
  });

  it('markUnitAssembled auto-increments unit_no on second call', async () => {
    const u = await service.markUnitAssembled(soId, { serialNo: 'SN-002' }, admin);
    expect(u.unitNo).toBe(2);
  });

  it('markUnitDispatched flips dispatched=true', async () => {
    // Use unit #1 from the first test
    const tracker = await service.getAssemblyTracker(soId, admin);
    const unit1 = tracker.units.find((u) => u.unitNo === 1)!;
    const after = await service.markUnitDispatched(
      unit1.id,
      { dispatchedBy: 'Driver A', dispatchRemarks: 'LR-1234' },
      admin,
    );
    expect(after.dispatched).toBe(true);
    expect(after.dispatchedBy).toBe('Driver A');
  });

  it('markUnitDispatched on already-dispatched unit → ConflictError', async () => {
    const tracker = await service.getAssemblyTracker(soId, admin);
    const u1 = tracker.units.find((u) => u.unitNo === 1)!;
    await expect(
      service.markUnitDispatched(u1.id, {}, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('undoLastUnit succeeds for the non-dispatched latest unit (#2)', async () => {
    const result = await service.undoLastUnit(soId, admin);
    expect(result.removedUnitNo).toBe(2);
    const tracker = await service.getAssemblyTracker(soId, admin);
    expect(tracker.rollup.assembledQty).toBe(1); // only unit #1 left
  });

  it('undoLastUnit fails when latest non-deleted unit is dispatched', async () => {
    // After the previous undo, unit #1 (dispatched) is the only one left.
    await expect(service.undoLastUnit(soId, admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rollup status flips to assembling when units exist but not done', async () => {
    const tracker = await service.getAssemblyTracker(soId, admin);
    expect(tracker.rollup.assembledQty).toBe(1);
    expect(tracker.rollup.balanceQty).toBe(4);
    expect(tracker.rollup.status).toBe('assembling');
  });

  it('markUnitAssembled rejects when assembledQty would exceed orderQty', async () => {
    // Currently 1 assembled (unit #1 dispatched). Assemble 4 more to reach orderQty=5.
    await service.markUnitAssembled(soId, {}, admin);
    await service.markUnitAssembled(soId, {}, admin);
    await service.markUnitAssembled(soId, {}, admin);
    await service.markUnitAssembled(soId, {}, admin);
    const after = await service.getAssemblyTracker(soId, admin);
    expect(after.rollup.assembledQty).toBe(5);
    expect(after.rollup.status).toBe('done');

    // Now a 6th unit must fail
    await expect(service.markUnitAssembled(soId, {}, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('assembly service — Equipment-only', () => {
  it('rejects markUnitAssembled on a non-Equipment SO with ValidationError', async () => {
    // Create a sibling Component SO (not Equipment)
    const compSo = await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}SO-COMP`,
        soDate: '2026-05-21',
        customerName: 'Component',
        type: 'component_manufacturing',
        status: 'open',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await expect(
      service.markUnitAssembled(compSo[0]!.id, {}, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('assembly service — listAssemblies', () => {
  it('returns the fixture Equipment SO with the correct counters', async () => {
    const result = await service.listAssemblies(admin);
    const row = result.items.find((r) => r.soCode === `${TEST_PREFIX}SO-EQ`);
    expect(row).toBeDefined();
    expect(row!.orderQty).toBe(5);
    expect(row!.assembledQty).toBe(5);
    expect(row!.status).toBe('done');
  });
});
