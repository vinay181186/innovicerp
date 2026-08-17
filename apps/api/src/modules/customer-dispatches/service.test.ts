// Customer Dispatch service tests — assembly finished-good readiness + stock legs.
//
// The Assembly Tracker BUILDS the finished good: completing a batch debits the
// components and CREDITS the parent item into finished-goods stock (ADR-115
// assembly output). So for an assembly / equipment SO line dispatch:
//
//   1. Readiness is the parent's ON-HAND finished-goods stock (gross of what
//      this line already dispatched), NOT a parts / child-JC rollup.
//   2. Dispatch debits the PARENT finished good (the units in stock), never the
//      components — they were already consumed when the batch was assembled.
//
// This replaced the old "phantom parent" model (weakest-component MIN readiness,
// component-by-component debits), which read 0 for tracker-built equipment SOs
// that have no child JCs and blocked dispatch of physically-assembled units.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  bomMasterLines,
  bomMasters,
  customerDispatchLines,
  customerDispatches,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
  storeTransactions,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { cancelDispatch, createDispatch, getDispatchableSo } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TDSPB-';

let admin: AuthContext;
let itemIds: string[] = [];

async function makeItem(code: string, name: string): Promise<string> {
  const r = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}${code}`,
      name,
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemIds.push(r[0]!.id);
  return r[0]!.id;
}

/**
 * Build a BOM (its own PEN parent + one component) and an SO line for
 * `orderQty` that points at that BOM. Readiness reads the parent's stock, so
 * every fixture gets a FRESH parent to keep tests from sharing a stock pool.
 * No child JCs are needed — the Tracker credits the parent directly.
 */
async function makeAssemblyFixture(opts: {
  tag: string;
  orderQty: number;
}): Promise<{ soId: string; soLineId: string; parentId: string }> {
  const parentId = await makeItem(`PEN-${opts.tag}`, `Pen assembly ${opts.tag}`);
  const compId = await makeItem(`C-${opts.tag}`, `Component ${opts.tag}`);

  const bom = await db
    .insert(bomMasters)
    .values({
      companyId: admin.companyId!,
      bomNo: `${TEST_PREFIX}${opts.tag}`,
      bomName: `assembly ${opts.tag}`,
      parentItemId: parentId,
      status: 'active',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  await db.insert(bomMasterLines).values({
    companyId: admin.companyId!,
    bomMasterId: bom[0]!.id,
    lineNo: 1,
    childItemId: compId,
    qtyPerSet: '1.00',
    bomType: 'manufacture',
    createdBy: admin.id,
    updatedBy: admin.id,
  });

  const so = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-${opts.tag}`,
      soDate: '2026-08-01',
      status: 'open',
      type: 'component_manufacturing',
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
      itemId: parentId,
      partName: 'PEN',
      orderQty: opts.orderQty,
      rate: '100',
      status: 'open',
      sourceBomMasterId: bom[0]!.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();

  return { soId: so[0]!.id, soLineId: soLine[0]!.id, parentId };
}

/** Credit physical finished-goods stock for the parent (Tracker output stand-in). */
async function creditStock(itemId: string, qty: number): Promise<void> {
  await db.insert(storeTransactions).values({
    companyId: admin.companyId!,
    txnDate: '2026-08-02',
    itemId,
    txnType: 'in',
    qty,
    sourceType: 'assembly',
    sourceRef: `${TEST_PREFIX}seed (output)`,
    stockBefore: 0,
    stockAfter: qty,
    remarks: 'test seed',
    createdBy: admin.id,
  });
}

async function onHand(itemId: string): Promise<number> {
  const rows = await db
    .select({ q: itemStockBalances.onHandQty })
    .from(itemStockBalances)
    .where(eq(itemStockBalances.itemId, itemId));
  return Number(rows[0]?.q ?? 0);
}

async function cleanup(): Promise<void> {
  const ids = itemIds.filter(Boolean);
  await db.delete(customerDispatchLines).where(like(customerDispatchLines.itemCodeText, `${TEST_PREFIX}%`));
  await db.delete(customerDispatches).where(like(customerDispatches.soCodeText, `${TEST_PREFIX}%`));
  if (ids.length > 0) {
    await db.delete(storeTransactions).where(inArray(storeTransactions.itemId, ids));
    await db.delete(itemStockBalances).where(inArray(itemStockBalances.itemId, ids));
  }
  await db.delete(salesOrderLines).where(like(salesOrderLines.partName, 'PEN'));
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  const boms = await db.select({ id: bomMasters.id }).from(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  if (boms.length > 0) {
    await db.delete(bomMasterLines).where(
      inArray(bomMasterLines.bomMasterId, boms.map((b) => b.id)),
    );
  }
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  itemIds = [];
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe('customer dispatch — assembly finished-good readiness', () => {
  it('reads Ready from the parent on-hand stock, capped at the order qty', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'STOCK', orderQty: 10 });
    await creditStock(parentId, 7);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    // 7 assembled units in stock, nothing dispatched, order has room for 10.
    expect(line.readyQty).toBe(7);
    expect(line.availableQty).toBe(7);
  });

  it('caps available at the order qty when more is in stock than ordered', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'CAP', orderQty: 3 });
    await creditStock(parentId, 10);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(10);
    expect(line.availableQty).toBe(3);
  });

  it('reports 0 ready while nothing has been assembled into stock', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({ tag: 'ZERO', orderQty: 10 });

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(0);
    expect(line.availableQty).toBe(0);
  });
});

describe('customer dispatch — assembly finished-good stock legs', () => {
  it('debits the parent finished good (not the components), then reverses on cancel', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'LEG', orderQty: 10 });
    await creditStock(parentId, 10);

    const dispatch = await createDispatch(
      { salesOrderId: soId, dispatchDate: '2026-08-03', lines: [{ salesOrderLineId: soLineId, qty: 4 }] },
      admin,
    );

    const mine = (
      await db.select().from(storeTransactions).where(eq(storeTransactions.sourceType, 'dispatch'))
    ).filter((r) => (r.sourceRef ?? '').startsWith(dispatch.code));
    const outs = mine.filter((r) => r.txnType === 'out');

    // Exactly ONE out row, on the PARENT, at the dispatched qty. No components.
    expect(outs).toHaveLength(1);
    expect(outs[0]!.itemId).toBe(parentId);
    expect(outs[0]!.qty).toBe(4);
    expect(await onHand(parentId)).toBe(6);

    // Cancel puts the 4 back on the parent.
    await cancelDispatch(dispatch.id, admin);
    const ins = (
      await db.select().from(storeTransactions).where(eq(storeTransactions.sourceType, 'dispatch'))
    )
      .filter((r) => (r.sourceRef ?? '').startsWith(dispatch.code))
      .filter((r) => r.txnType === 'in');
    expect(ins).toHaveLength(1);
    expect(ins[0]!.itemId).toBe(parentId);
    expect(ins[0]!.qty).toBe(4);
    expect(await onHand(parentId)).toBe(10);
  });

  it('refuses to dispatch more than the parent stock (capped by order) allows', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'GUARD', orderQty: 10 });
    await creditStock(parentId, 3);

    await expect(
      createDispatch(
        { salesOrderId: soId, dispatchDate: '2026-08-03', lines: [{ salesOrderLineId: soLineId, qty: 4 }] },
        admin,
      ),
    ).rejects.toThrow(/only 3 ready to dispatch/);
  });
});
