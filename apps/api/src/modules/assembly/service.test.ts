// Assembly service tests (PL-5). Sets up an Equipment SO + 1 line + BOM
// with 2 children + per-child stock balances, then exercises the readiness
// math + the unit lifecycle (assemble → dispatch → undo) + the manual
// override path.

import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  assemblyUnits,
  bomMasterLines,
  bomMasters,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
  storeTransactions,
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

describe('assembly service — assembly consumes component stock (ADR-115)', () => {
  // Before this, markUnitAssembled wrote the unit row and an audit row and
  // stopped. Components physically inside finished machines still counted as
  // free stock, so the tracker offered to build more units out of parts that
  // no longer existed. On the live DB that had already driven one component to
  // -1 behind a readiness override.
  it('debits every component on assemble and credits them back on undo', async () => {
    // Earlier describes in this file already assemble units, so scope every
    // assertion to THIS unit's own ledger rows rather than the whole prefix.
    const readLedger = async (
      unitNo: number,
    ): Promise<Array<{ qty: number; txnType: string; ref: string }>> =>
      db
        .select({
          qty: storeTransactions.qty,
          txnType: storeTransactions.txnType,
          ref: storeTransactions.sourceRef,
        })
        .from(storeTransactions)
        .where(
          and(
            eq(storeTransactions.sourceType, 'assembly'),
            like(storeTransactions.sourceRef, `%${TEST_PREFIX}SO-EQ unit #${unitNo}%`),
          ),
        );

    // The lifecycle describe above fills the fixture to 5 of 5, so make room
    // for one more unit and put the order qty back afterwards.
    await db.update(salesOrderLines).set({ orderQty: 6 }).where(eq(salesOrderLines.salesOrderId, soId));
    try {
      // Fixture BOM: CHILD-X at 1/set, CHILD-Y at 2/set → one unit eats 1 + 2.
      const unit = await service.markUnitAssembled(soId, { serialNo: `${TEST_PREFIX}SN-STK` }, admin);

      const afterAssemble = await readLedger(unit.unitNo);
      expect(afterAssemble).toHaveLength(2);
      expect(afterAssemble.every((r) => r.txnType === 'out')).toBe(true);
      expect(afterAssemble.map((r) => r.qty).sort((a, b) => a - b)).toEqual([1, 2]);

      // Undo puts them back — a compensating IN, never a delete, so the ledger
      // stays append-only and the audit trail survives.
      await service.undoLastUnit(soId, admin);
      const afterUndo = await readLedger(unit.unitNo);
      const ins = afterUndo.filter((r) => r.txnType === 'in');
      expect(ins).toHaveLength(2);
      expect(ins.map((r) => r.qty).sort((a, b) => a - b)).toEqual([1, 2]);
      // Net effect of assemble-then-undo on the shelf is zero.
      const net = afterUndo.reduce((s, r) => s + (r.txnType === 'in' ? r.qty : -r.qty), 0);
      expect(net).toBe(0);
    } finally {
      await db.update(salesOrderLines).set({ orderQty: 5 }).where(eq(salesOrderLines.salesOrderId, soId));
      await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `%${TEST_PREFIX}%`));
    }
  });
});

describe('assembly service — listAssemblies', () => {
  // Assembling now CONSUMES component stock (ADR-115), and the describes above
  // build units — so by the time these run the fixture's shelf has been eaten
  // into. Reset it to the values setupFixture wrote (X 50, Y 10) so the
  // readiness assertions below test the list maths, not test ordering.
  beforeAll(async () => {
    await db
      .update(itemStockBalances)
      .set({ onHandQty: 50 })
      .where(eq(itemStockBalances.itemId, childAId));
    await db
      .update(itemStockBalances)
      .set({ onHandQty: 10 })
      .where(eq(itemStockBalances.itemId, childBId));
  });

  it('returns the fixture Equipment SO with the correct counters', async () => {
    const result = await service.listAssemblies(admin);
    const row = result.items.find((r) => r.soCode === `${TEST_PREFIX}SO-EQ`);
    expect(row).toBeDefined();
    expect(row!.orderQty).toBe(5);
    expect(row!.assembledQty).toBe(5);
    expect(row!.status).toBe('done');
  });

  it('carries BOM name + revision and the component-readiness counters', async () => {
    // These four fields did not exist on the list payload. Without them the
    // card could not print legacy's "BOM: <no> Rev <n>", searching by BOM name
    // matched nothing, and the "Waiting — 3/7" badge had no numbers.
    const result = await service.listAssemblies(admin);
    const row = result.items.find((r) => r.soCode === `${TEST_PREFIX}SO-EQ`)!;
    expect(row.bomCode).toBe(`${TEST_PREFIX}BOM-1`);
    expect(row.bomName).not.toBeNull();
    expect(row.bomRevision).not.toBeNull();
    // Fixture BOM: CHILD-X (need 5, stock 50) + CHILD-Y (need 10, stock 10).
    // Both fully covered, and each is good for 5 units.
    expect(row.totalCount).toBe(2);
    expect(row.readyCount).toBe(2);
    expect(row.canAssemble).toBe(5);
  });

  it('drops closed Equipment SOs — nothing left to assemble', async () => {
    // Legacy's _atBuildAssemblies skips `so.status!=='Closed'` (HTML L28675).
    // Ours listed them, so the tracker was mostly finished work.
    const before = await service.listAssemblies(admin);
    expect(before.items.some((r) => r.soCode === `${TEST_PREFIX}SO-EQ`)).toBe(true);

    await db.update(salesOrders).set({ status: 'closed' }).where(eq(salesOrders.id, soId));
    try {
      const after = await service.listAssemblies(admin);
      expect(after.items.some((r) => r.soCode === `${TEST_PREFIX}SO-EQ`)).toBe(false);
    } finally {
      await db.update(salesOrders).set({ status: 'open' }).where(eq(salesOrders.id, soId));
    }
  });

  it("reaches 'ready' — the status the list could never return", async () => {
    // listAssemblies passed a hardcoded 0 as canAssemble into deriveStatus,
    // which only returns 'ready' when that argument is > 0. So the Ready KPI
    // tile always read 0, the "ALL READY ✓" badge was dead code, and an SO
    // with every component in stock was labelled "Waiting" — the one question
    // this page exists to answer. Nothing caught it because no test asserted
    // any status other than the one the fixture happened to be in.
    //
    // Park the fixture's units so assembledQty drops to 0, which is the only
    // state where waiting-vs-ready is decided; restore them afterwards.
    // Park only the LIVE units and restore exactly those — an earlier test
    // soft-deleted one and its unit_no was reused, so un-deleting everything
    // resurrects a duplicate and trips assembly_units_so_unit_uniq.
    const live = await db
      .select({ id: assemblyUnits.id })
      .from(assemblyUnits)
      .where(and(eq(assemblyUnits.salesOrderId, soId), isNull(assemblyUnits.deletedAt)));
    const liveIds = live.map((r) => r.id);
    await db.update(assemblyUnits).set({ deletedAt: new Date() }).where(inArray(assemblyUnits.id, liveIds));
    try {
      const result = await service.listAssemblies(admin);
      const row = result.items.find((r) => r.soCode === `${TEST_PREFIX}SO-EQ`)!;
      expect(row.assembledQty).toBe(0);
      expect(row.canAssemble).toBe(5);
      expect(row.status).toBe('ready');
    } finally {
      await db.update(assemblyUnits).set({ deletedAt: null }).where(inArray(assemblyUnits.id, liveIds));
    }
  });
});

// ── Start / Stop (WIP, ADR-129) ─────────────────────────────────────────────
// Isolated fixture (own SO + BOM + 2 children with ample stock) so the WIP
// flow is deterministic and never collides with the shared soId's sequential
// assertions above.
describe('assembly service — start / stop (WIP, ADR-129)', () => {
  let wipSoId: string;
  let wipChildX: string;
  let wipChildY: string;
  let startedUnitId: string;

  beforeAll(async () => {
    const ins = await db
      .insert(items)
      .values([
        { companyId: admin.companyId!, code: `${TEST_PREFIX}WIP-CX`, name: 'WIP Child X', revision: 'A', uom: 'NOS', itemType: 'component', createdBy: admin.id, updatedBy: admin.id },
        { companyId: admin.companyId!, code: `${TEST_PREFIX}WIP-CY`, name: 'WIP Child Y', revision: 'A', uom: 'NOS', itemType: 'component', createdBy: admin.id, updatedBy: admin.id },
      ])
      .returning();
    wipChildX = ins[0]!.id;
    wipChildY = ins[1]!.id;
    await db.insert(itemStockBalances).values([
      { companyId: admin.companyId!, itemId: wipChildX, onHandQty: 1000 },
      { companyId: admin.companyId!, itemId: wipChildY, onHandQty: 1000 },
    ]);
    const bom = await db
      .insert(bomMasters)
      .values({ companyId: admin.companyId!, bomNo: `${TEST_PREFIX}WIP-BOM`, bomName: 'WIP BOM', revision: 1, status: 'active', createdBy: admin.id, updatedBy: admin.id })
      .returning();
    await db.insert(bomMasterLines).values([
      { companyId: admin.companyId!, bomMasterId: bom[0]!.id, lineNo: 1, childItemId: wipChildX, qtyPerSet: '1', bomType: 'manufacture', createdBy: admin.id, updatedBy: admin.id },
      { companyId: admin.companyId!, bomMasterId: bom[0]!.id, lineNo: 2, childItemId: wipChildY, qtyPerSet: '1', bomType: 'manufacture', createdBy: admin.id, updatedBy: admin.id },
    ]);
    const so = await db
      .insert(salesOrders)
      .values({ companyId: admin.companyId!, code: `${TEST_PREFIX}WIP-SO`, soDate: '2026-05-21', customerName: 'WIP Cust', type: 'equipment', status: 'open', gstPercent: '18.00', bomMasterId: bom[0]!.id, createdBy: admin.id, updatedBy: admin.id })
      .returning();
    wipSoId = so[0]!.id;
    await db.insert(salesOrderLines).values({ companyId: admin.companyId!, salesOrderId: wipSoId, lineNo: 1, itemId: wipChildX, partName: 'WIP Equip', uom: 'NOS', orderQty: 5, rate: '1000', status: 'open', createdBy: admin.id, updatedBy: admin.id });
  });

  afterAll(async () => {
    // Assembly-consume ledger + stock rows for the WIP children (the top-level
    // teardown deletes the TEST_PREFIX SO/BOM/items but not these).
    await db.delete(storeTransactions).where(inArray(storeTransactions.itemId, [wipChildX, wipChildY]));
    await db.delete(itemStockBalances).where(inArray(itemStockBalances.itemId, [wipChildX, wipChildY]));
  });

  it('start puts the batch in WIP with no stock debit', async () => {
    const started = await service.startAssembly(wipSoId, { qty: 5 }, admin);
    startedUnitId = started.id;
    expect(started.status).toBe('in_progress');
    expect(started.qty).toBe(5);
    expect(started.serialNo).toBeNull();

    const t = await service.getAssemblyTracker(wipSoId, admin);
    expect(t.rollup.inProgressQty).toBe(5);
    expect(t.rollup.assembledQty).toBe(0);
    expect(t.rollup.status).toBe('assembling');
    // No stock left the store yet (start reserves nothing).
    const x = t.components.find((c) => c.childItemCode === `${TEST_PREFIX}WIP-CX`)!;
    expect(x.stockQty).toBe(1000);
  });

  it('stop above the batch remaining is rejected', async () => {
    await expect(
      service.stopAssembly(startedUnitId, { completedQty: 6 }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('an in-progress batch cannot be dispatched', async () => {
    await expect(
      service.markUnitDispatched(startedUnitId, {}, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('stop completes the good qty and leaves the rest in assembly', async () => {
    await service.stopAssembly(startedUnitId, { completedQty: 3 }, admin);
    const t = await service.getAssemblyTracker(wipSoId, admin);
    expect(t.rollup.assembledQty).toBe(3);
    expect(t.rollup.inProgressQty).toBe(2);
    const wip = t.units.find((u) => u.status === 'in_progress');
    const done = t.units.filter((u) => u.status === 'completed');
    expect(wip?.qty).toBe(2);
    expect(done.reduce((s, u) => s + u.qty, 0)).toBe(3);
    // The 3 good units debited their X + Y components.
    const x = t.components.find((c) => c.childItemCode === `${TEST_PREFIX}WIP-CX`)!;
    expect(x.stockQty).toBe(997);
  });

  it('stopping the remainder finishes the order and clears WIP', async () => {
    await service.stopAssembly(startedUnitId, { completedQty: 2 }, admin);
    const t = await service.getAssemblyTracker(wipSoId, admin);
    expect(t.rollup.assembledQty).toBe(5);
    expect(t.rollup.inProgressQty).toBe(0);
    expect(t.rollup.status).toBe('done');
    expect(t.units.some((u) => u.status === 'in_progress')).toBe(false);
  });

  it('start is rejected once the order is fully committed', async () => {
    await expect(service.startAssembly(wipSoId, { qty: 1 }, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
